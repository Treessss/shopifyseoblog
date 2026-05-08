import { NextResponse } from "next/server";

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ ok: true, data }, init);
}

export function fail(status: number, error: ApiError) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function readJson<T = unknown>(request: Request): Promise<T | null> {
  const raw = await request.text();
  if (!raw.trim()) return null;

  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function getEnv(name: string): string | null {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value : null;
}

export function getAppUrl(requestUrl?: string): string {
  const configured = getEnv("APP_URL");
  if (configured) return configured.replace(/\/$/, "");
  if (!requestUrl) return "http://localhost:3000";
  const url = new URL(requestUrl);
  return `${url.protocol}//${url.host}`;
}

export function publicId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

export function toHandle(input: string): string {
  const handle = input
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);

  return handle || publicId("article");
}
