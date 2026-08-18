import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { fail, json, ok, supabaseForUser } from "../supabase";

export default defineTool({
  name: "get_contact",
  title: "Detalhes do contato",
  description:
    "Retorna um contato completo por id ou telefone, com conversas, últimas mensagens e eventos de intenção.",
  inputSchema: {
    contact_id: z.string().uuid().optional(),
    phone: z.string().trim().optional().describe("Telefone com DDI+DDD, apenas dígitos."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) return fail("Não autenticado.");
    if (!input.contact_id && !input.phone) return fail("Informe contact_id ou phone.");
    const supabase = supabaseForUser(ctx);
    let q = supabase.from("contacts").select("*").limit(1);
    q = input.contact_id
      ? q.eq("id", input.contact_id)
      : q.eq("phone", String(input.phone).replace(/\D/g, ""));
    const { data: contacts, error } = await q;
    if (error) return fail(error.message);
    const contact = contacts?.[0];
    if (!contact) return fail("Contato não encontrado.");

    const [{ data: convs }, { data: intents }] = await Promise.all([
      supabase
        .from("conversations")
        .select("id, status, bot_active, unread_count, last_message_at, last_message_preview, intent_temperature")
        .eq("contact_id", contact.id)
        .order("last_message_at", { ascending: false }),
      supabase
        .from("lead_intent_events")
        .select("intent, temperature, score, summary, suggested_next, created_at")
        .eq("contact_id", contact.id)
        .order("created_at", { ascending: false })
        .limit(5),
    ]);

    let messages: unknown[] = [];
    if (convs?.length) {
      const { data: msgs } = await supabase
        .from("messages")
        .select("id, conversation_id, direction, type, content, status, created_at")
        .in("conversation_id", convs.map((c) => c.id))
        .order("created_at", { ascending: false })
        .limit(30);
      messages = (msgs ?? []).reverse();
    }

    const payload = { contact, conversations: convs ?? [], recent_messages: messages, intent_events: intents ?? [] };
    return ok(json(payload), payload as Record<string, unknown>);
  },
});