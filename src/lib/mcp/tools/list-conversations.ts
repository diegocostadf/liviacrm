import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { fail, json, ok, supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_conversations",
  title: "Listar conversas",
  description: "Lista conversas do inbox com contato, status, bot ligado/desligado e prévia da última mensagem.",
  inputSchema: {
    status: z.enum(["open", "archived"]).optional(),
    only_unread: z.boolean().optional(),
    bot_active: z.boolean().optional(),
    limit: z.number().int().min(1).max(100).default(20),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) return fail("Não autenticado.");
    const supabase = supabaseForUser(ctx);
    let q = supabase
      .from("conversations")
      .select(
        "id, status, bot_active, unread_count, last_message_at, last_message_preview, intent_temperature, instance_id, contacts(id, name, phone, lead_status, opted_out)",
      )
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(input.limit);
    if (input.status) q = q.eq("status", input.status);
    if (input.only_unread) q = q.gt("unread_count", 0);
    if (typeof input.bot_active === "boolean") q = q.eq("bot_active", input.bot_active);
    const { data, error } = await q;
    if (error) return fail(error.message);
    return ok(json(data ?? []), { conversations: data ?? [] });
  },
});