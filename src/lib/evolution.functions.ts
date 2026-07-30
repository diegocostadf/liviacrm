import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { evolutionFetch, pingEvolution } from "./evolution.server";

const nameSchema = z.object({ name: z.string().min(1).max(60).regex(/^[a-zA-Z0-9_-]+$/) });

export const testConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    try {
      const r = await pingEvolution();
      return r;
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    }
  });

function buildWebhookUrl() {
  const base = process.env.PUBLIC_APP_URL
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  return base ? `${base.replace(/\/$/, "")}/api/public/webhooks/evolution` : undefined;
}

export const listInstances = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { data, error } = await supabaseAdmin
      .from("whatsapp_instances")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const createInstance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => nameSchema.parse(d))
  .handler(async ({ data, context }) => {
    const evoName = data.name.toLowerCase();
    const webhookUrl = buildWebhookUrl();
    const payload: Record<string, unknown> = {
      instanceName: evoName,
      integration: "WHATSAPP-BAILEYS",
      qrcode: true,
    };
    if (webhookUrl) {
      payload.webhook = {
        url: webhookUrl,
        byEvents: false,
        base64: true,
        events: ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CONNECTION_UPDATE", "QRCODE_UPDATED", "CONTACTS_UPSERT"],
      };
    }
    await evolutionFetch("/instance/create", { method: "POST", json: payload });
    const { data: inserted, error } = await supabaseAdmin
      .from("whatsapp_instances")
      .insert({
        name: data.name,
        evolution_instance_name: evoName,
        status: "disconnected",
        owner_id: context.userId,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return inserted;
  });

export const connectInstance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => nameSchema.parse(d))
  .handler(async ({ data }) => {
    const res = (await evolutionFetch(`/instance/connect/${data.name}`)) as Record<string, unknown>;
    await supabaseAdmin
      .from("whatsapp_instances")
      .update({ status: "connecting", last_sync_at: new Date().toISOString() })
      .eq("evolution_instance_name", data.name);
    const qr = (res?.base64 as string) ?? (res?.qrcode as { base64?: string })?.base64 ?? null;
    const code = (res?.code as string) ?? (res?.qrcode as { code?: string })?.code ?? null;
    return { qrBase64: qr, pairingCode: code };
  });

export const fetchInstanceStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => nameSchema.parse(d))
  .handler(async ({ data }) => {
    try {
      const state = (await evolutionFetch(`/instance/connectionState/${data.name}`)) as { instance?: { state?: string } };
      const stateStr = state?.instance?.state ?? "disconnected";
      let mapped: "connected" | "connecting" | "disconnected" = "disconnected";
      if (stateStr === "open") mapped = "connected";
      else if (stateStr === "connecting") mapped = "connecting";

      let phone: string | undefined;
      let profileName: string | undefined;
      let profilePic: string | undefined;
      if (mapped === "connected") {
        try {
          const info = (await evolutionFetch(`/instance/fetchInstances?instanceName=${data.name}`)) as unknown;
          const inst = Array.isArray(info) ? info[0] : info;
          const owner = (inst as { instance?: { owner?: string; profileName?: string; profilePictureUrl?: string } })?.instance;
          phone = owner?.owner?.split("@")[0];
          profileName = owner?.profileName;
          profilePic = owner?.profilePictureUrl;
        } catch { /* noop */ }
      }

      await supabaseAdmin
        .from("whatsapp_instances")
        .update({
          status: mapped,
          phone_number: phone ?? null,
          profile_name: profileName ?? null,
          profile_pic_url: profilePic ?? null,
          last_sync_at: new Date().toISOString(),
        })
        .eq("evolution_instance_name", data.name);

      return { status: mapped, phone, profileName, profilePic };
    } catch (e) {
      return { status: "disconnected" as const, error: String(e) };
    }
  });

export const disconnectInstance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => nameSchema.parse(d))
  .handler(async ({ data }) => {
    await evolutionFetch(`/instance/logout/${data.name}`, { method: "DELETE" });
    await supabaseAdmin
      .from("whatsapp_instances")
      .update({ status: "disconnected" })
      .eq("evolution_instance_name", data.name);
    return { ok: true };
  });

export const restartInstance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => nameSchema.parse(d))
  .handler(async ({ data }) => {
    await evolutionFetch(`/instance/restart/${data.name}`, { method: "POST" });
    return { ok: true };
  });

export const deleteInstance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => nameSchema.parse(d))
  .handler(async ({ data }) => {
    try { await evolutionFetch(`/instance/logout/${data.name}`, { method: "DELETE" }); } catch { /* noop */ }
    try { await evolutionFetch(`/instance/delete/${data.name}`, { method: "DELETE" }); } catch { /* noop */ }
    await supabaseAdmin.from("whatsapp_instances").delete().eq("evolution_instance_name", data.name);
    return { ok: true };
  });

const sendTextSchema = z.object({
  conversationId: z.string().uuid(),
  text: z.string().min(1).max(4096),
});

export const sendTextMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => sendTextSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { data: conv, error: convErr } = await supabaseAdmin
      .from("conversations")
      .select("id, contact_id, instance_id, contacts(phone), whatsapp_instances(evolution_instance_name)")
      .eq("id", data.conversationId)
      .single();
    if (convErr || !conv) throw new Error("Conversation not found");
    const contact = (conv as unknown as { contacts: { phone: string } }).contacts;
    const instance = (conv as unknown as { whatsapp_instances: { evolution_instance_name: string } }).whatsapp_instances;

    // Envia pelo provedor ativo (Evolution, Twilio, WhatsApp Cloud ou Z-API).
    const { brokerSendText } = await import("./messaging-broker.server");
    const res = await brokerSendText({
      toPhone: contact.phone,
      text: data.text,
      evolutionInstanceName: instance?.evolution_instance_name ?? null,
      contactId: conv.contact_id,
    });

    const { data: msg, error: msgErr } = await supabaseAdmin
      .from("messages")
      .insert({
        conversation_id: data.conversationId,
        direction: "out",
        type: "text",
        content: data.text,
        status: "sent",
        wa_message_id: res.id,
        sender_id: context.userId,
      })
      .select()
      .single();
    if (msgErr) throw new Error(msgErr.message);

    await supabaseAdmin
      .from("conversations")
      .update({
        last_message_at: new Date().toISOString(),
        last_message_preview: data.text.slice(0, 120),
        unread_count: 0,
      })
      .eq("id", data.conversationId);

    return msg;
  });

const sendMediaSchema = z.object({
  conversationId: z.string().uuid(),
  mediaBase64: z.string().min(10), // raw base64 (no data: prefix)
  mimetype: z.string().min(3).max(100),
  filename: z.string().min(1).max(200),
  caption: z.string().max(1024).optional(),
});

export const sendMediaMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => sendMediaSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { data: conv, error: convErr } = await supabaseAdmin
      .from("conversations")
      .select("id, contacts(phone), whatsapp_instances(evolution_instance_name)")
      .eq("id", data.conversationId)
      .single();
    if (convErr || !conv) throw new Error("Conversation not found");
    const contact = (conv as unknown as { contacts: { phone: string } }).contacts;
    const instance = (conv as unknown as { whatsapp_instances: { evolution_instance_name: string } }).whatsapp_instances;

    let mediatype: "image" | "video" | "audio" | "document" = "document";
    if (data.mimetype.startsWith("image/")) mediatype = "image";
    else if (data.mimetype.startsWith("video/")) mediatype = "video";
    else if (data.mimetype.startsWith("audio/")) mediatype = "audio";

    const path = mediatype === "audio"
      ? `/message/sendWhatsAppAudio/${instance.evolution_instance_name}`
      : `/message/sendMedia/${instance.evolution_instance_name}`;

    const payload: Record<string, unknown> = mediatype === "audio"
      ? { number: contact.phone, audio: data.mediaBase64 }
      : {
          number: contact.phone,
          mediatype,
          mimetype: data.mimetype,
          caption: data.caption ?? "",
          media: data.mediaBase64,
          fileName: data.filename,
        };

    const res = (await evolutionFetch(path, { method: "POST", json: payload })) as { key?: { id?: string } };

    const dataUrl = `data:${data.mimetype};base64,${data.mediaBase64}`;
    const dbType: "image" | "video" | "audio" | "document" = mediatype;
    const preview = data.caption || (mediatype === "image" ? "[imagem]" : mediatype === "audio" ? "[áudio]" : mediatype === "video" ? "[vídeo]" : `[${data.filename}]`);

    const { data: msg, error: msgErr } = await supabaseAdmin
      .from("messages")
      .insert({
        conversation_id: data.conversationId,
        direction: "out",
        type: dbType,
        content: data.caption ?? null,
        media_url: dataUrl,
        media_mime: data.mimetype,
        status: "sent",
        wa_message_id: res?.key?.id ?? null,
        sender_id: context.userId,
        metadata: { filename: data.filename },
      })
      .select()
      .single();
    if (msgErr) throw new Error(msgErr.message);

    await supabaseAdmin
      .from("conversations")
      .update({
        last_message_at: new Date().toISOString(),
        last_message_preview: preview.slice(0, 120),
        unread_count: 0,
      })
      .eq("id", data.conversationId);

    return msg;
  });