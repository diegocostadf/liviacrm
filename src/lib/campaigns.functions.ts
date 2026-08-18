import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { tickCampaign, renderTemplate } from "./campaigns.server";

const DB_PAGE_SIZE = 1000;

async function fetchExistingTargetPhones(campaignId: string) {
  const phones: string[] = [];
  for (let from = 0; ; from += DB_PAGE_SIZE) {
    const { data, error } = await supabaseAdmin
      .from("campaign_targets")
      .select("phone")
      .eq("campaign_id", campaignId)
      .order("created_at", { ascending: true })
      .range(from, from + DB_PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    phones.push(...(data ?? []).map((row) => row.phone));
    if (!data || data.length < DB_PAGE_SIZE) break;
  }
  return phones;
}

async function fetchExistingContactsByPhones(phones: string[]) {
  const rows: Array<{ id: string; phone: string }> = [];
  const uniquePhones = [...new Set(phones)];
  for (let i = 0; i < uniquePhones.length; i += 500) {
    const { data, error } = await supabaseAdmin
      .from("contacts")
      .select("id, phone")
      .in("phone", uniquePhones.slice(i, i + 500));
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
  }
  return rows;
}

async function fetchConversationsByContactIds(contactIds: string[]) {
  const rows: Array<{ id: string; contact_id: string }> = [];
  const uniqueIds = [...new Set(contactIds)];
  for (let i = 0; i < uniqueIds.length; i += 500) {
    const { data, error } = await supabaseAdmin
      .from("conversations")
      .select("id, contact_id")
      .in("contact_id", uniqueIds.slice(i, i + 500));
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
  }
  return rows;
}

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
  instance_id: z.string().uuid().nullable().optional(),
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
  opt_out_keywords: z.array(z.string().trim().min(1).max(40)).max(30).optional(),
});

export const createCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => createSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { data: inserted, error } = await supabaseAdmin
      .from("campaigns")
      .insert({
        name: data.name,
        instance_id: data.instance_id ?? null,
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

const updateSchema = createSchema.partial().merge(rulesSchema).extend({
  id: z.string().uuid(),
  cloud_template_id: z.string().uuid().nullable().optional(),
  cloud_template_variables: z.record(z.string(), z.string()).optional(),
});

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
  .inputValidator((d) => z.object({
    id: z.string().uuid(),
    targetPage: z.number().int().min(1).default(1),
    targetPageSize: z.number().int().min(1).max(200).default(100),
  }).parse(d))
  .handler(async ({ data }) => {
    const from = (data.targetPage - 1) * data.targetPageSize;
    const to = from + data.targetPageSize - 1;
    const { data: campaign, error } = await supabaseAdmin
      .from("campaigns")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!campaign) throw new Error("Campanha não encontrada");

    const { data: targets, error: targetsError } = await supabaseAdmin
      .from("campaign_targets")
      .select("id, phone, name, status, sent_at, error, attempts, custom_fields, rendered_message")
      .eq("campaign_id", data.id)
      .order("created_at", { ascending: true })
      .range(from, to);
    if (targetsError) throw new Error(targetsError.message);
    const [{ count: targetCount }, { count: pendingCount }] = await Promise.all([
      supabaseAdmin
        .from("campaign_targets")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", data.id),
      supabaseAdmin
        .from("campaign_targets")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", data.id)
        .eq("status", "pending"),
    ]);
    return {
      campaign,
      targets: targets ?? [],
      targetCount: targetCount ?? 0,
      pendingCount: pendingCount ?? 0,
      targetPage: data.targetPage,
      targetPageSize: data.targetPageSize,
    };
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
      const existingSet = new Set(await fetchExistingTargetPhones(data.campaignId));
      items = items.filter((t) => !existingSet.has(t.phone));
    }

    if (!items.length) return { inserted: 0 };

    // ===== CRM: upsert de contatos + classificação inicial =====
    const phonesByName = new Map<string, string | null>();
    for (const t of items) phonesByName.set(t.phone, t.name);
    const allPhones = [...phonesByName.keys()];

    const existingContacts = await fetchExistingContactsByPhones(allPhones);
    const existingByPhone = new Map(existingContacts.map((c) => [c.phone, c.id]));

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

    // Insere destinatários já vinculados ao contato do CRM.
    let inserted = 0;
    const targetsToInsert = items.map((t) => ({ ...t, contact_id: existingByPhone.get(t.phone) ?? null }));
    for (let i = 0; i < targetsToInsert.length; i += 500) {
      const chunk = targetsToInsert.slice(i, i + 500);
      const { error } = await supabaseAdmin.from("campaign_targets").insert(chunk);
      if (error) throw new Error(error.message);
      inserted += chunk.length;
    }

    // 2) Decide quem recebe novo lead_intent_event (sempre para novos; opt-in para existentes)
    const recipientsForEvent: Array<{ phone: string; id: string }> = [];
    for (const p of allPhones) {
      const id = existingByPhone.get(p);
      if (!id) continue;
      const wasNew = !existingContacts.some((c) => c.phone === p);
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
      const convs = await fetchConversationsByContactIds(contactIds);
      const convByContact = new Map(convs.map((c) => [c.contact_id, c.id]));

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

/* ============================================================
 * Seleção de leads existentes (CRM) para virar destinatários
 * ============================================================ */

const TEMPERATURE_TO_INTENTS: Record<"frio" | "morno" | "quente", string[]> = {
  quente: ["lead_quente", "interessado"],
  morno: ["inscrito", "objecao"],
  frio: ["silencio", "sem_interesse", "fora_escopo"],
};

const crmFilterSchema = z.object({
  search: z.string().trim().max(120).optional(),
  lead_status: z.enum(["novo", "engajado", "inscrito", "perdido"]).optional(),
  temperature: z.enum(["frio", "morno", "quente"]).optional(),
  tags_any: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  states: z.array(z.string().trim().min(1).max(40)).max(50).optional(),
  cities: z.array(z.string().trim().min(1).max(120)).max(300).optional(),
  source: z.string().trim().max(120).optional(),
  assigned_to: z.string().uuid().nullable().optional(),
  exclude_opted_out: z.boolean().default(true),
  exclude_journey_completed: z.boolean().default(false),
  has_email: z.boolean().optional(),
  created_after: z.string().datetime().optional(),
  created_before: z.string().datetime().optional(),
});

type CrmFilter = z.infer<typeof crmFilterSchema>;

function applyCrmFilter<T extends { eq: any; in: any; or: any; contains: any; overlaps: any; not: any; gte: any; lte: any }>(q: T, f: CrmFilter): T {
  let r: any = q;
  if (f.lead_status) r = r.eq("lead_status", f.lead_status);
  if (f.temperature) r = r.in("last_intent", TEMPERATURE_TO_INTENTS[f.temperature]);
  if (f.tags_any?.length) r = r.overlaps("tags", f.tags_any);
  if (f.states?.length) r = r.in("state", f.states);
  if (f.cities?.length) r = r.in("city", f.cities);
  if (f.source) r = r.eq("source", f.source);
  if (f.assigned_to === null) r = r.is("assigned_to", null);
  else if (f.assigned_to) r = r.eq("assigned_to", f.assigned_to);
  if (f.exclude_opted_out) r = r.eq("opted_out", false);
  if (f.exclude_journey_completed) r = r.eq("journey_completed", false);
  if (f.has_email === true) r = r.not("email", "is", null);
  if (f.has_email === false) r = r.is("email", null);
  if (f.created_after) r = r.gte("created_at", f.created_after);
  if (f.created_before) r = r.lte("created_at", f.created_before);
  if (f.search) {
    const s = f.search.replace(/[%_]/g, "");
    r = r.or(`name.ilike.%${s}%,phone.ilike.%${s}%,email.ilike.%${s}%,company.ilike.%${s}%,city.ilike.%${s}%`);
  }
  return r as T;
}

export const previewCrmFilter = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    campaignId: z.string().uuid(),
    filter: crmFilterSchema,
  }).parse(d))
  .handler(async ({ data }) => {
    const base = supabaseAdmin
      .from("contacts")
      .select("id", { count: "exact", head: true });
    const q = applyCrmFilter(base as any, data.filter);
    const { count, error } = await q;
    if (error) throw new Error(error.message);

    // Sample (max 8) p/ visual
    const sampleBase = supabaseAdmin
      .from("contacts")
      .select("id, name, phone, city, state, tags, lead_status, last_intent")
      .order("updated_at", { ascending: false })
      .limit(8);
    const sampleQ = applyCrmFilter(sampleBase as any, data.filter);
    const { data: sample } = await sampleQ;

    // Existentes já na campanha → estimativa de "novos"
    const existing = new Set(await fetchExistingTargetPhones(data.campaignId));
    return {
      total: count ?? 0,
      sample: sample ?? [],
      alreadyInCampaign: existing.size,
    };
  });

export const addCampaignTargetsFromCrm = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    campaignId: z.string().uuid(),
    filter: crmFilterSchema,
    initial_intent: initialIntentSchema.default("silencio"),
    overwrite_intent: z.boolean().default(false),
    max: z.number().int().min(1).max(200000).optional(),
  }).parse(d))
  .handler(async ({ data }) => {
    // Já cadastrados na campanha
    const existing = new Set(await fetchExistingTargetPhones(data.campaignId));
    const cap = data.max ?? 200000;

    // Pagina contacts em blocos de 1000
    const collected: Array<{ id: string; phone: string; name: string | null }> = [];
    const PAGE = 1000;
    for (let from = 0; collected.length < cap; from += PAGE) {
      const base = supabaseAdmin
        .from("contacts")
        .select("id, phone, name")
        .order("created_at", { ascending: true })
        .range(from, from + PAGE - 1);
      const q = applyCrmFilter(base as any, data.filter);
      const { data: rows, error } = await q;
      if (error) throw new Error(error.message);
      const batch = rows ?? [];
      for (const r of batch) {
        if (!r.phone) continue;
        if (existing.has(r.phone)) continue;
        existing.add(r.phone);
        collected.push({ id: r.id, phone: r.phone, name: r.name ?? null });
        if (collected.length >= cap) break;
      }
      if (batch.length < PAGE) break;
    }

    if (!collected.length) return { inserted: 0, matched: 0 };

    // Insere campaign_targets já com contact_id resolvido
    const targets = collected.map((c) => ({
      campaign_id: data.campaignId,
      contact_id: c.id,
      phone: c.phone,
      name: c.name,
      custom_fields: {},
      status: "pending" as const,
    }));
    let inserted = 0;
    for (let i = 0; i < targets.length; i += 500) {
      const chunk = targets.slice(i, i + 500);
      const { error } = await supabaseAdmin.from("campaign_targets").insert(chunk);
      if (error) throw new Error(error.message);
      inserted += chunk.length;
    }

    // Atualiza classificação se solicitado
    if (data.overwrite_intent) {
      const ids = collected.map((c) => c.id);
      for (let i = 0; i < ids.length; i += 500) {
        await supabaseAdmin
          .from("contacts")
          .update({
            last_intent: data.initial_intent,
            last_intent_at: new Date().toISOString(),
            lead_status: intentToStatus(data.initial_intent),
          })
          .in("id", ids.slice(i, i + 500));
      }
    }

    // Atualiza total da campanha
    const { count } = await supabaseAdmin
      .from("campaign_targets")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", data.campaignId);
    await supabaseAdmin.from("campaigns").update({ total_count: count ?? 0 }).eq("id", data.campaignId);

    return { inserted, matched: collected.length };
  });

/** Lista facets (states/cities/tags) disponíveis nos contatos do CRM. */
export const listCrmFacets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    // Lê em páginas para evitar limite de 1000 do PostgREST
    const PAGE = 1000;
    const states = new Map<string, number>();
    const cities = new Map<string, { uf: string | null; count: number }>();
    const tags = new Map<string, number>();
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabaseAdmin
        .from("contacts")
        .select("state, city, tags")
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      const rows = data ?? [];
      for (const r of rows) {
        const uf = (r.state ?? "").trim().toUpperCase();
        const ci = (r.city ?? "").trim();
        if (uf) states.set(uf, (states.get(uf) ?? 0) + 1);
        if (ci) {
          const key = ci;
          const prev = cities.get(key) ?? { uf: uf || null, count: 0 };
          cities.set(key, { uf: prev.uf ?? (uf || null), count: prev.count + 1 });
        }
        for (const t of (r.tags ?? []) as string[]) {
          if (!t) continue;
          tags.set(t, (tags.get(t) ?? 0) + 1);
        }
      }
      if (rows.length < PAGE) break;
    }
    return {
      states: [...states.entries()].map(([uf, count]) => ({ uf, count })).sort((a, b) => b.count - a.count),
      cities: [...cities.entries()].map(([name, v]) => ({ name, uf: v.uf, count: v.count })).sort((a, b) => b.count - a.count),
      tags: [...tags.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    };
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

/**
 * Métricas consolidadas da campanha agregando todos os envios de step:
 * total / enviados / entregues / lidos / respondidos / falhados / pulados /
 * pendentes, com taxas de entrega, abertura e conclusão.
 */
export const getCampaignMetrics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const [targets, pendingTargets, sentTargets, failedTargets, stepTotal, stepPending, stepSent, stepFailed, delivered, read, replied, skipped] = await Promise.all([
      supabaseAdmin.from("campaign_targets").select("id", { count: "exact", head: true }).eq("campaign_id", data.id),
      supabaseAdmin.from("campaign_targets").select("id", { count: "exact", head: true }).eq("campaign_id", data.id).eq("status", "pending"),
      supabaseAdmin.from("campaign_targets").select("id", { count: "exact", head: true }).eq("campaign_id", data.id).eq("status", "sent"),
      supabaseAdmin.from("campaign_targets").select("id", { count: "exact", head: true }).eq("campaign_id", data.id).eq("status", "failed"),
      supabaseAdmin.from("campaign_step_sends").select("id", { count: "exact", head: true }).eq("campaign_id", data.id),
      supabaseAdmin.from("campaign_step_sends").select("id", { count: "exact", head: true }).eq("campaign_id", data.id).eq("status", "pending"),
      supabaseAdmin.from("campaign_step_sends").select("id", { count: "exact", head: true }).eq("campaign_id", data.id).in("status", ["sent", "replied"]),
      supabaseAdmin.from("campaign_step_sends").select("id", { count: "exact", head: true }).eq("campaign_id", data.id).eq("status", "failed"),
      supabaseAdmin.from("campaign_step_sends").select("id", { count: "exact", head: true }).eq("campaign_id", data.id).not("delivered_at", "is", null),
      supabaseAdmin.from("campaign_step_sends").select("id", { count: "exact", head: true }).eq("campaign_id", data.id).not("read_at", "is", null),
      supabaseAdmin.from("campaign_step_sends").select("id", { count: "exact", head: true }).eq("campaign_id", data.id).eq("status", "replied"),
      supabaseAdmin.from("campaign_step_sends").select("id", { count: "exact", head: true }).eq("campaign_id", data.id).in("status", ["skipped", "skipped_replied", "skipped_dedupe"]),
    ]);
    const countErrors = [targets, pendingTargets, sentTargets, failedTargets, stepTotal, stepPending, stepSent, stepFailed, delivered, read, replied, skipped]
      .map((r) => r.error?.message)
      .filter(Boolean);
    if (countErrors.length) throw new Error(countErrors[0]);
    const hasStepSends = (stepTotal.count ?? 0) > 0;
    const m = {
      total: targets.count ?? 0,
      pending: hasStepSends ? (stepPending.count ?? 0) : (pendingTargets.count ?? 0),
      sent: Math.max(sentTargets.count ?? 0, stepSent.count ?? 0),
      delivered: delivered.count ?? 0,
      read: read.count ?? 0,
      replied: replied.count ?? 0,
      failed: Math.max(failedTargets.count ?? 0, stepFailed.count ?? 0),
      skipped: skipped.count ?? 0,
    };
    const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);
    return {
      counts: m,
      rates: {
        delivery: pct(m.delivered, m.sent),
        read: pct(m.read, m.sent),
        reply: pct(m.replied, m.sent),
        completion: pct(m.sent + m.failed + m.skipped, m.total),
      },
    };
  });