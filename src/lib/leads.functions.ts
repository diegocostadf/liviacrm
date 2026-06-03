import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const listSchema = z.object({
  search: z.string().trim().max(120).optional(),
  lead_status: z.enum(["novo", "engajado", "inscrito", "perdido"]).optional(),
  temperature: z.enum(["frio", "morno", "quente"]).optional(),
  tag: z.string().max(60).optional(),
  opted_out: z.boolean().optional(),
  mine: z.boolean().optional(),
  limit: z.number().int().min(1).max(500).default(200),
}).partial();

export const listLeads = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => listSchema.parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    let q = supabase
      .from("contacts")
      .select(`
        id, name, phone, email, city, state, company, job_title, source,
        tags, lead_status, opted_out, assigned_to, profile_pic_url,
        landing_link_sent_count, landing_link_sent_at, journey_completed,
        last_score_at, created_at, updated_at
      `)
      .order("updated_at", { ascending: false })
      .limit(data.limit ?? 200);
    if (data.lead_status) q = q.eq("lead_status", data.lead_status);
    if (typeof data.opted_out === "boolean") q = q.eq("opted_out", data.opted_out);
    if (data.mine) q = q.eq("assigned_to", userId);
    if (data.search) {
      const s = data.search.replace(/[%_]/g, "");
      q = q.or(`name.ilike.%${s}%,phone.ilike.%${s}%,email.ilike.%${s}%,company.ilike.%${s}%,city.ilike.%${s}%`);
    }
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    let list = rows ?? [];
    if (data.tag) list = list.filter((r) => (r.tags ?? []).includes(data.tag!));

    // get last intent per contact
    const ids = list.map((r) => r.id);
    let intentByContact = new Map<string, { intent: string; temperature: string; score: number; created_at: string }>();
    if (ids.length) {
      const { data: events } = await supabase
        .from("lead_intent_events")
        .select("contact_id, intent, temperature, score, created_at")
        .in("contact_id", ids)
        .order("created_at", { ascending: false });
      for (const ev of events ?? []) {
        if (!intentByContact.has(ev.contact_id)) {
          intentByContact.set(ev.contact_id, {
            intent: ev.intent as string,
            temperature: ev.temperature as string,
            score: ev.score,
            created_at: ev.created_at,
          });
        }
      }
    }
    let result = list.map((r) => ({ ...r, latest_intent: intentByContact.get(r.id) ?? null }));
    if (data.temperature) result = result.filter((r) => r.latest_intent?.temperature === data.temperature);
    return result;
  });

export const getLeadStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const [total, inscritos, optouts, quentes] = await Promise.all([
      supabase.from("contacts").select("id", { count: "exact", head: true }),
      supabase.from("contacts").select("id", { count: "exact", head: true }).eq("lead_status", "inscrito"),
      supabase.from("contacts").select("id", { count: "exact", head: true }).eq("opted_out", true),
      supabase.from("contacts").select("id", { count: "exact", head: true }).eq("last_intent", "lead_quente"),
    ]);
    return {
      total: total.count ?? 0,
      inscritos: inscritos.count ?? 0,
      opt_outs: optouts.count ?? 0,
      quentes: quentes.count ?? 0,
    };
  });

export const getLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const [
      { data: contact, error: cErr },
      { data: convs },
      { data: events },
      { data: campaignSends },
    ] = await Promise.all([
      supabase.from("contacts").select("*").eq("id", data.id).maybeSingle(),
      supabase
        .from("conversations")
        .select("id, status, unread_count, last_message_at, last_message_preview, assigned_to, instance_id, bot_active, intent_temperature, is_favorite, created_at")
        .eq("contact_id", data.id)
        .order("last_message_at", { ascending: false, nullsFirst: false }),
      supabase
        .from("lead_intent_events")
        .select("id, intent, temperature, score, summary, suggested_next, model, created_at")
        .eq("contact_id", data.id)
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("campaign_step_sends")
        .select("id, status, rendered_message, sent_at, replied_at, error, campaign_id, step_id, created_at")
        .eq("contact_id", data.id)
        .order("created_at", { ascending: false })
        .limit(100),
    ]);
    if (cErr) throw new Error(cErr.message);
    if (!contact) throw new Error("Lead não encontrado");

    const convIds = (convs ?? []).map((c) => c.id);
    let messages: any[] = [];
    let notes: any[] = [];
    if (convIds.length) {
      const [{ data: msgs }, { data: nts }] = await Promise.all([
        supabase
          .from("messages")
          .select("id, conversation_id, direction, type, content, media_url, media_mime, status, sent_by, created_at")
          .in("conversation_id", convIds)
          .order("created_at", { ascending: false })
          .limit(500),
        supabase
          .from("internal_notes")
          .select("id, conversation_id, content, author_id, created_at")
          .in("conversation_id", convIds)
          .order("created_at", { ascending: false }),
      ]);
      messages = msgs ?? [];
      notes = nts ?? [];
    }

    const campaignIds = Array.from(new Set((campaignSends ?? []).map((s) => s.campaign_id))).filter(Boolean);
    let campaignsById = new Map<string, { id: string; name: string }>();
    if (campaignIds.length) {
      const { data: camps } = await supabase
        .from("campaigns")
        .select("id, name")
        .in("id", campaignIds as string[]);
      for (const c of camps ?? []) campaignsById.set(c.id, c);
    }

    return {
      contact,
      conversations: convs ?? [],
      messages,
      notes,
      events: events ?? [],
      campaignSends: (campaignSends ?? []).map((s) => ({
        ...s,
        campaign_name: s.campaign_id ? campaignsById.get(s.campaign_id)?.name ?? null : null,
      })),
    };
  });

const updateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().max(200).nullable().optional(),
  email: z.string().trim().email().max(200).nullable().or(z.literal("")).optional(),
  city: z.string().trim().max(120).nullable().optional(),
  state: z.string().trim().max(120).nullable().optional(),
  company: z.string().trim().max(200).nullable().optional(),
  job_title: z.string().trim().max(200).nullable().optional(),
  source: z.string().trim().max(120).nullable().optional(),
  lead_status: z.enum(["novo", "engajado", "inscrito", "perdido"]).optional(),
  tags: z.array(z.string().trim().min(1).max(60)).max(50).optional(),
  assigned_to: z.string().uuid().nullable().optional(),
  opted_out: z.boolean().optional(),
});

export const updateLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => updateSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { id, ...rest } = data;
    const patch = { ...rest } as typeof rest;
    if (patch.email === "") patch.email = null;
    const { error } = await supabase.from("contacts").update(patch).eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const addLeadNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    contact_id: z.string().uuid(),
    content: z.string().trim().min(1).max(4000),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // Find any conversation for this contact or create a virtual note — internal_notes requires conversation_id.
    const { data: conv } = await supabase
      .from("conversations")
      .select("id")
      .eq("contact_id", data.contact_id)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    if (!conv) throw new Error("Crie uma conversa antes de adicionar notas para este lead.");
    const { error } = await supabase
      .from("internal_notes")
      .insert({ conversation_id: conv.id, author_id: userId, content: data.content });
    if (error) throw new Error(error.message);
    return { ok: true };
  });