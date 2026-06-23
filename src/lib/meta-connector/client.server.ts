import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { GraphError } from "./types";

const GRAPH = "https://graph.facebook.com/v21.0";

export function appId() {
  return process.env.META_APP_ID ?? "";
}
export function appSecret() {
  return process.env.META_APP_SECRET ?? "";
}
export function appToken() {
  return `${appId()}|${appSecret()}`;
}
export function loginConfigId() {
  return process.env.META_LOGIN_CONFIG_ID ?? "";
}
export function webhookVerifyToken() {
  return process.env.META_WEBHOOK_VERIFY_TOKEN ?? "";
}

export type GraphOpts = {
  method?: "GET" | "POST" | "DELETE";
  token: string;
  body?: Record<string, unknown> | URLSearchParams;
  query?: Record<string, string | number | undefined>;
};

/**
 * Low-level Graph API call. Authenticates with the provided token,
 * normalizes errors, and never logs the token. Use through SDK helpers,
 * not directly from app code.
 */
export async function graphFetch<T = unknown>(path: string, opts: GraphOpts): Promise<T> {
  const url = new URL(`${GRAPH}${path.startsWith("/") ? path : `/${path}`}`);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const headers: Record<string, string> = { Authorization: `Bearer ${opts.token}` };
  let body: BodyInit | undefined;
  if (opts.body instanceof URLSearchParams) {
    body = opts.body.toString();
    headers["Content-Type"] = "application/x-www-form-urlencoded";
  } else if (opts.body) {
    body = JSON.stringify(opts.body);
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(url.toString(), { method: opts.method ?? "GET", headers, body });
  const json = (await res.json().catch(() => ({}))) as T & { error?: GraphError };
  if (!res.ok || (json as { error?: GraphError }).error) {
    const err = (json as { error?: GraphError }).error;
    const msg = err?.message ? `Meta: ${err.message}` : `Meta ${res.status}`;
    await logMeta("graph_error", "error", msg, {
      path,
      method: opts.method ?? "GET",
      code: err?.code,
      subcode: err?.error_subcode,
      trace: err?.fbtrace_id,
    }).catch(() => undefined);
    throw new Error(msg);
  }
  return json as T;
}

export async function logMeta(
  kind: string,
  level: "info" | "warn" | "error",
  message: string,
  meta?: Record<string, unknown>,
) {
  await supabaseAdmin.from("meta_logs").insert({ kind, level, message, meta: meta ?? null });
}