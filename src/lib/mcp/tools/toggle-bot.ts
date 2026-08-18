import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { fail, json, ok, supabaseForUser } from "../supabase";

export default defineTool({
  name: "set_conversation_bot",
  title: "Ligar/desligar o bot na conversa",
  description:
    "Ativa ou pausa a assistente automática (Júlia) em uma conversa específica, para permitir atendimento humano.",
  inputSchema: {
    conversation_id: z.string().uuid(),
    bot_active: z.boolean(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) return fail("Não autenticado.");
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("conversations")
      .update({ bot_active: input.bot_active })
      .eq("id", input.conversation_id)
      .select("id, bot_active, status")
      .maybeSingle();
    if (error) return fail(error.message);
    if (!data) return fail("Conversa não encontrada ou sem permissão.");
    return ok(json(data), { conversation: data });
  },
});