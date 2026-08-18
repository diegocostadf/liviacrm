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
        const { getMetaConfig } = await import("@/lib/whatsapp-cloud.server");
        const expected = (await getMetaConfig()).verifyToken;
        if (mode === "subscribe" && token && expected && token === expected) {
          return new Response(challenge ?? "", { status: 200 });
        }
        return new Response("forbidden", { status: 403 });
      },
      POST: async ({ request }) => {
        const raw = await request.text();
        const sig = request.headers.get("x-hub-signature-256") ?? "";
        const { getMetaConfig, ensureCloudInstance } = await import("@/lib/whatsapp-cloud.server");
        const secret = (await getMetaConfig()).appSecret;
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

                  // Conversa vinculada à "instância" virtual da Cloud API,
                  // criada por phone_number_id (não usa instâncias Evolution).
                  const instance = phoneNumberId
                    ? await ensureCloudInstance({
                        phoneNumberId,
                        displayPhoneNumber: v.metadata?.display_phone_number ?? null,
                      })
                    : await supabaseAdmin
                        .from("whatsapp_instances")
                        .select("id")
                        .limit(1)
                        .maybeSingle()
                        .then((r) => r.data);
                  if (!instance) continue;

                  // Verifica se há bot ativo para esta instância
                  const { data: botCfg } = await supabaseAdmin
                    .from("ai_bot_configs")
                    .select("enabled")
                    .eq("instance_id", instance.id)
                    .maybeSingle();

                  const { data: conv } = await supabaseAdmin
                    .from("conversations")
                    .upsert(
                      {
                        contact_id: contact.id,
                        instance_id: instance.id,
                        last_message_at: inboundAt,
                        last_message_preview: (m.text?.body ?? m.image?.caption ?? m.document?.caption ?? `[${m.type}]`).slice(0, 200),
                        bot_active: Boolean(botCfg?.enabled),
                      },
                      { onConflict: "contact_id,instance_id", ignoreDuplicates: false },
                    )
                    .select("id, bot_active")
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

                  // Marca respostas de campanha + trata opt-out.
                  try {
                    const { markRepliesForPhone, handleOptOut } = await import("@/lib/campaign-steps.server");
                    await markRepliesForPhone(from);
                    await handleOptOut({
                      phone: from,
                      text: m.text?.body ?? "",
                      instanceName: `cloud:${phoneNumberId ?? ""}`,
                    });
                  } catch (e) {
                    console.warn("[meta-webhook] campaign hooks", e);
                  }

                  // Reset command: /resetar, /reset, /reiniciar
                  if (m.type === "text" && m.text?.body) {
                    const { handleResetCommand } = await import("@/lib/ai-bot.server");
                    const wasReset = await handleResetCommand({
                      conversationId: conv.id,
                      instanceName: `cloud:${phoneNumberId ?? ""}`,
                      phone: from,
                      text: m.text.body,
                    });
                    if (wasReset) continue;
                  }

                  // Handoff command: /assumir <numero>
                  if (m.type === "text" && m.text?.body && /^\s*\/assumir\b/i.test(m.text.body)) {
                    const { handleHandoffCommand } = await import("@/lib/ai-bot.server");
                    const handled = await handleHandoffCommand({
                      instanceId: instance.id,
                      instanceName: `cloud:${phoneNumberId ?? ""}`,
                      fromPhone: from,
                      text: m.text.body,
                    });
                    if (handled) continue;
                  }

                  // Fire bot reply for inbound messages
                  if (m.type === "text" || m.type === "image" || m.type === "document") {
                    const { handleBotReply } = await import("@/lib/ai-bot.server");
                    await handleBotReply(conv.id);
                  }
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