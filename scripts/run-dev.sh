#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/infra/docker/docker-compose.yml"
LOG_DIR="${LOG_DIR:-$ROOT_DIR/.run/logs}"
PORT="${PORT:-3000}"
REDIS_PORT="${SHOPIFY_BLOG_REDIS_PORT:-6381}"

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
  --redis-port <port> Dedicated Redis host port. Default: 6381
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
      --redis-port)
        [ "${2:-}" ] || die "--redis-port requires a value."
        REDIS_PORT="$2"
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

  die "Docker Compose is not available. Install Docker Desktop or run with --no-infra."
}

has_docker_compose() {
  docker compose version >/dev/null 2>&1 || command -v docker-compose >/dev/null 2>&1
}

docker_daemon_available() {
  docker info >/dev/null 2>&1
}

ensure_env_file() {
  if [ -f "$ROOT_DIR/.env.local" ] || [ -f "$ROOT_DIR/.env" ]; then
    ensure_project_redis_env
    return
  fi

  cp "$ROOT_DIR/.env.example" "$ROOT_DIR/.env.local"
  warn "Created .env.local from .env.example. Fill Shopify/AI secrets before using real integrations."
  ensure_project_redis_env
}

ensure_project_redis_env() {
  local env_file="$ROOT_DIR/.env.local"
  if [ ! -f "$env_file" ]; then
    env_file="$ROOT_DIR/.env"
  fi
  if [ ! -f "$env_file" ]; then
    return
  fi

  node - "$env_file" "$REDIS_PORT" <<'NODE'
const fs = require("node:fs");
const [file, redisPort] = process.argv.slice(2);
const desiredRedisUrl = `redis://localhost:${redisPort}`;
const desiredPrefix = "shopify-ai-blog-local";
let content = fs.readFileSync(file, "utf8");
let changed = false;

if (/^REDIS_URL=/m.test(content)) {
  content = content.replace(/^REDIS_URL=(redis:\/\/(?:localhost|127\.0\.0\.1):\d+)\s*$/m, (_line, currentUrl) => {
    if (currentUrl === desiredRedisUrl) return `REDIS_URL=${currentUrl}`;
    changed = true;
    return `REDIS_URL=${desiredRedisUrl}`;
  });
} else {
  content = `${content.replace(/\s*$/, "\n")}REDIS_URL=${desiredRedisUrl}\n`;
  changed = true;
}

if (/^BULLMQ_PREFIX=shopify-ai-blog\s*$/m.test(content)) {
  content = content.replace(/^BULLMQ_PREFIX=shopify-ai-blog\s*$/m, `BULLMQ_PREFIX=${desiredPrefix}`);
  changed = true;
} else if (!/^BULLMQ_PREFIX=/m.test(content)) {
  content = `${content.replace(/\s*$/, "\n")}BULLMQ_PREFIX=${desiredPrefix}\n`;
  changed = true;
}

if (changed) {
  fs.writeFileSync(file, content);
}
NODE
}

load_env_file() {
  local env_file=""
  if [ -f "$ROOT_DIR/.env.local" ]; then
    env_file="$ROOT_DIR/.env.local"
  elif [ -f "$ROOT_DIR/.env" ]; then
    env_file="$ROOT_DIR/.env"
  fi

  if [ -z "$env_file" ]; then
    return
  fi

  set -a
  # shellcheck disable=SC1090
  . "$env_file"
  set +a
  export SHOPIFY_BLOG_REDIS_PORT="$REDIS_PORT"
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
  export SHOPIFY_BLOG_REDIS_PORT="$REDIS_PORT"
  if has_docker_compose; then
    docker_compose up -d postgres redis minio
  elif docker_daemon_available; then
    warn "Docker Compose is not available; using standalone Docker containers for local infra."
    start_standalone_infra
  else
    warn "Docker daemon is not running; falling back to local services where available."
    start_local_infra
  fi
  wait_for_port "127.0.0.1" "5432" "Postgres" 60
  wait_for_port "127.0.0.1" "$REDIS_PORT" "Redis" 60
}

start_local_infra() {
  if port_is_open "127.0.0.1" "5432"; then
    warn "Postgres port 5432 is already open; reusing the existing database service."
  else
    die "Postgres is not reachable on 5432 and Docker is not running. Start Postgres or Docker Desktop."
  fi

  if port_is_open "127.0.0.1" "$REDIS_PORT"; then
    warn "Redis port $REDIS_PORT is already open; reusing the existing Redis service."
  else
    start_local_redis
  fi

  if ! port_is_open "127.0.0.1" "9000"; then
    warn "MinIO is not running on 9000. Generated image storage may fail until MinIO or another S3-compatible service is configured."
  fi
}

start_local_redis() {
  command -v redis-server >/dev/null 2>&1 || die "Redis is not reachable on $REDIS_PORT and redis-server is not installed."

  mkdir -p "$ROOT_DIR/.run/redis" "$LOG_DIR"
  info "Starting local dedicated Redis on port $REDIS_PORT..."
  redis-server \
    --bind 127.0.0.1 \
    --port "$REDIS_PORT" \
    --dir "$ROOT_DIR/.run/redis" \
    --dbfilename "redis-$REDIS_PORT.rdb" \
    --logfile "$LOG_DIR/redis-$REDIS_PORT.log" \
    --pidfile "$ROOT_DIR/.run/redis-$REDIS_PORT.pid" \
    --daemonize yes
}

start_standalone_infra() {
  if port_is_open "127.0.0.1" "5432"; then
    warn "Postgres port 5432 is already open; reusing the existing database service."
  else
    ensure_container \
      shopify-ai-blog-postgres \
      -e POSTGRES_USER=shopify_blog \
      -e POSTGRES_PASSWORD=shopify_blog \
      -e POSTGRES_DB=shopify_blog \
      -p 5432:5432 \
      -v shopify-ai-blog-postgres-data:/var/lib/postgresql/data \
      postgres:16-alpine
  fi

  if port_is_open "127.0.0.1" "$REDIS_PORT"; then
    warn "Redis port $REDIS_PORT is already open; reusing the existing Redis service."
  else
    ensure_container \
      shopify-ai-blog-redis \
      -p "$REDIS_PORT:6379" \
      -v shopify-ai-blog-redis-data:/data \
      redis:7-alpine
  fi

  if port_is_open "127.0.0.1" "9000"; then
    warn "MinIO port 9000 is already open; reusing the existing object storage service."
  else
    ensure_container \
      shopify-ai-blog-minio \
      -e MINIO_ROOT_USER=minioadmin \
      -e MINIO_ROOT_PASSWORD=minioadmin \
      -p 9000:9000 \
      -p 9001:9001 \
      -v shopify-ai-blog-minio-data:/data \
      minio/minio:latest \
      server /data --console-address ":9001"
  fi
}

ensure_container() {
  local name="$1"
  shift

  if docker ps --filter "name=^/${name}$" --format "{{.Names}}" | grep -qx "$name"; then
    info "Container $name is already running."
    return
  fi

  if docker ps -a --filter "name=^/${name}$" --format "{{.Names}}" | grep -qx "$name"; then
    info "Starting existing container $name..."
    docker start "$name" >/dev/null
    return
  fi

  info "Creating container $name..."
  docker run -d --name "$name" "$@" >/dev/null
}

check_required_services() {
  wait_for_env_url_port "DATABASE_URL" "Postgres" 10
  wait_for_env_url_port "REDIS_URL" "Redis" 10
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

wait_for_env_url_port() {
  local env_name="$1"
  local label="$2"
  local timeout="$3"
  local raw_url="${!env_name:-}"

  if [ -z "$raw_url" ]; then
    die "$env_name is missing. Add it to .env.local."
  fi

  node - "$raw_url" "$label" "$timeout" <<'NODE'
const net = require("node:net");
const [rawUrl, label, timeoutValue] = process.argv.slice(2);
let url;
try {
  url = new URL(rawUrl);
} catch {
  console.error(`${label} URL is invalid.`);
  process.exit(1);
}

const host = url.hostname || "127.0.0.1";
const port = Number(url.port || (url.protocol.startsWith("postgres") ? 5432 : 6379));
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
      console.error(`${label} is not reachable at ${host}:${port}.`);
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
  load_env_file
  ensure_dependencies
  start_infra
  check_required_services
  sync_database
  start_apps
  monitor_processes
}

main "$@"
