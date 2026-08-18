import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { fail, json, ok, supabaseForUser } from "../supabase";

export default defineTool({
  name: "run_campaign_batch",
  title: "Disparar lote da campanha",
  description:
    "Processa imediatamente um lote de envios pendentes de uma campanha em execução (respeitando janela, throttle, opt-out e janela de 24h).",
  inputSchema: {
    campaign_id: z.string().uuid(),
    batch: z.number().int().min(1).max(25).default(5),
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) return fail("Não autenticado.");
    const supabase = supabaseForUser(ctx);
    const { data: campaign } = await supabase
      .from("campaigns")
      .select("id, status")
      .eq("id", input.campaign_id)
      .maybeSingle();
    if (!campaign) return fail("Campanha não encontrada ou sem permissão.");
    if (campaign.status !== "running") return fail(`Campanha está em "${campaign.status}". Use set_campaign_status para iniciar.`);
    try {
      const { tickCampaign } = await import("@/lib/campaigns.server");
      const result = await tickCampaign(input.campaign_id, input.batch);
      return ok(json(result), { result: result as unknown as Record<string, unknown> });
    } catch (e) {
      return fail(e instanceof Error ? e.message : "Falha ao processar lote.");
    }
  },
});