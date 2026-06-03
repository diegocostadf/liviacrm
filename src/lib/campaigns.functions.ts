import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { tickCampaign, renderTemplate } from "./campaigns.server";

export const listCampaigns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { data, error } = await supabaseAdmin
      .from("campaigns")
      .select("id, name, status, instance_id, template, total_count, sent_count, failed_count, replied_count, created_at, scheduled_at, completed_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

const createSchema = z.object({
  name: z.string().trim().min(2).max(120),
  instance_id: z.string().uuid(),
  template: z.string().trim().min(2).max(4000),
  throttle_min_seconds: z.number().int().min(2).max(600).default(30),
  throttle_max_seconds: z.number().int().min(2).max(600).default(45),
  window_start_hour: z.number().int().min(0).max(23).default(8),
  window_end_hour: z.number().int().min(0).max(23).default(21),
});

/** Regras de SLA / disparo aceitas em update/patch. */
const rulesSchema = z.object({
  allowed_weekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  max_per_hour: z.number().int().min(1).max(10000).optional(),
  max_per_day: z.number().int().min(1).max(1000000).optional(),
  pause_on_reply: z.boolean().optional(),
  dedupe_skip_days: z.number().int().min(0).max(365).optional(),
  allowed_instance_ids: z.array(z.string().uuid()).max(20).optional(),
  retry_max_attempts: z.number().int().min(1).max(10).optional(),
  retry_backoff_seconds: z.number().int().min(10).max(3600).optional(),
});

export const createCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => createSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { data: inserted, error } = await supabaseAdmin
      .from("campaigns")
      .insert({
        name: data.name,
        instance_id: data.instance_id,
        template: data.template,
        throttle_min_seconds: data.throttle_min_seconds,
        throttle_max_seconds: Math.max(data.throttle_min_seconds, data.throttle_max_seconds),
        window_start_hour: data.window_start_hour,
        window_end_hour: data.window_end_hour,
        status: "draft",
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (error || !inserted) throw new Error(error?.message ?? "Falha ao criar campanha");
    return { id: inserted.id };
  });

const updateSchema = createSchema.partial().merge(rulesSchema).extend({ id: z.string().uuid() });

export const updateCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => updateSchema.parse(d))
  .handler(async ({ data }) => {
    const { id, ...patch } = data;
    const { error } = await supabaseAdmin.from("campaigns").update(patch).eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    await supabaseAdmin.from("campaign_targets").delete().eq("campaign_id", data.id);
    const { error } = await supabaseAdmin.from("campaigns").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { data: campaign, error } = await supabaseAdmin
      .from("campaigns")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!campaign) throw new Error("Campanha não encontrada");

    const { data: targets } = await supabaseAdmin
      .from("campaign_targets")
      .select("id, phone, name, status, sent_at, error, attempts, custom_fields, rendered_message")
      .eq("campaign_id", data.id)
      .order("created_at", { ascending: true })
      .limit(500);
    const { count: pendingCount } = await supabaseAdmin
      .from("campaign_targets")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", data.id)
      .eq("status", "pending");
    return { campaign, targets: targets ?? [], pendingCount: pendingCount ?? 0 };
  });

const targetItemSchema = z.object({
  phone: z.string().trim().min(6).max(40),
  name: z.string().trim().max(120).optional().nullable(),
  custom_fields: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});

const initialIntentSchema = z.enum([
  "interessado",
  "inscrito",
  "objecao",
  "sem_interesse",
  "silencio",
  "fora_escopo",
  "lead_quente",
]);

function intentToStatus(intent: z.infer<typeof initialIntentSchema>): "novo" | "engajado" | "inscrito" | "perdido" {
  if (intent === "inscrito") return "inscrito";
  if (intent === "sem_interesse") return "perdido";
  if (intent === "lead_quente" || intent === "interessado" || intent === "objecao") return "engajado";
  return "novo";
}

function intentToTemperature(intent: z.infer<typeof initialIntentSchema>): "frio" | "morno" | "quente" {
  if (intent === "lead_quente" || intent === "interessado") return "quente";
  if (intent === "inscrito" || intent === "objecao") return "morno";
  return "frio";
}

export const addCampaignTargets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      campaignId: z.string().uuid(),
      targets: z.array(targetItemSchema).min(1).max(5000),
      dedupe: z.boolean().default(true),
      initial_intent: initialIntentSchema.default("silencio"),
      overwrite_intent: z.boolean().default(false),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const norm = (s: string) => s.replace(/\D/g, "");
    let items = data.targets
      .map((t) => ({
        campaign_id: data.campaignId,
        phone: norm(t.phone),
        name: t.name ?? null,
        custom_fields: t.custom_fields ?? {},
        status: "pending" as const,
      }))
      .filter((t) => t.phone.length >= 8);

    if (data.dedupe) {
      const seen = new Set<string>();
      items = items.filter((t) => {
        if (seen.has(t.phone)) return false;
        seen.add(t.phone);
        return true;
      });
      const { data: existing } = await supabaseAdmin
        .from("campaign_targets")
        .select("phone")
        .eq("campaign_id", data.campaignId);
      const existingSet = new Set((existing ?? []).map((e) => e.phone));
      items = items.filter((t) => !existingSet.has(t.phone));
    }

    if (!items.length) return { inserted: 0 };

    // Insert in chunks of 500
    let inserted = 0;
    for (let i = 0; i < items.length; i += 500) {
      const chunk = items.slice(i, i + 500);
      const { error } = await supabaseAdmin.from("campaign_targets").insert(chunk);
      if (error) throw new Error(error.message);
      inserted += chunk.length;
    }

    // ===== CRM: upsert de contatos + classificação inicial =====
    const phonesByName = new Map<string, string | null>();
    for (const t of items) phonesByName.set(t.phone, t.name);
    const allPhones = [...phonesByName.keys()];

    const { data: existingContacts } = await supabaseAdmin
      .from("contacts")
      .select("id, phone")
      .in("phone", allPhones);
    const existingByPhone = new Map((existingContacts ?? []).map((c) => [c.phone, c.id]));

    // 1) Cria contatos novos
    const toCreate = allPhones
      .filter((p) => !existingByPhone.has(p))
      .map((p) => ({
        phone: p,
        name: phonesByName.get(p),
        source: "campaign_import",
        lead_status: intentToStatus(data.initial_intent),
      }));
    if (toCreate.length) {
      for (let i = 0; i < toCreate.length; i += 500) {
        const chunk = toCreate.slice(i, i + 500);
        const { data: ins } = await supabaseAdmin
          .from("contacts")
          .insert(chunk)
          .select("id, phone");
        for (const row of ins ?? []) existingByPhone.set(row.phone, row.id);
      }
    }

    // 2) Decide quem recebe novo lead_intent_event (sempre para novos; opt-in para existentes)
    const recipientsForEvent: Array<{ phone: string; id: string }> = [];
    for (const p of allPhones) {
      const id = existingByPhone.get(p);
      if (!id) continue;
      const wasNew = !existingContacts?.some((c) => c.phone === p);
      if (wasNew || data.overwrite_intent) {
        recipientsForEvent.push({ phone: p, id });
      }
    }

    // 3) Insere lead_intent_events (trigger cuida do last_intent)
    // Precisa de conversation_id NOT NULL — usa "synthetic" via primeira conversa existente
    // OU pula esse insert se a tabela exige conversa. Para evitar erro, criamos eventos APENAS
    // se já existir uma conversa do contato. Para os demais, atualizamos last_intent diretamente.
    if (recipientsForEvent.length) {
      const contactIds = recipientsForEvent.map((r) => r.id);
      const { data: convs } = await supabaseAdmin
        .from("conversations")
        .select("id, contact_id")
        .in("contact_id", contactIds);
      const convByContact = new Map((convs ?? []).map((c) => [c.contact_id, c.id]));

      const events = recipientsForEvent
        .filter((r) => convByContact.has(r.id))
        .map((r) => ({
          conversation_id: convByContact.get(r.id) as string,
          contact_id: r.id,
          intent: data.initial_intent,
          temperature: intentToTemperature(data.initial_intent),
          score: data.initial_intent === "lead_quente" ? 80 : 0,
          model: "import:csv",
          summary: "Classificação inicial via importação de campanha",
        }));
      if (events.length) {
        await supabaseAdmin.from("lead_intent_events").insert(events);
      }

      // Para contatos sem conversa, atualiza last_intent + lead_status diretamente
      const directIds = recipientsForEvent.filter((r) => !convByContact.has(r.id)).map((r) => r.id);
      if (directIds.length) {
        await supabaseAdmin
          .from("contacts")
          .update({
            last_intent: data.initial_intent,
            last_intent_at: new Date().toISOString(),
            lead_status: intentToStatus(data.initial_intent),
          })
          .in("id", directIds);
      }
    }
    // ===== /CRM =====

    const { count } = await supabaseAdmin
      .from("campaign_targets")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", data.campaignId);
    await supabaseAdmin.from("campaigns").update({ total_count: count ?? 0 }).eq("id", data.campaignId);

    return { inserted };
  });

export const removeCampaignTarget = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid(), campaignId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    await supabaseAdmin.from("campaign_targets").delete().eq("id", data.id);
    const { count } = await supabaseAdmin
      .from("campaign_targets")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", data.campaignId);
    await supabaseAdmin.from("campaigns").update({ total_count: count ?? 0 }).eq("id", data.campaignId);
    return { ok: true };
  });

export const setCampaignStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      id: z.string().uuid(),
      status: z.enum(["draft", "running", "paused", "completed", "scheduled", "failed"]),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const patch: {
      status: typeof data.status;
      started_at?: string;
      completed_at?: string;
    } = { status: data.status };
    if (data.status === "running") patch.started_at = new Date().toISOString();
    if (data.status === "completed" || data.status === "failed") {
      patch.completed_at = new Date().toISOString();
    }
    const { error } = await supabaseAdmin.from("campaigns").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const tickCampaignFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ id: z.string().uuid(), batch: z.number().int().min(1).max(5).default(1) }).parse(d),
  )
  .handler(async ({ data }) => {
    return tickCampaign(data.id, data.batch);
  });

export const previewCampaignMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      template: z.string().min(1).max(4000),
      fields: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    return { preview: renderTemplate(data.template, data.fields) };
  });