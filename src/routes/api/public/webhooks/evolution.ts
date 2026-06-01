import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { loadEvolutionSettings } from "@/lib/evolution.server";
import { handleBotReply, handleHandoffCommand, handleResetCommand } from "@/lib/ai-bot.server";
import { handleOptOut, markRepliesForPhone } from "@/lib/campaign-steps.server";

export const Route = createFileRoute("/api/public/webhooks/evolution")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { webhookToken: token } = await loadEvolutionSettings();
        const url = new URL(request.url);
        const provided = request.headers.get("x-webhook-token") || url.searchParams.get("token");
        if (token && provided !== token) {
          return new Response("Invalid token", { status: 401 });
        }

        let payload: Record<string, unknown>;
        try { payload = await request.json(); } catch { return new Response("Bad JSON", { status: 400 }); }

        const event = String(payload.event ?? "").toUpperCase().replace(/\./g, "_");
        const instanceName = String(payload.instance ?? (payload as { instanceName?: string }).instanceName ?? "");
        const data = payload.data as Record<string, unknown> | undefined;

        try {
          if (event === "CONNECTION_UPDATE" && data) {
            const state = String(data.state ?? "");
            const mapped = state === "open" ? "connected" : state === "connecting" ? "connecting" : "disconnected";
            await supabaseAdmin
              .from("whatsapp_instances")
              .update({ status: mapped, last_sync_at: new Date().toISOString() })
              .eq("evolution_instance_name", instanceName);
          } else if (event === "MESSAGES_UPSERT" && data) {
            await handleIncomingMessage(instanceName, data);
          }
        } catch (e) {
          console.error("[evolution-webhook]", e);
          return new Response("Internal error", { status: 500 });
        }

        return new Response("ok");
      },
    },
  },
});

async function handleIncomingMessage(instanceName: string, data: Record<string, unknown>) {
  const key = data.key as { remoteJid?: string; fromMe?: boolean; id?: string } | undefined;
  const message = data.message as Record<string, unknown> | undefined;
  if (!key?.remoteJid || !message) return;
  if (key.remoteJid.endsWith("@g.us")) return; // skip groups for now

  const phone = key.remoteJid.split("@")[0];
  const direction = key.fromMe ? "out" : "in";
  const pushName = (data.pushName as string) ?? null;
  const messageTimestamp = data.messageTimestamp ? new Date(Number(data.messageTimestamp) * 1000).toISOString() : new Date().toISOString();

  let text = "";
  let type: "text" | "image" | "audio" | "video" | "document" | "location" | "sticker" | "contact" = "text";
  let mediaUrl: string | null = null;
  let mediaMime: string | null = null;
  const base64 = typeof (data.message as { base64?: unknown }).base64 === "string"
    ? ((data.message as { base64?: string }).base64 as string)
    : (typeof (data as { base64?: unknown }).base64 === "string" ? ((data as { base64?: string }).base64 as string) : null);
  if (typeof message.conversation === "string") {
    text = message.conversation;
  } else if (message.extendedTextMessage) {
    text = (message.extendedTextMessage as { text?: string }).text ?? "";
  } else if (message.imageMessage) {
    type = "image";
    const m = message.imageMessage as { caption?: string; mimetype?: string };
    text = m.caption ?? "[imagem]";
    mediaMime = m.mimetype ?? "image/jpeg";
    if (base64) mediaUrl = `data:${mediaMime};base64,${base64}`;
  } else if (message.audioMessage) {
    type = "audio";
    text = "[áudio]";
    const m = message.audioMessage as { mimetype?: string };
    mediaMime = m.mimetype ?? "audio/ogg";
    if (base64) mediaUrl = `data:${mediaMime};base64,${base64}`;
  } else if (message.videoMessage) {
    type = "video";
    const m = message.videoMessage as { caption?: string; mimetype?: string };
    text = m.caption ?? "[vídeo]";
    mediaMime = m.mimetype ?? "video/mp4";
    if (base64) mediaUrl = `data:${mediaMime};base64,${base64}`;
  } else if (message.documentMessage) {
    type = "document";
    const m = message.documentMessage as { fileName?: string; mimetype?: string };
    text = m.fileName ?? "[documento]";
    mediaMime = m.mimetype ?? "application/octet-stream";
    if (base64) mediaUrl = `data:${mediaMime};base64,${base64}`;
  } else if (message.locationMessage) {
    type = "location";
    const m = message.locationMessage as { degreesLatitude?: number; degreesLongitude?: number };
    text = `📍 ${m.degreesLatitude},${m.degreesLongitude}`;
  } else { text = "[mensagem]"; }

  // Get instance
  const { data: inst } = await supabaseAdmin
    .from("whatsapp_instances")
    .select("id")
    .eq("evolution_instance_name", instanceName)
    .maybeSingle();
  if (!inst) return;

  // Handoff command: if the inbound sender matches the bot's handoff_phone
  // and message starts with /assumir, disable the bot on the target conversation
  // and short-circuit (no contact upsert, no bot reply).
  if (direction === "in" && typeof text === "string" && /^\s*\/assumir\b/i.test(text)) {
    const handled = await handleHandoffCommand({
      instanceId: inst.id,
      instanceName,
      fromPhone: phone,
      text,
    });
    if (handled) return;
  }

  // Opt-out LGPD: SAIR / PARAR / NÃO etc. Marca contato e cancela steps pendentes.
  if (direction === "in" && typeof text === "string") {
    const optedOut = await handleOptOut({ instanceName, phone, text });
    if (optedOut) return;
  }

  // Toda mensagem inbound marca como 'replied' os step_sends pendentes desse telefone.
  if (direction === "in") {
    await markRepliesForPhone(phone).catch((e) => console.warn("[markReplies]", e));
  }

  // Upsert contact
  let contactId: string;
  const { data: existingContact } = await supabaseAdmin
    .from("contacts")
    .select("id, name")
    .eq("phone", phone)
    .maybeSingle();
  if (existingContact) {
    contactId = existingContact.id;
    if (!existingContact.name && pushName) {
      await supabaseAdmin.from("contacts").update({ name: pushName }).eq("id", contactId);
    }
  } else {
    const { data: newContact, error } = await supabaseAdmin
      .from("contacts")
      .insert({ phone, name: pushName })
      .select("id")
      .single();
    if (error || !newContact) return;
    contactId = newContact.id;
  }

  // Upsert conversation
  let conversationId: string;
  let isNewConversation = false;
  const { data: existingConv } = await supabaseAdmin
    .from("conversations")
    .select("id, unread_count")
    .eq("contact_id", contactId)
    .eq("instance_id", inst.id)
    .maybeSingle();
  if (existingConv) {
    conversationId = existingConv.id;
  } else {
    // If a bot is enabled for this instance, the new conversation starts with bot_active=true
    const { data: botCfg } = await supabaseAdmin
      .from("ai_bot_configs")
      .select("enabled")
      .eq("instance_id", inst.id)
      .maybeSingle();
    const { data: newConv, error } = await supabaseAdmin
      .from("conversations")
      .insert({
        contact_id: contactId,
        instance_id: inst.id,
        status: "open",
        bot_active: Boolean(botCfg?.enabled),
      })
      .select("id")
      .single();
    if (error || !newConv) return;
    conversationId = newConv.id;
    isNewConversation = true;
  }

  // Insert message (idempotent on wa_message_id)
  if (key.id) {
    const { data: dup } = await supabaseAdmin
      .from("messages")
      .select("id")
      .eq("wa_message_id", key.id)
      .maybeSingle();
    if (dup) return;
  }

  await supabaseAdmin.from("messages").insert({
    conversation_id: conversationId,
    direction,
    type,
    content: text,
    media_url: mediaUrl,
    media_mime: mediaMime,
    status: direction === "out" ? "sent" : "delivered",
    wa_message_id: key.id ?? null,
    created_at: messageTimestamp,
  });

  await supabaseAdmin
    .from("conversations")
    .update({
      last_message_at: messageTimestamp,
      last_message_preview: text.slice(0, 120),
      unread_count: direction === "in" ? ((existingConv?.unread_count ?? 0) + 1) : 0,
    })
    .eq("id", conversationId);

  // Reset command from the lead's WhatsApp (/resetar, /reset, /reiniciar)
  if (direction === "in" && typeof text === "string") {
    const wasReset = await handleResetCommand({
      conversationId,
      instanceName,
      phone,
      text,
    });
    if (wasReset) return;
  }

  // Fire bot reply for inbound text-ish messages. Never await — webhook must
  // return quickly. Errors are swallowed inside handleBotReply.
  if (direction === "in" && (type === "text" || type === "image" || type === "document")) {
    // In serverless workers, fire-and-forget is cancelled when the Response
    // returns. Await so the bot actually runs. handleBotReply never throws.
    await handleBotReply(conversationId);
  }
  void isNewConversation;
}