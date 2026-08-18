import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { fail, json, ok, supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_whatsapp_templates",
  title: "Listar templates do WhatsApp",
  description: "Lista os templates do WhatsApp Cloud sincronizados com a Meta, com status de aprovação e categoria.",
  inputSchema: {
    status: z.string().trim().optional().describe("Ex.: APPROVED, PENDING, REJECTED."),
    limit: z.number().int().min(1).max(100).default(50),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) return fail("Não autenticado.");
    const supabase = supabaseForUser(ctx);
    let q = supabase
      .from("whatsapp_cloud_templates")
      .select("id, name, language, category, status, variables_count, rejection_reason, quality_score, last_synced_at")
      .order("updated_at", { ascending: false })
      .limit(input.limit);
    if (input.status) q = q.eq("status", input.status.toUpperCase());
    const { data, error } = await q;
    if (error) return fail(error.message);
    return ok(json(data ?? []), { templates: data ?? [] });
  },
});