import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type ZapiSettings = {
  instanceId: string;
  instanceToken: string;
  clientToken: string;
  webhookUrl?: string;
};

let cached: { value: ZapiSettings; at: number } | null = null;
const TTL_MS = 10_000;

export function invalidateZapiSettingsCache() {
  cached = null;
}

export async function loadZapiSettings(): Promise<ZapiSettings> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
  const { data } = await supabaseAdmin
    .from("app_settings")
    .select("value")
    .eq("key", "zapi")
    .maybeSingle();
  const v = (data?.value ?? {}) as Partial<ZapiSettings>;
  const value: ZapiSettings = {
    instanceId: (v.instanceId ?? "").trim(),
    instanceToken: (v.instanceToken ?? "").trim(),
    clientToken: (v.clientToken ?? "").trim(),
    webhookUrl: typeof v.webhookUrl === "string" ? v.webhookUrl : undefined,
  };
  cached = { value, at: Date.now() };
  return value;
}

function baseUrl(s: ZapiSettings) {
  if (!s.instanceId) throw new Error("Z-API: Instance ID não configurado.");
  if (!s.instanceToken) throw new Error("Z-API: Instance Token não configurado.");
  return `https://api.z-api.io/instances/${s.instanceId}/token/${s.instanceToken}`;
}

export async function zapiFetch(path: string, init: RequestInit & { json?: unknown } = {}) {
  const s = await loadZapiSettings();
  const url = `${baseUrl(s)}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (s.clientToken) headers.set("Client-Token", s.clientToken);
  const body = init.json !== undefined ? JSON.stringify(init.json) : init.body;
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers, body });
  } catch (e) {
    throw new Error(`Falha de rede ao chamar Z-API (${url}): ${e instanceof Error ? e.message : String(e)}`);
  }
  const text = await res.text();
  let parsed: unknown = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  if (!res.ok) {
    const msg = typeof parsed === "object" && parsed && "error" in parsed
      ? String((parsed as { error: unknown }).error)
      : `Z-API ${res.status} em ${path}: ${text.slice(0, 300)}`;
    throw new Error(msg);
  }
  return parsed;
}

export async function pingZapi() {
  const started = Date.now();
  const r = (await zapiFetch("/status")) as Record<string, unknown>;
  return {
    ok: true as const,
    latencyMs: Date.now() - started,
    connected: Boolean(r?.connected),
    session: (r?.session as string) ?? null,
    smartphoneConnected: Boolean(r?.smartphoneConnected),
    raw: r,
  };
}

export async function zapiSendText(toPhone: string, message: string): Promise<{ id: string | null }> {
  const phone = String(toPhone ?? "").replace(/\D/g, "");
  if (!phone) throw new Error("Telefone destino inválido.");
  const r = (await zapiFetch("/send-text", {
    method: "POST",
    json: { phone, message },
  })) as { messageId?: string; id?: string; zaapId?: string };
  return { id: r.messageId ?? r.id ?? r.zaapId ?? null };
}