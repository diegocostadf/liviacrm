export type EvolutionInit = RequestInit & { json?: unknown };

function getConfig() {
  const base = (process.env.EVOLUTION_API_URL ?? "").replace(/\/$/, "");
  const key = process.env.EVOLUTION_API_KEY ?? "";
  if (!base) throw new Error("EVOLUTION_API_URL não configurada nos secrets do projeto.");
  if (!key) throw new Error("EVOLUTION_API_KEY não configurada nos secrets do projeto.");
  if (!/^https?:\/\//.test(base)) {
    throw new Error(`EVOLUTION_API_URL inválida (deve começar com http:// ou https://). Valor atual: "${base}"`);
  }
  return { base, key };
}

export async function evolutionFetch(path: string, init: EvolutionInit = {}) {
  const { base, key } = getConfig();
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

export function getWebhookToken() {
  return process.env.EVOLUTION_WEBHOOK_TOKEN ?? "";
}

export async function pingEvolution() {
  const { base } = getConfig();
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