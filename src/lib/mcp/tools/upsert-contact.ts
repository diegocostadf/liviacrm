import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { fail, json, ok, supabaseForUser } from "../supabase";

export default defineTool({
  name: "upsert_contact",
  title: "Criar ou atualizar contato",
  description:
    "Cria um contato novo ou atualiza um existente (chave: telefone). Use para cadastrar leads e ajustar status, tags e dados.",
  inputSchema: {
    phone: z.string().trim().min(8).describe("Telefone com DDI+DDD."),
    name: z.string().trim().optional(),
    email: z.string().trim().email().optional(),
    company: z.string().trim().optional(),
    job_title: z.string().trim().optional(),
    city: z.string().trim().optional(),
    state: z.string().trim().optional(),
    source: z.string().trim().optional(),
    tags: z.array(z.string().trim()).optional(),
    lead_status: z.enum(["novo", "engajado", "inscrito", "perdido"]).optional(),
    history: z.string().trim().optional().describe("Anotação/histórico livre do contato."),
    opted_out: z.boolean().optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) return fail("Não autenticado.");
    const supabase = supabaseForUser(ctx);
    const phone = input.phone.replace(/\D/g, "");
    if (!phone) return fail("Telefone inválido.");
    const patch: Record<string, unknown> = { phone };
    for (const key of [
      "name",
      "email",
      "company",
      "job_title",
      "city",
      "state",
      "source",
      "tags",
      "lead_status",
      "history",
      "opted_out",
    ] as const) {
      const value = (input as Record<string, unknown>)[key];
      if (value !== undefined) patch[key] = value;
    }
    if (input.opted_out) patch.opted_out_at = new Date().toISOString();

    const { data: existing } = await supabase.from("contacts").select("id").eq("phone", phone).maybeSingle();
    const query = existing
      ? supabase.from("contacts").update(patch).eq("id", existing.id).select().single()
      : supabase.from("contacts").insert(patch).select().single();
    const { data, error } = await query;
    if (error) return fail(error.message);
    return ok(json({ action: existing ? "updated" : "created", contact: data }), { contact: data });
  },
});