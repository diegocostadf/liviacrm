import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const listBotConfigs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { data: instances } = await supabaseAdmin
      .from("whatsapp_instances")
      .select("id, name, evolution_instance_name, status, phone_number")
      .order("created_at", { ascending: false });
    const { data: configs } = await supabaseAdmin
      .from("ai_bot_configs")
      .select("*");
    const byInst = new Map((configs ?? []).map((c) => [c.instance_id, c]));
    return (instances ?? []).map((inst) => ({
      instance: inst,
      config: byInst.get(inst.id) ?? null,
    }));
  });

const upsertSchema = z.object({
  instance_id: z.string().uuid(),
  enabled: z.boolean(),
  persona: z.string().min(10).max(4000),
  goal: z.string().min(5).max(2000),
  tone: z.string().min(2).max(500),
  language: z.string().min(2).max(10),
  group_link: z.string().url().nullable().optional(),
  landing_link: z.string().url().nullable().optional(),
  out_of_hours_message: z.string().max(500).nullable().optional(),
  handoff_keywords: z.array(z.string().min(1).max(40)).max(20).optional(),
  business_hours: z.object({
    start_hour: z.number().int().min(0).max(23).optional(),
    end_hour: z.number().int().min(0).max(23).optional(),
    enabled: z.boolean().optional(),
  }).optional(),
});

export const upsertBotConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => upsertSchema.parse(d))
  .handler(async ({ data }) => {
    const payload = {
      instance_id: data.instance_id,
      enabled: data.enabled,
      persona: data.persona,
      goal: data.goal,
      tone: data.tone,
      language: data.language,
      group_link: data.group_link ?? null,
      landing_link: data.landing_link ?? null,
      out_of_hours_message: data.out_of_hours_message ?? null,
      handoff_keywords: data.handoff_keywords ?? [],
      business_hours: data.business_hours ?? {},
    };
    const { data: existing } = await supabaseAdmin
      .from("ai_bot_configs")
      .select("id")
      .eq("instance_id", data.instance_id)
      .maybeSingle();
    if (existing) {
      const { error } = await supabaseAdmin.from("ai_bot_configs").update(payload).eq("id", existing.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabaseAdmin.from("ai_bot_configs").insert(payload);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const toggleConversationBot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ conversationId: z.string().uuid(), active: z.boolean() }).parse(d))
  .handler(async ({ data }) => {
    const { error } = await supabaseAdmin
      .from("conversations")
      .update({ bot_active: data.active })
      .eq("id", data.conversationId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listIntentEvents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ conversationId: z.string().uuid(), limit: z.number().int().min(1).max(50).default(10) }).parse(d))
  .handler(async ({ data }) => {
    const { data: events, error } = await supabaseAdmin
      .from("lead_intent_events")
      .select("*")
      .eq("conversation_id", data.conversationId)
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (error) throw new Error(error.message);
    return events ?? [];
  });