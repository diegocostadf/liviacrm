import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const Route = createFileRoute("/api/public/webhooks/evolution")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = process.env.EVOLUTION_WEBHOOK_TOKEN;
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
  let type: "text" | "image" | "audio" | "video" | "document" | "location" | "other" = "text";
  if (typeof message.conversation === "string") {
    text = message.conversation;
  } else if (message.extendedTextMessage) {
    text = (message.extendedTextMessage as { text?: string }).text ?? "";
  } else if (message.imageMessage) {
    type = "image";
    text = (message.imageMessage as { caption?: string }).caption ?? "[imagem]";
  } else if (message.audioMessage) { type = "audio"; text = "[áudio]"; }
  else if (message.videoMessage) { type = "video"; text = (message.videoMessage as { caption?: string }).caption ?? "[vídeo]"; }
  else if (message.documentMessage) { type = "document"; text = "[documento]"; }
  else if (message.locationMessage) { type = "location"; text = "[localização]"; }
  else { type = "other"; text = "[mensagem]"; }

  // Get instance
  const { data: inst } = await supabaseAdmin
    .from("whatsapp_instances")
    .select("id")
    .eq("evolution_instance_name", instanceName)
    .maybeSingle();
  if (!inst) return;

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
  const { data: existingConv } = await supabaseAdmin
    .from("conversations")
    .select("id, unread_count")
    .eq("contact_id", contactId)
    .eq("instance_id", inst.id)
    .maybeSingle();
  if (existingConv) {
    conversationId = existingConv.id;
  } else {
    const { data: newConv, error } = await supabaseAdmin
      .from("conversations")
      .insert({ contact_id: contactId, instance_id: inst.id, status: "open" })
      .select("id")
      .single();
    if (error || !newConv) return;
    conversationId = newConv.id;
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
    status: direction === "out" ? "sent" : "received",
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
}