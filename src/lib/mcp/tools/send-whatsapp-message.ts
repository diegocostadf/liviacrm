import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { fail, json, ok, supabaseForUser } from "../supabase";

export default defineTool({
  name: "send_whatsapp_message",
  title: "Enviar mensagem no WhatsApp",
  description:
    "Envia uma mensagem de texto pelo provedor ativo (Evolution, Twilio, WhatsApp Cloud ou Z-API) para uma conversa existente ou para um telefone, e registra no histórico do CRM.",
  inputSchema: {
    conversation_id: z.string().uuid().optional(),
    phone: z.string().trim().optional().describe("Alternativa ao conversation_id: telefone com DDI+DDD."),
    text: z.string().trim().min(1).max(4096),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) return fail("Não autenticado.");
    const supabase = supabaseForUser(ctx);

    let conversationId = input.conversation_id ?? null;
    if (!conversationId) {
      if (!input.phone) return fail("Informe conversation_id ou phone.");
      const phone = input.phone.replace(/\D/g, "");
      const { data: contact } = await supabase.from("contacts").select("id").eq("phone", phone).maybeSingle();
      if (!contact) return fail("Contato não encontrado para este telefone. Crie com upsert_contact primeiro.");
      const { data: conv } = await supabase
        .from("conversations")
        .select("id")
        .eq("contact_id", contact.id)
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();
      if (!conv) return fail("Nenhuma conversa aberta para este contato. Abra pelo Inbox antes de enviar.");
      conversationId = conv.id;
    }

    // Confirma que o usuário autenticado tem acesso à conversa (via RLS).
    const { data: allowed, error: allowedErr } = await supabase
      .from("conversations")
      .select("id")
      .eq("id", conversationId)
      .maybeSingle();
    if (allowedErr) return fail(allowedErr.message);
    if (!allowed) return fail("Conversa não encontrada ou sem permissão.");
    const convId = allowed.id as string;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: conv, error: convErr } = await supabaseAdmin
      .from("conversations")
      .select("id, contact_id, contacts(phone), whatsapp_instances(evolution_instance_name)")
      .eq("id", convId)
      .single();
    if (convErr || !conv) return fail("Conversa não encontrada.");
    const contact = (conv as unknown as { contacts: { phone: string } }).contacts;
    const instance = (conv as unknown as { whatsapp_instances: { evolution_instance_name: string } | null })
      .whatsapp_instances;

    try {
      const { brokerSendText } = await import("@/lib/messaging-broker.server");
      const res = await brokerSendText({
        toPhone: contact.phone,
        text: input.text,
        evolutionInstanceName: instance?.evolution_instance_name ?? null,
        contactId: conv.contact_id,
      });
      const { data: msg, error: msgErr } = await supabaseAdmin
        .from("messages")
        .insert({
          conversation_id: convId,
          direction: "out",
          type: "text",
          content: input.text,
          status: "sent",
          wa_message_id: res.id,
          sender_id: ctx.getUserId(),
        })
        .select()
        .single();
      if (msgErr) return fail(msgErr.message);
      await supabaseAdmin
        .from("conversations")
        .update({
          last_message_at: new Date().toISOString(),
          last_message_preview: input.text.slice(0, 120),
          unread_count: 0,
        })
        .eq("id", convId);
      return ok(json({ provider: res.provider, message: msg }), { provider: res.provider, message: msg });
    } catch (e) {
      return fail(e instanceof Error ? e.message : "Falha ao enviar mensagem.");
    }
  },
});