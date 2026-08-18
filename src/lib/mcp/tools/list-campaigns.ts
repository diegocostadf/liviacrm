import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { fail, json, ok, supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_campaigns",
  title: "Listar campanhas",
  description: "Lista campanhas com status, contadores de envio, agendamento e template usado.",
  inputSchema: {
    status: z.enum(["draft", "scheduled", "running", "paused", "completed", "failed"]).optional(),
    limit: z.number().int().min(1).max(100).default(20),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) return fail("Não autenticado.");
    const supabase = supabaseForUser(ctx);
    let q = supabase
      .from("campaigns")
      .select(
        "id, name, status, template, cloud_template_id, total_count, sent_count, failed_count, replied_count, scheduled_at, started_at, completed_at, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(input.limit);
    if (input.status) q = q.eq("status", input.status);
    const { data, error } = await q;
    if (error) return fail(error.message);
    return ok(json(data ?? []), { campaigns: data ?? [] });
  },
});