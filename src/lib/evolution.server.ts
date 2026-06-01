import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type EvolutionInit = RequestInit & { json?: unknown };

export type EvolutionSettings = {
  apiUrl: string;
  apiKey: string;
  webhookUrl?: string;
  webhookToken?: string;
  webhookEvents?: string[];
  defaultInstance?: string;
};

let cached: { value: EvolutionSettings; at: number } | null = null;
const TTL_MS = 10_000;

export function invalidateEvolutionSettingsCache() {
  cached = null;
}

function normalizeApiUrl(raw: string): string {
  let url = (raw ?? "").trim().replace(/\/$/, "");
  // O painel web do Evolution fica em /manager; a API REST fica na raiz.
  url = url.replace(/\/manager(\/.*)?$/i, "");
  return url;
}

export async function loadEvolutionSettings(): Promise<EvolutionSettings> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
  let dbVal: Partial<EvolutionSettings> = {};
  try {
    const { data } = await supabaseAdmin
      .from("app_settings")
      .select("value")
      .eq("key", "evolution")
      .maybeSingle();
    if (data?.value && typeof data.value === "object") {
      dbVal = data.value as Partial<EvolutionSettings>;
    }
  } catch { /* fallback to env */ }

  const value: EvolutionSettings = {
    apiUrl: normalizeApiUrl(dbVal.apiUrl ?? process.env.EVOLUTION_API_URL ?? ""),
    apiKey: dbVal.apiKey ?? process.env.EVOLUTION_API_KEY ?? "",
    webhookUrl: dbVal.webhookUrl ?? undefined,
    webhookToken: dbVal.webhookToken ?? process.env.EVOLUTION_WEBHOOK_TOKEN ?? undefined,
    webhookEvents: dbVal.webhookEvents,
    defaultInstance: typeof dbVal.defaultInstance === "string" ? dbVal.defaultInstance : undefined,
  };
  cached = { value, at: Date.now() };
  return value;
}

async function getConfig() {
  const { apiUrl, apiKey } = await loadEvolutionSettings();
  if (!apiUrl) throw new Error("URL do Evolution não configurada. Configure em Configurações → Evolution API.");
  if (!apiKey) throw new Error("API Key do Evolution não configurada. Configure em Configurações → Evolution API.");
  if (!/^https?:\/\//.test(apiUrl)) {
    throw new Error(`URL inválida (deve começar com http:// ou https://). Valor atual: "${apiUrl}"`);
  }
  return { base: apiUrl, key: apiKey };
}

export async function evolutionFetch(path: string, init: EvolutionInit = {}) {
  const { base, key } = await getConfig();
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = new Headers(init.headers);
  headers.set("apikey", key);
  headers.set("Content-Type", "application/json");
  const body = init.json !== undefined ? JSON.stringify(init.json) : init.body;
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers, body });
  } catch (e) {
    throw new Error(`Falha de rede ao chamar Evolution (${url}): ${e instanceof Error ? e.message : String(e)}`);
  }
  const text = await res.text();
  let parsed: unknown = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  if (!res.ok) {
    const msg = typeof parsed === "object" && parsed && "message" in parsed
      ? String((parsed as { message: unknown }).message)
      : `Evolution API ${res.status} em ${path}: ${text.slice(0, 300)}`;
    throw new Error(msg);
  }
  return parsed;
}

export async function getWebhookToken() {
  const { webhookToken } = await loadEvolutionSettings();
  return webhookToken ?? "";
}

export async function pingEvolution() {
  const { base } = await getConfig();
  const started = Date.now();
  // GET /  on Evolution returns version info; falls back to /instance/fetchInstances
  try {
    const info = (await evolutionFetch("/")) as Record<string, unknown>;
    return {
      ok: true as const,
      latencyMs: Date.now() - started,
      baseUrl: base,
      version: (info?.version as string) ?? null,
      message: (info?.message as string) ?? null,
    };
  } catch (e) {
    // tenta endpoint autenticado para distinguir URL ruim de chave ruim
    try {
      await evolutionFetch("/instance/fetchInstances");
      return { ok: true as const, latencyMs: Date.now() - started, baseUrl: base, version: null, message: "Autenticado." };
    } catch (e2) {
      throw new Error(e2 instanceof Error ? e2.message : String(e2));
    }
  }
}