import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const BOT_DEFAULTS = {
  persona:
    "Você é Júlia, assistente de vendas amigável e direta da Russomano Educação. Responde rápido, sem jargão.",
  goal: "Qualificar o lead, tirar dúvidas com base na Base de Conhecimento e enviar o link certo para conversão.",
  tone: "amigável, breve, sem jargão",
  language: "pt-BR",
  modelProvider: "lovable" as const,
  modelName: "google/gemini-3-flash-preview",
};

async function getSupabaseAdmin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function assertCanManageBot(userId: string) {
  const supabaseAdmin = await getSupabaseAdmin();
  const { data: roles } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  const ok = (roles ?? []).some((r) => r.role === "admin" || r.role === "gestor");
  if (!ok) throw new Error("Acesso restrito a administradores e gestores.");
}

function textOrFallback(value: string | undefined, fallback: string) {
  const text = (value ?? "").trim();
  return text || fallback;
}

function nullableText(value: string | null | undefined) {
  const text = (value ?? "").trim();
  return text ? (value ?? text) : null;
}

const nullableUrl = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}, z.string().url("Informe um link válido começando com http:// ou https://").nullable().optional());

export const listBotConfigs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const supabaseAdmin = await getSupabaseAdmin();
    const { data: instances } = await supabaseAdmin
      .from("whatsapp_instances")
      .select("id, name, evolution_instance_name, status, phone_number")
      .order("created_at", { ascending: false });
    const { data: configs } = await supabaseAdmin.from("ai_bot_configs").select("*");
    const byInst = new Map((configs ?? []).map((c) => [c.instance_id, c]));
    return (instances ?? []).map((inst) => ({
      instance: inst,
      config: byInst.get(inst.id) ?? null,
    }));
  });

const upsertSchema = z.object({
  instance_id: z.string().uuid(),
  enabled: z.boolean(),
  persona: z.string().max(10000).default(""),
  goal: z.string().max(10000).default(""),
  tone: z.string().max(1000).default(""),
  language: z.string().max(20).default(""),
  model_provider: z
    .enum(["lovable", "openai", "anthropic", "google"])
    .default(BOT_DEFAULTS.modelProvider),
  model_name: z.string().max(120).default(BOT_DEFAULTS.modelName),
  temperature: z.coerce.number().min(0).max(2).default(0.4),
  max_tokens: z.coerce.number().int().min(64).max(8000).default(1024),
  system_extra: z.string().max(20000).nullable().optional(),
  system_prompt_md: z.string().max(100000).nullable().optional(),
  group_link: nullableUrl,
  landing_link: nullableUrl,
  out_of_hours_message: z.string().max(2000).nullable().optional(),
  handoff_keywords: z.array(z.string().min(1).max(40)).max(20).optional(),
  handoff_phone: z.string().max(40).nullable().optional(),
  typing_indicator: z.boolean().optional(),
  business_hours: z
    .object({
      start_hour: z.coerce.number().int().min(0).max(23).optional(),
      end_hour: z.coerce.number().int().min(0).max(23).optional(),
      enabled: z.boolean().optional(),
    })
    .optional(),
});

export const upsertBotConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => upsertSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertCanManageBot(context.userId);
    const supabaseAdmin = await getSupabaseAdmin();
    const payload = {
      instance_id: data.instance_id,
      enabled: data.enabled,
      persona: textOrFallback(data.persona, BOT_DEFAULTS.persona),
      goal: textOrFallback(data.goal, BOT_DEFAULTS.goal),
      tone: textOrFallback(data.tone, BOT_DEFAULTS.tone),
      language: textOrFallback(data.language, BOT_DEFAULTS.language),
      model_provider: data.model_provider,
      model_name: textOrFallback(data.model_name, BOT_DEFAULTS.modelName),
      temperature: data.temperature,
      max_tokens: data.max_tokens,
      system_extra: nullableText(data.system_extra),
      system_prompt_md: nullableText(data.system_prompt_md),
      group_link: data.group_link ?? null,
      landing_link: data.landing_link ?? null,
      out_of_hours_message: nullableText(data.out_of_hours_message),
      handoff_keywords: (data.handoff_keywords ?? []).map((kw) => kw.trim()).filter(Boolean),
      handoff_phone: nullableText(data.handoff_phone),
      typing_indicator: data.typing_indicator ?? true,
      business_hours: data.business_hours ?? {},
      updated_at: new Date().toISOString(),
    };
    const { data: saved, error } = await supabaseAdmin
      .from("ai_bot_configs")
      .upsert(payload as never, { onConflict: "instance_id" })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return { ok: true, config: saved };
  });

export const toggleConversationBot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ conversationId: z.string().uuid(), active: z.boolean() }).parse(d),
  )
  .handler(async ({ data }) => {
    const supabaseAdmin = await getSupabaseAdmin();
    const { error } = await supabaseAdmin
      .from("conversations")
      .update({ bot_active: data.active })
      .eq("id", data.conversationId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const resetConversationBot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ conversationId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const supabaseAdmin = await getSupabaseAdmin();
    const now = new Date().toISOString();
    const { error } = await supabaseAdmin
      .from("conversations")
      .update({
        bot_context_reset_at: now,
        bot_active: true,
        intent_temperature: null,
      })
      .eq("id", data.conversationId);
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("internal_notes").insert({
      conversation_id: data.conversationId,
      content: "🔄 Bot reiniciado via /resetar — histórico anterior será ignorado.",
      author_id: context.userId,
    });
    return { ok: true };
  });

export const listIntentEvents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        conversationId: z.string().uuid(),
        limit: z.number().int().min(1).max(50).default(10),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const supabaseAdmin = await getSupabaseAdmin();
    const { data: events, error } = await supabaseAdmin
      .from("lead_intent_events")
      .select("*")
      .eq("conversation_id", data.conversationId)
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (error) throw new Error(error.message);
    return events ?? [];
  });
