import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
const INTENTS_BY_TEMP = {
  quente: ["lead_quente", "interessado"],
  morno: ["inscrito", "objecao"],
  frio: ["silencio", "sem_interesse", "fora_escopo"],
} as const;

function daysBack(n: number) {
  return new Date(Date.now() - n * 24 * 3600 * 1000).toISOString();
}
function toDayKey(iso: string) { return iso.slice(0, 10); }
function emptyDays(n: number) {
  const out: Record<string, { date: string; sent: number; received: number; failed: number }> = {};
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 3600 * 1000).toISOString().slice(0, 10);
    out[d] = { date: d, sent: 0, received: 0, failed: 0 };
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard
// ─────────────────────────────────────────────────────────────────────────────
const rangeSchema = z.object({ days: z.number().int().min(1).max(180).default(30) }).partial();

export const getReportsOverview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => rangeSchema.parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const days = data.days ?? 30;
    const since = daysBack(days);

    const [msgs, sends, contactsAgg, intents, conversations] = await Promise.all([
      supabase.from("messages").select("direction, status, created_at, sent_by").gte("created_at", since).limit(50000),
      supabase.from("campaign_step_sends").select("status, sent_at, replied_at, created_at, campaign_id").gte("created_at", since).limit(50000),
      supabase.from("contacts").select("lead_status, last_intent, opted_out, created_at").limit(50000),
      supabase.from("lead_intent_events").select("temperature, created_at").gte("created_at", since).limit(50000),
      supabase.from("conversations").select("id, assigned_to, status, created_at, last_message_at").gte("last_message_at", since).limit(20000),
    ]);

    // Daily message series
    const series = emptyDays(days);
    let totIn = 0, totOut = 0, totFailed = 0;
    for (const m of msgs.data ?? []) {
      const k = toDayKey(String(m.created_at));
      if (!series[k]) continue;
      if (m.direction === "in") { series[k].received++; totIn++; }
      else { series[k].sent++; totOut++; }
      if ((m as any).status === "failed") { series[k].failed++; totFailed++; }
    }

    // Campaign aggregates
    let camp = { pending: 0, sent: 0, failed: 0, replied: 0, skipped: 0, total: 0 };
    for (const s of sends.data ?? []) {
      camp.total++;
      const st = String(s.status);
      if (st === "pending") camp.pending++;
      else if (st === "sent" || st === "delivered" || st === "read") camp.sent++;
      else if (st === "failed") camp.failed++;
      else if (st === "skipped") camp.skipped++;
      if (s.replied_at) camp.replied++;
    }

    // Lead funnel
    const funnel: Record<string, number> = { novo: 0, engajado: 0, inscrito: 0, perdido: 0 };
    const temperature: Record<string, number> = { quente: 0, morno: 0, frio: 0, sem_classificacao: 0 };
    let optedOut = 0;
    for (const c of contactsAgg.data ?? []) {
      const ls = String(c.lead_status ?? "novo");
      if (funnel[ls] !== undefined) funnel[ls]++;
      if (c.opted_out) optedOut++;
      const li = c.last_intent ? String(c.last_intent) : null;
      if (!li) temperature.sem_classificacao++;
      else if ((INTENTS_BY_TEMP.quente as readonly string[]).includes(li)) temperature.quente++;
      else if ((INTENTS_BY_TEMP.morno as readonly string[]).includes(li)) temperature.morno++;
      else temperature.frio++;
    }

    // Productivity per agent
    const byAgent = new Map<string, { agent_id: string; sent: number; conversations: number }>();
    for (const m of msgs.data ?? []) {
      if (m.direction !== "out" || !m.sent_by) continue;
      const id = String(m.sent_by);
      const cur = byAgent.get(id) ?? { agent_id: id, sent: 0, conversations: 0 };
      cur.sent++; byAgent.set(id, cur);
    }
    const convsByAgent = new Map<string, Set<string>>();
    for (const c of conversations.data ?? []) {
      if (!c.assigned_to) continue;
      const id = String(c.assigned_to);
      if (!convsByAgent.has(id)) convsByAgent.set(id, new Set());
      convsByAgent.get(id)!.add(c.id);
    }
    for (const [id, set] of convsByAgent) {
      const cur = byAgent.get(id) ?? { agent_id: id, sent: 0, conversations: 0 };
      cur.conversations = set.size; byAgent.set(id, cur);
    }
    const agentIds = Array.from(byAgent.keys());
    let agentRows: Array<{ agent_id: string; name: string; sent: number; conversations: number }> = [];
    if (agentIds.length) {
      const { data: profs } = await supabase.from("profiles").select("id, display_name, email").in("id", agentIds);
      const byId = new Map((profs ?? []).map((p) => [p.id, p]));
      agentRows = Array.from(byAgent.values()).map((a) => ({
        ...a,
        name: byId.get(a.agent_id)?.display_name ?? byId.get(a.agent_id)?.email ?? a.agent_id.slice(0, 8),
      })).sort((a, b) => b.sent - a.sent);
    }

    return {
      days,
      totals: {
        messages_in: totIn,
        messages_out: totOut,
        messages_failed: totFailed,
        opted_out: optedOut,
        leads: (contactsAgg.data ?? []).length,
      },
      series: Object.values(series),
      campaigns: camp,
      funnel,
      temperature,
      agents: agentRows,
      intentsClassified: (intents.data ?? []).length,
    };
  });

// ─────────────────────────────────────────────────────────────────────────────
// Campaign performance breakdown
// ─────────────────────────────────────────────────────────────────────────────
export const getCampaignPerformance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => rangeSchema.parse(d ?? {}))
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data: campaigns } = await supabase
      .from("campaigns")
      .select("id, name, status, total_count, sent_count, failed_count, replied_count, created_at")
      .order("created_at", { ascending: false })
      .limit(50);
    return { campaigns: campaigns ?? [] };
  });

// ─────────────────────────────────────────────────────────────────────────────
// Saved lists CRUD + query
// ─────────────────────────────────────────────────────────────────────────────
const filterSchema = z.object({
  search: z.string().trim().max(120).optional(),
  lead_status: z.array(z.enum(["novo", "engajado", "inscrito", "perdido"])).optional(),
  temperature: z.array(z.enum(["frio", "morno", "quente"])).optional(),
  tags: z.array(z.string().max(60)).optional(),
  source: z.string().max(120).optional(),
  city: z.string().max(120).optional(),
  state: z.string().max(120).optional(),
  opted_out: z.boolean().optional(),
  assigned_to: z.string().uuid().nullable().optional(),
  created_after: z.string().optional(),
  created_before: z.string().optional(),
});
export type ContactFilters = z.infer<typeof filterSchema>;

function applyContactFilters(q: any, f: ContactFilters) {
  if (f.lead_status?.length) q = q.in("lead_status", f.lead_status);
  if (typeof f.opted_out === "boolean") q = q.eq("opted_out", f.opted_out);
  if (f.source) q = q.eq("source", f.source);
  if (f.city) q = q.ilike("city", `%${f.city.replace(/[%_]/g, "")}%`);
  if (f.state) q = q.ilike("state", `%${f.state.replace(/[%_]/g, "")}%`);
  if (f.assigned_to === null) q = q.is("assigned_to", null);
  else if (f.assigned_to) q = q.eq("assigned_to", f.assigned_to);
  if (f.tags?.length) q = q.contains("tags", f.tags);
  if (f.created_after) q = q.gte("created_at", f.created_after);
  if (f.created_before) q = q.lte("created_at", f.created_before);
  if (f.temperature?.length) {
    const intents = f.temperature.flatMap((t) => INTENTS_BY_TEMP[t]);
    q = q.in("last_intent", intents);
  }
  if (f.search) {
    const s = f.search.replace(/[%_]/g, "");
    q = q.or(`name.ilike.%${s}%,phone.ilike.%${s}%,email.ilike.%${s}%,company.ilike.%${s}%,city.ilike.%${s}%`);
  }
  return q;
}

export const previewContactFilter = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ filters: filterSchema, limit: z.number().int().min(1).max(500).default(100) }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    let q = supabase
      .from("contacts")
      .select("id, name, phone, email, city, state, company, source, tags, lead_status, last_intent, opted_out, assigned_to, created_at", { count: "exact" });
    q = applyContactFilters(q, data.filters);
    const { data: rows, count, error } = await q.order("updated_at", { ascending: false }).range(0, data.limit - 1);
    if (error) throw new Error(error.message);
    return { rows: rows ?? [], total: count ?? 0 };
  });

export const listSavedLists = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("saved_lists")
      .select("id, name, description, filters, shared, owner_id, created_at, updated_at")
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { rows: (data ?? []).map((r) => ({ ...r, mine: r.owner_id === userId })) };
  });

export const saveList = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    id: z.string().uuid().optional(),
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(500).optional(),
    filters: filterSchema,
    shared: z.boolean().default(false),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (data.id) {
      const { error } = await supabase.from("saved_lists").update({
        name: data.name, description: data.description ?? null, filters: data.filters, shared: data.shared,
      }).eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: ins, error } = await supabase.from("saved_lists").insert({
      owner_id: userId, name: data.name, description: data.description ?? null, filters: data.filters, shared: data.shared,
    }).select("id").single();
    if (error) throw new Error(error.message);
    return { id: ins!.id };
  });

export const deleteSavedList = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("saved_lists").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ─────────────────────────────────────────────────────────────────────────────
// Exports — return base64 payloads (CSV or XLSX), client triggers download
// ─────────────────────────────────────────────────────────────────────────────
function toCsv(rows: Array<Record<string, any>>, headers?: string[]) {
  if (!rows.length) return (headers ?? []).join(",") + "\n";
  const cols = headers ?? Object.keys(rows[0]);
  const esc = (v: any) => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "string" ? v : Array.isArray(v) ? v.join("|") : typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return cols.join(",") + "\n" + rows.map((r) => cols.map((c) => esc(r[c])).join(",")).join("\n") + "\n";
}

async function toXlsxBase64(rows: Array<Record<string, any>>, sheetName = "Sheet1") {
  const XLSX = await import("xlsx");
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  const buf = XLSX.write(wb, { type: "base64", bookType: "xlsx" });
  return buf as string;
}

const exportFormat = z.enum(["csv", "xlsx"]);

export const exportContactsList = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ filters: filterSchema, format: exportFormat, max: z.number().int().min(1).max(50000).default(20000) }).parse(d))
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("contacts")
      .select("name, phone, email, company, job_title, city, state, source, tags, lead_status, last_intent, opted_out, created_at");
    q = applyContactFilters(q, data.filters);
    const { data: rows, error } = await q.order("updated_at", { ascending: false }).range(0, data.max - 1);
    if (error) throw new Error(error.message);
    const flat = (rows ?? []).map((r: any) => ({ ...r, tags: Array.isArray(r.tags) ? r.tags.join("|") : "" }));
    if (data.format === "csv") return { filename: `contatos-${Date.now()}.csv`, mime: "text/csv", data: btoa(unescape(encodeURIComponent(toCsv(flat)))), count: flat.length };
    return { filename: `contatos-${Date.now()}.xlsx`, mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", data: await toXlsxBase64(flat, "Contatos"), count: flat.length };
  });

export const exportCampaignSends = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    campaign_id: z.string().uuid().optional(),
    status: z.array(z.enum(["pending", "sent", "delivered", "read", "failed", "skipped"])).optional(),
    format: exportFormat,
    days: z.number().int().min(1).max(365).default(90),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const since = daysBack(data.days);
    let q = context.supabase
      .from("campaign_step_sends")
      .select("id, campaign_id, step_id, contact_id, phone, status, attempts, rendered_message, error, sent_at, delivered_at, read_at, replied_at, created_at")
      .gte("created_at", since);
    if (data.campaign_id) q = q.eq("campaign_id", data.campaign_id);
    if (data.status?.length) q = q.in("status", data.status);
    const { data: rows, error } = await q.order("created_at", { ascending: false }).range(0, 49999);
    if (error) throw new Error(error.message);
    // enrich with campaign name + contact name
    const cids = Array.from(new Set((rows ?? []).map((r: any) => r.campaign_id).filter(Boolean)));
    const conIds = Array.from(new Set((rows ?? []).map((r: any) => r.contact_id).filter(Boolean)));
    const [{ data: camps }, { data: cons }] = await Promise.all([
      cids.length ? context.supabase.from("campaigns").select("id, name").in("id", cids) : Promise.resolve({ data: [] as any[] }),
      conIds.length ? context.supabase.from("contacts").select("id, name, email").in("id", conIds) : Promise.resolve({ data: [] as any[] }),
    ]);
    const cm = new Map((camps ?? []).map((c) => [c.id, c.name]));
    const cn = new Map((cons ?? []).map((c) => [c.id, c]));
    const flat = (rows ?? []).map((r: any) => ({
      campaign: cm.get(r.campaign_id) ?? r.campaign_id,
      contact_name: cn.get(r.contact_id)?.name ?? "",
      contact_email: cn.get(r.contact_id)?.email ?? "",
      phone: r.phone,
      status: r.status,
      attempts: r.attempts,
      error: r.error ?? "",
      created_at: r.created_at,
      sent_at: r.sent_at,
      delivered_at: r.delivered_at,
      read_at: r.read_at,
      replied_at: r.replied_at,
      rendered_message: r.rendered_message ?? "",
    }));
    if (data.format === "csv") return { filename: `envios-${Date.now()}.csv`, mime: "text/csv", data: btoa(unescape(encodeURIComponent(toCsv(flat)))), count: flat.length };
    return { filename: `envios-${Date.now()}.xlsx`, mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", data: await toXlsxBase64(flat, "Envios"), count: flat.length };
  });

export const exportMessages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ days: z.number().int().min(1).max(180).default(30), format: exportFormat }).parse(d))
  .handler(async ({ data, context }) => {
    const since = daysBack(data.days);
    const { data: rows, error } = await context.supabase
      .from("messages")
      .select("id, conversation_id, direction, type, content, status, sent_by, created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .range(0, 49999);
    if (error) throw new Error(error.message);
    const flat = (rows ?? []).map((r: any) => ({ ...r, content: typeof r.content === "string" ? r.content : JSON.stringify(r.content ?? "") }));
    if (data.format === "csv") return { filename: `mensagens-${Date.now()}.csv`, mime: "text/csv", data: btoa(unescape(encodeURIComponent(toCsv(flat)))), count: flat.length };
    return { filename: `mensagens-${Date.now()}.xlsx`, mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", data: await toXlsxBase64(flat, "Mensagens"), count: flat.length };
  });

export const exportIntentEvents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ days: z.number().int().min(1).max(365).default(90), format: exportFormat }).parse(d))
  .handler(async ({ data, context }) => {
    const since = daysBack(data.days);
    const { data: rows, error } = await context.supabase
      .from("lead_intent_events")
      .select("id, contact_id, intent, temperature, score, summary, suggested_next, model, created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .range(0, 49999);
    if (error) throw new Error(error.message);
    const conIds = Array.from(new Set((rows ?? []).map((r: any) => r.contact_id).filter(Boolean)));
    const { data: cons } = conIds.length
      ? await context.supabase.from("contacts").select("id, name, phone").in("id", conIds)
      : { data: [] as any[] };
    const cn = new Map((cons ?? []).map((c: any) => [c.id, c]));
    const flat = (rows ?? []).map((r: any) => ({
      contact_name: cn.get(r.contact_id)?.name ?? "",
      phone: cn.get(r.contact_id)?.phone ?? "",
      intent: r.intent,
      temperature: r.temperature,
      score: r.score,
      summary: r.summary ?? "",
      suggested_next: r.suggested_next ?? "",
      model: r.model ?? "",
      created_at: r.created_at,
    }));
    if (data.format === "csv") return { filename: `intencoes-${Date.now()}.csv`, mime: "text/csv", data: btoa(unescape(encodeURIComponent(toCsv(flat)))), count: flat.length };
    return { filename: `intencoes-${Date.now()}.xlsx`, mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", data: await toXlsxBase64(flat, "Intencoes"), count: flat.length };
  });