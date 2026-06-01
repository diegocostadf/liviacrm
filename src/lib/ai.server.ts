import { z } from "zod";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1";

function key() {
  const k = process.env.LOVABLE_API_KEY;
  if (!k) throw new Error("LOVABLE_API_KEY não está configurada.");
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

export async function chatComplete(opts: {
  model?: string;
  messages: ChatMessage[];
  tools?: ChatTool[];
  toolChoice?: "auto" | "none" | { type: "function"; function: { name: string } };
  temperature?: number;
  maxTokens?: number;
}) {
  const body: Record<string, unknown> = {
    model: opts.model ?? "google/gemini-3-flash-preview",
    messages: opts.messages,
  };
  if (opts.tools) body.tools = opts.tools;
  if (opts.toolChoice) body.tool_choice = opts.toolChoice;
  if (opts.temperature !== undefined) body.temperature = opts.temperature;
  if (opts.maxTokens !== undefined) body.max_tokens = opts.maxTokens;

  const res = await fetch(`${GATEWAY_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 429) throw new Error("Lovable AI: limite de requisições. Tente novamente em alguns segundos.");
    if (res.status === 402) throw new Error("Lovable AI: créditos esgotados. Adicione créditos em Settings → Workspace → Usage.");
    throw new Error(`Lovable AI ${res.status}: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as {
    choices: Array<{
      message: ChatMessage;
      finish_reason: string;
    }>;
    usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  };
}

export async function embed(input: string | string[], dimensions = 1536) {
  const res = await fetch(`${GATEWAY_URL}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key()}`,
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
  model?: string;
  system: string;
  user: string;
  name: string;
  description: string;
  schema: Record<string, unknown>;
  validator: z.ZodType<T>;
}): Promise<T | null> {
  const r = await chatComplete({
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