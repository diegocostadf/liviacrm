import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { fail, json, ok, supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_contacts",
  title: "Listar contatos",
  description:
    "Lista/busca contatos (leads) do CRM com filtros por texto, status do lead, tags, opt-out e origem.",
  inputSchema: {
    search: z.string().trim().optional().describe("Busca por nome, telefone ou e-mail."),
    lead_status: z.enum(["novo", "engajado", "inscrito", "perdido"]).optional(),
    tag: z.string().trim().optional().describe("Filtra contatos que possuem esta tag."),
    opted_out: z.boolean().optional(),
    source: z.string().trim().optional(),
    limit: z.number().int().min(1).max(200).default(25),
    offset: z.number().int().min(0).default(0),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) return fail("Não autenticado.");
    const supabase = supabaseForUser(ctx);
    let q = supabase
      .from("contacts")
      .select(
        "id, name, phone, email, company, city, state, lead_status, tags, source, opted_out, last_inbound_at, last_intent, created_at",
        { count: "exact" },
      )
      .order("created_at", { ascending: false })
      .range(input.offset, input.offset + input.limit - 1);
    if (input.search) {
      const s = input.search.replace(/[%,]/g, "");
      q = q.or(`name.ilike.%${s}%,phone.ilike.%${s}%,email.ilike.%${s}%`);
    }
    if (input.lead_status) q = q.eq("lead_status", input.lead_status);
    if (input.tag) q = q.contains("tags", [input.tag]);
    if (typeof input.opted_out === "boolean") q = q.eq("opted_out", input.opted_out);
    if (input.source) q = q.eq("source", input.source);
    const { data, error, count } = await q;
    if (error) return fail(error.message);
    return ok(json({ total: count ?? data?.length ?? 0, contacts: data ?? [] }), {
      total: count ?? 0,
      contacts: data ?? [],
    });
  },
});