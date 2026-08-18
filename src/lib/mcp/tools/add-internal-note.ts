import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { fail, json, ok, supabaseForUser } from "../supabase";

export default defineTool({
  name: "add_internal_note",
  title: "Adicionar nota interna",
  description: "Registra uma nota interna (não enviada ao cliente) em uma conversa.",
  inputSchema: {
    conversation_id: z.string().uuid(),
    content: z.string().trim().min(1).max(4000),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) return fail("Não autenticado.");
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("internal_notes")
      .insert({
        conversation_id: input.conversation_id,
        content: input.content,
        author_id: ctx.getUserId() as string,
      })
      .select()
      .single();
    if (error) return fail(error.message);
    return ok(json(data), { note: data });
  },
});