import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { fail, json, ok, supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_messages",
  title: "Ler mensagens da conversa",
  description: "Retorna o histórico de mensagens de uma conversa em ordem cronológica.",
  inputSchema: {
    conversation_id: z.string().uuid(),
    limit: z.number().int().min(1).max(200).default(50),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) return fail("Não autenticado.");
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("messages")
      .select("id, direction, type, content, media_url, status, sent_by, created_at, wa_message_id")
      .eq("conversation_id", input.conversation_id)
      .order("created_at", { ascending: false })
      .limit(input.limit);
    if (error) return fail(error.message);
    const messages = (data ?? []).reverse();
    return ok(json(messages), { messages });
  },
});