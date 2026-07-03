import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Public webhook endpoint for Z-API events.
// Configure this URL in your Z-API instance webhook settings.
// URL: https://<your-domain>/api/public/webhooks/zapi
export const Route = createFileRoute("/api/public/webhooks/zapi")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await request.json().catch(() => ({}));
          try {
            await supabaseAdmin.from("meta_logs").insert({
              kind: "zapi.webhook",
              level: "info",
              message: "inbound",
              meta: body as never,
            });
          } catch { /* logging is best-effort */ }
          return Response.json({ ok: true });
        } catch (e) {
          return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 200 });
        }
      },
      GET: async () => Response.json({ ok: true }),
    },
  },
});