import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { loadAIProviders, chatComplete, DEFAULT_AI_PROVIDERS, type ProviderId } from "./ai.server";

async function assertAdmin(userId: string) {
  const { data: roles } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  const ok = (roles ?? []).some((r) => r.role === "admin" || r.role === "gestor");
  if (!ok) throw new Error("Acesso restrito a administradores.");
}

function maskKey(k?: string) {
  if (!k) return "";
  if (k.length <= 8) return "••••";
  return `${k.slice(0, 4)}••••${k.slice(-4)}`;
}

export const getAIProviders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const cfg = await loadAIProviders();
    return {
      default: cfg.default,
      providers: Object.fromEntries(
        (Object.entries(cfg.providers) as [ProviderId, typeof cfg.providers[ProviderId]][]).map(
          ([id, p]) => [id, { enabled: p.enabled, defaultModel: p.defaultModel ?? "", hasKey: Boolean(p.apiKey), keyPreview: maskKey(p.apiKey) }],
        ),
      ) as Record<ProviderId, { enabled: boolean; defaultModel: string; hasKey: boolean; keyPreview: string }>,
    };
  });

const providerIdSchema = z.enum(["lovable", "openai", "anthropic", "google"]);

const updateSchema = z.object({
  default: z.object({ provider: providerIdSchema, model: z.string().min(1).max(120) }),
  providers: z.record(
    providerIdSchema,
    z.object({
      enabled: z.boolean(),
      defaultModel: z.string().max(120).optional().default(""),
      apiKey: z.string().max(500).optional(), // empty/undefined = keep existing
    }),
  ),
});

export const updateAIProviders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => updateSchema.parse(d))
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const current = await loadAIProviders();
    const next = {
      default: data.default,
      providers: { ...current.providers },
    };
    for (const [id, p] of Object.entries(data.providers) as [ProviderId, { enabled: boolean; defaultModel?: string; apiKey?: string }][]) {
      next.providers[id] = {
        ...current.providers[id],
        enabled: p.enabled,
        defaultModel: p.defaultModel || current.providers[id]?.defaultModel || DEFAULT_AI_PROVIDERS.providers[id].defaultModel,
        apiKey: p.apiKey ? p.apiKey : current.providers[id]?.apiKey,
      };
    }
    const { error } = await supabaseAdmin
      .from("app_settings")
      .upsert({ key: "ai_providers", value: next, updated_by: context.userId }, { onConflict: "key" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const testSchema = z.object({
  provider: providerIdSchema,
  model: z.string().min(1).max(120),
});

export const testAIProvider = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => testSchema.parse(d))
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const t0 = Date.now();
    try {
      const r = await chatComplete({
        provider: data.provider,
        model: data.model,
        messages: [
          { role: "system", content: "Responda exatamente: OK" },
          { role: "user", content: "ping" },
        ],
        maxTokens: 16,
        temperature: 0,
      });
      const text = r.choices?.[0]?.message?.content ?? "";
      return { ok: true, latencyMs: Date.now() - t0, response: text.slice(0, 200) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e), latencyMs: Date.now() - t0 };
    }
  });