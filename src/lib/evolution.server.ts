const BASE = (process.env.EVOLUTION_API_URL ?? "").replace(/\/$/, "");
const KEY = process.env.EVOLUTION_API_KEY ?? "";

export type EvolutionInit = RequestInit & { json?: unknown };

export async function evolutionFetch(path: string, init: EvolutionInit = {}) {
  if (!BASE || !KEY) {
    throw new Error("Evolution API not configured (EVOLUTION_API_URL / EVOLUTION_API_KEY missing).");
  }
  const url = `${BASE}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = new Headers(init.headers);
  headers.set("apikey", KEY);
  headers.set("Content-Type", "application/json");
  const body = init.json !== undefined ? JSON.stringify(init.json) : init.body;
  const res = await fetch(url, { ...init, headers, body });
  const text = await res.text();
  let parsed: unknown = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  if (!res.ok) {
    const msg = typeof parsed === "object" && parsed && "message" in parsed
      ? String((parsed as { message: unknown }).message)
      : `Evolution API ${res.status}: ${text}`;
    throw new Error(msg);
  }
  return parsed;
}

export function getWebhookToken() {
  return process.env.EVOLUTION_WEBHOOK_TOKEN ?? "";
}