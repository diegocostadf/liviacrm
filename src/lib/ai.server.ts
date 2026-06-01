import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const LOVABLE_GATEWAY = "https://ai.gateway.lovable.dev/v1";
const OPENAI_URL = "https://api.openai.com/v1";
const ANTHROPIC_URL = "https://api.anthropic.com/v1";
const GOOGLE_URL = "https://generativelanguage.googleapis.com/v1beta/openai"; // OpenAI-compatible

export type ProviderId = "lovable" | "openai" | "anthropic" | "google";

export type ProviderSettings = {
  enabled: boolean;
  apiKey?: string; // stored plain (admin-only via RLS)
  defaultModel?: string;
};

export type AIProvidersConfig = {
  default: { provider: ProviderId; model: string };
  providers: Record<ProviderId, ProviderSettings>;
};

export const DEFAULT_AI_PROVIDERS: AIProvidersConfig = {
  default: { provider: "lovable", model: "google/gemini-3-flash-preview" },
  providers: {
    lovable: { enabled: true, defaultModel: "google/gemini-3-flash-preview" },
    openai: { enabled: false, defaultModel: "gpt-5-mini" },
    anthropic: { enabled: false, defaultModel: "claude-sonnet-4-5-20250929" },
    google: { enabled: false, defaultModel: "gemini-2.5-flash" },
  },
};

export async function loadAIProviders(): Promise<AIProvidersConfig> {
  const { data } = await supabaseAdmin
    .from("app_settings")
    .select("value")
    .eq("key", "ai_providers")
    .maybeSingle();
  const value = (data?.value ?? {}) as Partial<AIProvidersConfig>;
  return {
    default: value.default ?? DEFAULT_AI_PROVIDERS.default,
    providers: { ...DEFAULT_AI_PROVIDERS.providers, ...(value.providers ?? {}) },
  };
}

function lovableKey() {
  const k = process.env.LOVABLE_API_KEY;
  if (!k) throw new Error("LOVABLE_API_KEY não está configurada.");
  return k;
}

async function providerKey(provider: ProviderId): Promise<string> {
  if (provider === "lovable") return lovableKey();
  const cfg = await loadAIProviders();
  const k = cfg.providers[provider]?.apiKey;
  if (!k) throw new Error(`Provedor "${provider}" não configurado. Vá em Configurações → Provedores de IA.`);
  return k;
}

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
};

export type ChatTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

function endpointFor(provider: ProviderId) {
  switch (provider) {
    case "lovable": return `${LOVABLE_GATEWAY}/chat/completions`;
    case "openai": return `${OPENAI_URL}/chat/completions`;
    case "anthropic": return `${ANTHROPIC_URL}/messages`;
    case "google": return `${GOOGLE_URL}/chat/completions`;
  }
}

type ChatResult = {
  choices: Array<{ message: ChatMessage; finish_reason: string }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
};

export async function chatComplete(opts: {
  provider?: ProviderId;
  model?: string;
  messages: ChatMessage[];
  tools?: ChatTool[];
  toolChoice?: "auto" | "none" | { type: "function"; function: { name: string } };
  temperature?: number;
  maxTokens?: number;
}): Promise<ChatResult> {
  const provider = opts.provider ?? "lovable";
  const model = opts.model ?? (provider === "lovable" ? "google/gemini-3-flash-preview" : (await loadAIProviders()).providers[provider]?.defaultModel ?? "");
  if (!model) throw new Error(`Modelo não definido para provedor "${provider}".`);

  if (provider === "anthropic") return chatAnthropic({ ...opts, model });

  const apiKey = await providerKey(provider);
  const body: Record<string, unknown> = { model, messages: opts.messages };
  if (opts.tools) body.tools = opts.tools;
  if (opts.toolChoice) body.tool_choice = opts.toolChoice;
  if (opts.temperature !== undefined) body.temperature = opts.temperature;
  if (opts.maxTokens !== undefined) body.max_tokens = opts.maxTokens;

  const res = await fetch(endpointFor(provider), {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 429) throw new Error(`${provider}: limite de requisições. Tente novamente.`);
    if (res.status === 402) throw new Error(`${provider}: créditos esgotados.`);
    throw new Error(`${provider} ${res.status}: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as ChatResult;
}

// Anthropic uses a different schema; we normalize to ChatResult.
async function chatAnthropic(opts: {
  model: string;
  messages: ChatMessage[];
  tools?: ChatTool[];
  temperature?: number;
  maxTokens?: number;
}): Promise<ChatResult> {
  const apiKey = await providerKey("anthropic");
  const system = opts.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const messages = opts.messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role, content: m.content }));

  const body: Record<string, unknown> = {
    model: opts.model,
    system: system || undefined,
    messages,
    max_tokens: opts.maxTokens ?? 1024,
  };
  if (opts.temperature !== undefined) body.temperature = opts.temperature;
  if (opts.tools?.length) {
    body.tools = opts.tools.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
    }));
  }

  const res = await fetch(endpointFor("anthropic"), {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`anthropic ${res.status}: ${text.slice(0, 300)}`);
  }
  const j = (await res.json()) as {
    content: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>;
    stop_reason: string;
    usage?: { input_tokens: number; output_tokens: number };
  };
  const text = j.content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
  const toolUses = j.content.filter((c) => c.type === "tool_use");
  const tool_calls = toolUses.length
    ? toolUses.map((c) => ({
        id: c.id ?? "",
        type: "function" as const,
        function: { name: c.name ?? "", arguments: JSON.stringify(c.input ?? {}) },
      }))
    : undefined;
  return {
    choices: [{
      message: { role: "assistant", content: text, tool_calls },
      finish_reason: j.stop_reason,
    }],
    usage: j.usage ? { prompt_tokens: j.usage.input_tokens, completion_tokens: j.usage.output_tokens, total_tokens: j.usage.input_tokens + j.usage.output_tokens } : undefined,
  };
}

export async function embed(input: string | string[], dimensions = 1536) {
  const res = await fetch(`${LOVABLE_GATEWAY}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${lovableKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-embedding-001",
      input,
      dimensions,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Embeddings ${res.status}: ${text.slice(0, 300)}`);
  }
  const j = (await res.json()) as { data: Array<{ embedding: number[]; index: number }> };
  return j.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

// Structured output via tool calling. Returns the parsed JSON args.
export async function extractStructured<T>(opts: {
  provider?: ProviderId;
  model?: string;
  system: string;
  user: string;
  name: string;
  description: string;
  schema: Record<string, unknown>;
  validator: z.ZodType<T>;
}): Promise<T | null> {
  const r = await chatComplete({
    provider: opts.provider,
    model: opts.model,
    temperature: 0.1,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: opts.name,
          description: opts.description,
          parameters: opts.schema,
        },
      },
    ],
    toolChoice: { type: "function", function: { name: opts.name } },
  });
  const call = r.choices?.[0]?.message?.tool_calls?.[0];
  if (!call) return null;
  try {
    const parsed = JSON.parse(call.function.arguments);
    return opts.validator.parse(parsed);
  } catch (e) {
    console.error("[extractStructured] parse error", e, call.function.arguments);
    return null;
  }
}