import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { fail, json, ok, supabaseForUser } from "../supabase";

export default defineTool({
  name: "add_campaign_targets",
  title: "Adicionar destinatários à campanha",
  description:
    "Adiciona destinatários a uma campanha: por telefones explícitos e/ou por filtro de contatos do CRM (status, tag, origem). Ignora contatos com opt-out.",
  inputSchema: {
    campaign_id: z.string().uuid(),
    phones: z.array(z.string().trim()).max(2000).optional(),
    from_filter: z
      .object({
        lead_status: z.enum(["novo", "engajado", "inscrito", "perdido"]).optional(),
        tag: z.string().trim().optional(),
        source: z.string().trim().optional(),
        limit: z.number().int().min(1).max(2000).default(500),
      })
      .optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) return fail("Não autenticado.");
    const supabase = supabaseForUser(ctx);
    const { data: campaign } = await supabase
      .from("campaigns")
      .select("id, status")
      .eq("id", input.campaign_id)
      .maybeSingle();
    if (!campaign) return fail("Campanha não encontrada.");

    const rows = new Map<string, { phone: string; name: string | null; contact_id: string | null }>();

    if (input.phones?.length) {
      const phones = input.phones.map((p) => p.replace(/\D/g, "")).filter(Boolean);
      const { data: contacts } = await supabase
        .from("contacts")
        .select("id, name, phone, opted_out")
        .in("phone", phones);
      const byPhone = new Map((contacts ?? []).map((c) => [c.phone, c]));
      for (const phone of phones) {
        const c = byPhone.get(phone);
        if (c?.opted_out) continue;
        rows.set(phone, { phone, name: c?.name ?? null, contact_id: c?.id ?? null });
      }
    }

    if (input.from_filter) {
      let q = supabase
        .from("contacts")
        .select("id, name, phone")
        .eq("opted_out", false)
        .limit(input.from_filter.limit);
      if (input.from_filter.lead_status) q = q.eq("lead_status", input.from_filter.lead_status);
      if (input.from_filter.tag) q = q.contains("tags", [input.from_filter.tag]);
      if (input.from_filter.source) q = q.eq("source", input.from_filter.source);
      const { data, error } = await q;
      if (error) return fail(error.message);
      for (const c of data ?? []) rows.set(c.phone, { phone: c.phone, name: c.name, contact_id: c.id });
    }

    if (!rows.size) return fail("Nenhum destinatário elegível encontrado.");

    const { data: existing } = await supabase
      .from("campaign_targets")
      .select("phone")
      .eq("campaign_id", input.campaign_id);
    const already = new Set((existing ?? []).map((t) => t.phone));
    const toInsert = [...rows.values()]
      .filter((r) => !already.has(r.phone))
      .map((r) => ({ campaign_id: input.campaign_id, ...r, status: "pending" as const }));
    if (!toInsert.length) return ok(json({ inserted: 0, message: "Todos os destinatários já estavam na campanha." }));

    const { error } = await supabase.from("campaign_targets").insert(toInsert);
    if (error) return fail(error.message);

    const { count } = await supabase
      .from("campaign_targets")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", input.campaign_id);
    await supabase.from("campaigns").update({ total_count: count ?? 0 }).eq("id", input.campaign_id);

    return ok(json({ inserted: toInsert.length, total_targets: count ?? 0 }), {
      inserted: toInsert.length,
      total_targets: count ?? 0,
    });
  },
});