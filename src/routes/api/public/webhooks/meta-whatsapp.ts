import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";

export const Route = createFileRoute("/api/public/webhooks/meta-whatsapp")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const u = new URL(request.url);
        const mode = u.searchParams.get("hub.mode");
        const token = u.searchParams.get("hub.verify_token");
        const challenge = u.searchParams.get("hub.challenge");
        const expected = process.env.META_WEBHOOK_VERIFY_TOKEN ?? "";
        if (mode === "subscribe" && token && expected && token === expected) {
          return new Response(challenge ?? "", { status: 200 });
        }
        return new Response("forbidden", { status: 403 });
      },
      POST: async ({ request }) => {
        const raw = await request.text();
        const sig = request.headers.get("x-hub-signature-256") ?? "";
        const secret = process.env.META_APP_SECRET ?? "";
        if (secret) {
          const expected = "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
          const a = Buffer.from(sig);
          const b = Buffer.from(expected);
          if (a.length !== b.length || !timingSafeEqual(a, b)) {
            return new Response("invalid signature", { status: 401 });
          }
        }
        let payload: { entry?: Array<{ id?: string; changes?: Array<{ field?: string; value?: Record<string, unknown> }> }> } = {};
        try { payload = JSON.parse(raw); } catch { return new Response("bad json", { status: 400 }); }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        for (const entry of payload.entry ?? []) {
          for (const change of entry.changes ?? []) {
            if (change.field === "message_template_status_update") {
              const v = change.value as { message_template_id?: string; message_template_name?: string; message_template_language?: string; event?: string; reason?: string };
              if (v.message_template_name) {
                await supabaseAdmin
                  .from("whatsapp_cloud_templates")
                  .update({
                    status: v.event ?? "PENDING",
                    rejection_reason: v.reason ?? null,
                    meta_template_id: v.message_template_id ?? null,
                    last_synced_at: new Date().toISOString(),
                  })
                  .eq("name", v.message_template_name)
                  .eq("language", v.message_template_language ?? "pt_BR");
              }
            } else if (change.field === "messages") {
              // Inbound and status callbacks. Status updates carry "statuses[]".
              const v = change.value as { statuses?: Array<{ id: string; status: string }>; messages?: Array<{ id: string; from: string; type: string; text?: { body: string } }> };
              if (v.statuses?.length) {
                for (const s of v.statuses) {
                  const mapped =
                    s.status === "read" ? "read" :
                    s.status === "delivered" ? "delivered" :
                    s.status === "sent" ? "sent" :
                    s.status === "failed" ? "failed" : null;
                  if (!mapped) continue;
                  await supabaseAdmin.from("messages").update({ status: mapped }).eq("wa_message_id", s.id);
                }
              }
              // Inbound messages handling is left to the inbox layer to keep this PR small.
            }
          }
        }
        return new Response("ok");
      },
    },
  },
});