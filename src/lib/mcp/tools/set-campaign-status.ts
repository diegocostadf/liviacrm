import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { fail, json, ok, supabaseForUser } from "../supabase";

export default defineTool({
  name: "set_campaign_status",
  title: "Alterar status da campanha",
  description:
    "Inicia, pausa, retoma, agenda, conclui ou volta a campanha para rascunho. Iniciar significa começar a disparar mensagens reais.",
  inputSchema: {
    campaign_id: z.string().uuid(),
    status: z.enum(["draft", "scheduled", "running", "paused", "completed"]),
    scheduled_at: z.string().datetime().optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) return fail("Não autenticado.");
    const supabase = supabaseForUser(ctx);
    const patch: Record<string, unknown> = { status: input.status };
    if (input.status === "running") patch.started_at = new Date().toISOString();
    if (input.status === "completed") patch.completed_at = new Date().toISOString();
    if (input.scheduled_at) patch.scheduled_at = input.scheduled_at;
    const { data, error } = await supabase
      .from("campaigns")
      .update(patch)
      .eq("id", input.campaign_id)
      .select("id, name, status, scheduled_at, total_count, sent_count")
      .maybeSingle();
    if (error) return fail(error.message);
    if (!data) return fail("Campanha não encontrada ou sem permissão.");
    return ok(json(data), { campaign: data });
  },
});