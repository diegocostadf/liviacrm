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
              const v = change.value as {
                statuses?: Array<{ id: string; status: string; timestamp?: string }>;
                messages?: Array<{
                  id: string;
                  from: string;
                  type: string;
                  timestamp?: string;
                  text?: { body: string };
                  image?: { caption?: string };
                  document?: { caption?: string };
                }>;
                metadata?: { phone_number_id?: string; display_phone_number?: string };
                contacts?: Array<{ wa_id: string; profile?: { name?: string } }>;
              };
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
              // Inbound messages: idempotent por wa_message_id.
              if (v.messages?.length) {
                const phoneNumberId = v.metadata?.phone_number_id ?? null;
                for (const m of v.messages) {
                  const from = String(m.from ?? "").replace(/\D/g, "");
                  if (!from || !m.id) continue;

                  // Skip if already processed
                  const { data: existing } = await supabaseAdmin
                    .from("messages")
                    .select("id")
                    .eq("wa_message_id", m.id)
                    .maybeSingle();
                  if (existing) continue;

                  const contactName = v.contacts?.[0]?.profile?.name ?? null;
                  const inboundAt = m.timestamp
                    ? new Date(Number(m.timestamp) * 1000).toISOString()
                    : new Date().toISOString();

                  // Upsert contato + atualiza last_inbound_at (crítico para janela 24h)
                  const { data: contact } = await supabaseAdmin
                    .from("contacts")
                    .upsert(
                      { phone: from, name: contactName ?? undefined, last_inbound_at: inboundAt },
                      { onConflict: "phone" },
                    )
                    .select("id")
                    .single();
                  if (!contact) continue;
                  await supabaseAdmin
                    .from("contacts")
                    .update({ last_inbound_at: inboundAt })
                    .eq("id", contact.id);

                  // Encontra/cria conversa via whatsapp_instances (Cloud API mapeada
                  // por phone_number_id em app_settings/whatsapp_instances é fora do
                  // escopo aqui — usa a primeira instância disponível).
                  const { data: instance } = await supabaseAdmin
                    .from("whatsapp_instances")
                    .select("id")
                    .limit(1)
                    .maybeSingle();
                  if (!instance) continue;

                  const { data: conv } = await supabaseAdmin
                    .from("conversations")
                    .upsert(
                      {
                        contact_id: contact.id,
                        instance_id: instance.id,
                        last_message_at: inboundAt,
                        last_message_preview: (m.text?.body ?? m.image?.caption ?? m.document?.caption ?? `[${m.type}]`).slice(0, 200),
                      },
                      { onConflict: "contact_id,instance_id" },
                    )
                    .select("id")
                    .single();
                  if (!conv) continue;

                  await supabaseAdmin.from("messages").insert({
                    conversation_id: conv.id,
                    wa_message_id: m.id,
                    direction: "in",
                    type: (m.type === "text" ? "text" : "text") as never,
                    content: m.text?.body ?? m.image?.caption ?? m.document?.caption ?? `[${m.type}]`,
                    status: "delivered" as never,
                    metadata: { provider: "cloud", phoneNumberId } as never,
                  });
                }
              }
            }
          }
        }
        return new Response("ok");
      },
    },
  },
});