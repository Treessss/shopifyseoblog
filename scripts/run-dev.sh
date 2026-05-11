#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/infra/docker/docker-compose.yml"
LOG_DIR="${LOG_DIR:-$ROOT_DIR/.run/logs}"
PORT="${PORT:-3000}"

START_INFRA=1
SYNC_DB=1
RUN_SEED=0
RUN_WEB=1
RUN_WORKER=1
CHECK_PORT=1

PIDS=()
SHUTTING_DOWN=0

usage() {
  cat <<'EOF'
Shopify AI Blog local runner

Usage:
  npm run start:local -- [options]
  bash scripts/run-dev.sh [options]

Options:
  --port <port>       Web port. Default: 3000
  --no-infra          Do not start Docker Postgres/Redis/MinIO
  --no-db-sync        Skip Prisma generate + db push
  --seed              Run database seed after db sync
  --web-only          Start only the Next.js web app
  --worker-only       Start only the BullMQ worker
  --no-port-check     Do not fail when the web port is already open
  -h, --help          Show this help

Default mode:
  1. Ensure .env.local exists
  2. Start Postgres, Redis, and MinIO with Docker Compose
  3. Run Prisma generate + db push
  4. Start Web and Worker in one terminal
EOF
}

info() {
  printf "\033[1;36m[run]\033[0m %s\n" "$*"
}

warn() {
  printf "\033[1;33m[run]\033[0m %s\n" "$*" >&2
}

die() {
  printf "\033[1;31m[run]\033[0m %s\n" "$*" >&2
  exit 1
}

parse_args() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --port)
        [ "${2:-}" ] || die "--port requires a value."
        PORT="$2"
        shift 2
        ;;
      --no-infra)
        START_INFRA=0
        shift
        ;;
      --no-db-sync)
        SYNC_DB=0
        shift
        ;;
      --seed)
        RUN_SEED=1
        shift
        ;;
      --web-only)
        RUN_WEB=1
        RUN_WORKER=0
        shift
        ;;
      --worker-only)
        RUN_WEB=0
        RUN_WORKER=1
        CHECK_PORT=0
        shift
        ;;
      --no-port-check)
        CHECK_PORT=0
        shift
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        die "Unknown option: $1"
        ;;
    esac
  done
}

need_command() {
  command -v "$1" >/dev/null 2>&1 || die "Missing command: $1"
}

docker_compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose -f "$COMPOSE_FILE" "$@"
    return
  fi

  if command -v docker-compose >/dev/null 2>&1; then
    docker-compose -f "$COMPOSE_FILE" "$@"
    return
  fi

  return 127
}

ensure_env_file() {
  if [ -f "$ROOT_DIR/.env.local" ] || [ -f "$ROOT_DIR/.env" ]; then
    return
  fi

  cp "$ROOT_DIR/.env.example" "$ROOT_DIR/.env.local"
  warn "Created .env.local from .env.example. Fill Shopify/AI secrets before using real integrations."
}

ensure_dependencies() {
  need_command node
  need_command npm

  if [ ! -d "$ROOT_DIR/node_modules" ]; then
    info "Installing npm dependencies..."
    (cd "$ROOT_DIR" && npm install)
  fi
}

start_infra() {
  if [ "$START_INFRA" -eq 0 ]; then
    info "Skipping Docker infra startup."
    return
  fi

  need_command docker
  info "Starting Docker infra: postgres, redis, minio..."
  docker_compose up -d postgres redis minio
  wait_for_port "127.0.0.1" "5432" "Postgres" 60
  wait_for_port "127.0.0.1" "6379" "Redis" 60
}

sync_database() {
  if [ "$SYNC_DB" -eq 0 ]; then
    info "Skipping Prisma generate/db push."
    return
  fi

  info "Generating Prisma client..."
  (cd "$ROOT_DIR" && npm run db:generate)

  info "Syncing database schema with Prisma db push..."
  (cd "$ROOT_DIR" && npm run db:push)

  if [ "$RUN_SEED" -eq 1 ]; then
    info "Seeding database..."
    (cd "$ROOT_DIR" && npm run db:seed)
  fi
}

wait_for_port() {
  local host="$1"
  local port="$2"
  local label="$3"
  local timeout="$4"

  info "Waiting for $label on $host:$port..."
  node - "$host" "$port" "$label" "$timeout" <<'NODE'
const net = require("node:net");
const [host, portValue, label, timeoutValue] = process.argv.slice(2);
const port = Number(portValue);
const timeoutMs = Number(timeoutValue) * 1000;
const startedAt = Date.now();

function check() {
  const socket = net.createConnection({ host, port });
  socket.once("connect", () => {
    socket.destroy();
    process.exit(0);
  });
  socket.once("error", () => {
    socket.destroy();
    if (Date.now() - startedAt >= timeoutMs) {
      console.error(`${label} did not become available on ${host}:${port}.`);
      process.exit(1);
    }
    setTimeout(check, 1000);
  });
}

check();
NODE
}

port_is_open() {
  local host="$1"
  local port="$2"
  node - "$host" "$port" <<'NODE'
const net = require("node:net");
const [host, portValue] = process.argv.slice(2);
const socket = net.createConnection({ host, port: Number(portValue) });
socket.once("connect", () => {
  socket.destroy();
  process.exit(0);
});
socket.once("error", () => {
  socket.destroy();
  process.exit(1);
});
NODE
}

check_web_port() {
  if [ "$RUN_WEB" -eq 0 ] || [ "$CHECK_PORT" -eq 0 ]; then
    return
  fi

  if port_is_open "127.0.0.1" "$PORT"; then
    die "Port $PORT is already in use. Stop the existing app, or run: npm run start:local -- --port 3001"
  fi
}

start_process() {
  local name="$1"
  shift
  local log_file="$LOG_DIR/$name.log"

  mkdir -p "$LOG_DIR"
  info "Starting $name. Log: $log_file"

  (
    cd "$ROOT_DIR"
    exec "$@"
  ) > >(sed -u "s/^/[$name] /" | tee "$log_file") 2>&1 &

  PIDS+=("$!")
}

start_apps() {
  check_web_port

  if [ "$RUN_WEB" -eq 1 ]; then
    start_process "web" npm --workspace @shopify-ai-blog/web run dev -- --port "$PORT"
  fi

  if [ "$RUN_WORKER" -eq 1 ]; then
    start_process "worker" npm --workspace @shopify-ai-blog/worker run dev
  fi

  if [ "${#PIDS[@]}" -eq 0 ]; then
    die "No app process was selected."
  fi

  info "Ready. Web: http://localhost:$PORT"
  info "Press Ctrl+C to stop all started processes."
}

shutdown() {
  if [ "$SHUTTING_DOWN" -eq 1 ]; then
    return
  fi
  SHUTTING_DOWN=1

  if [ "${#PIDS[@]}" -gt 0 ]; then
    warn "Stopping local app processes..."
    kill "${PIDS[@]}" >/dev/null 2>&1 || true
    wait "${PIDS[@]}" >/dev/null 2>&1 || true
  fi
}

monitor_processes() {
  trap shutdown INT TERM EXIT

  while :; do
    for pid in "${PIDS[@]}"; do
      if ! kill -0 "$pid" >/dev/null 2>&1; then
        wait "$pid" || true
        warn "A local app process exited. Stopping the remaining processes."
        exit 1
      fi
    done
    sleep 1
  done
}

main() {
  parse_args "$@"
  cd "$ROOT_DIR"

  ensure_env_file
  ensure_dependencies
  start_infra
  sync_database
  start_apps
  monitor_processes
}

main "$@"
