import { createFileRoute } from "@tanstack/react-router";
import { tickAllRunningCampaigns, tickCampaign } from "@/lib/campaigns.server";
import { loadEvolutionSettings } from "@/lib/evolution.server";

export const Route = createFileRoute("/api/public/campaigns/tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { webhookToken } = await loadEvolutionSettings();
        const url = new URL(request.url);
        const provided = request.headers.get("x-cron-token") || url.searchParams.get("token");
        if (webhookToken && provided !== webhookToken) {
          return new Response("Invalid token", { status: 401 });
        }
        const id = url.searchParams.get("campaign_id");
        const batch = Math.max(1, Math.min(5, Number(url.searchParams.get("batch") ?? 1)));
        try {
          if (id) {
            const r = await tickCampaign(id, batch);
            return Response.json({ ok: true, results: [{ id, ...r }] });
          }
          const results = await tickAllRunningCampaigns(batch);
          return Response.json({ ok: true, results });
        } catch (e) {
          console.error("[campaigns/tick]", e);
          return new Response("Internal error", { status: 500 });
        }
      },
    },
  },
});