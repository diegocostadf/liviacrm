import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { fail, json, ok, supabaseForUser } from "../supabase";

export default defineTool({
  name: "get_campaign",
  title: "Detalhes da campanha",
  description: "Retorna a campanha completa com regras de envio e resumo dos destinatários por status.",
  inputSchema: {
    campaign_id: z.string().uuid(),
    include_targets: z.boolean().default(false).describe("Inclui até 100 destinatários."),
    target_status: z.enum(["pending", "sent", "failed", "replied", "opt_out"]).optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) return fail("Não autenticado.");
    const supabase = supabaseForUser(ctx);
    const { data: campaign, error } = await supabase
      .from("campaigns")
      .select("*")
      .eq("id", input.campaign_id)
      .maybeSingle();
    if (error) return fail(error.message);
    if (!campaign) return fail("Campanha não encontrada.");

    const statuses = ["pending", "sent", "failed", "replied", "opt_out"] as const;
    const counts: Record<string, number> = {};
    await Promise.all(
      statuses.map(async (s) => {
        const { count } = await supabase
          .from("campaign_targets")
          .select("id", { count: "exact", head: true })
          .eq("campaign_id", input.campaign_id)
          .eq("status", s);
        counts[s] = count ?? 0;
      }),
    );

    let targets: unknown[] = [];
    if (input.include_targets) {
      let tq = supabase
        .from("campaign_targets")
        .select("id, phone, name, status, attempts, error, sent_at, rendered_message")
        .eq("campaign_id", input.campaign_id)
        .order("created_at", { ascending: true })
        .limit(100);
      if (input.target_status) tq = tq.eq("status", input.target_status);
      const { data } = await tq;
      targets = data ?? [];
    }

    const payload = { campaign, target_counts: counts, targets };
    return ok(json(payload), payload as Record<string, unknown>);
  },
});