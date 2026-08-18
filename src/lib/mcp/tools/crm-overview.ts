import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { fail, json, ok, supabaseForUser } from "../supabase";

export default defineTool({
  name: "crm_overview",
  title: "Panorama do CRM",
  description:
    "Resumo operacional: total de leads por status, mensagens enviadas/recebidas/com erro no período, campanhas ativas e conversas em aberto.",
  inputSchema: {
    days: z.number().int().min(1).max(365).default(7).describe("Janela de análise em dias."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) return fail("Não autenticado.");
    const supabase = supabaseForUser(ctx);
    const since = new Date(Date.now() - input.days * 86400_000).toISOString();

    const countOf = async (
      table: string,
      apply: (q: ReturnType<ReturnType<typeof supabaseForUser>["from"]>) => unknown,
    ) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q: any = (supabase.from(table as never) as any).select("id", { count: "exact", head: true });
      const { count } = await (apply(q) as Promise<{ count: number | null }>);
      return count ?? 0;
    };

    const [novo, engajado, inscrito, perdido, optOut] = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      countOf("contacts", (q: any) => q.eq("lead_status", "novo")),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      countOf("contacts", (q: any) => q.eq("lead_status", "engajado")),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      countOf("contacts", (q: any) => q.eq("lead_status", "inscrito")),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      countOf("contacts", (q: any) => q.eq("lead_status", "perdido")),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      countOf("contacts", (q: any) => q.eq("opted_out", true)),
    ]);

    const [outbound, inbound, failed] = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      countOf("messages", (q: any) => q.eq("direction", "out").gte("created_at", since)),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      countOf("messages", (q: any) => q.eq("direction", "in").gte("created_at", since)),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      countOf("messages", (q: any) => q.eq("status", "failed").gte("created_at", since)),
    ]);

    const [{ data: campaigns }, openConversations, unread] = await Promise.all([
      supabase
        .from("campaigns")
        .select("id, name, status, total_count, sent_count, failed_count, replied_count")
        .in("status", ["running", "scheduled", "paused"])
        .order("created_at", { ascending: false })
        .limit(10),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      countOf("conversations", (q: any) => q.eq("status", "open")),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      countOf("conversations", (q: any) => q.gt("unread_count", 0)),
    ]);

    const payload = {
      window_days: input.days,
      leads: { novo, engajado, inscrito, perdido, opted_out: optOut, total: novo + engajado + inscrito + perdido },
      messages: { outbound, inbound, failed },
      conversations: { open: openConversations, unread },
      active_campaigns: campaigns ?? [],
    };
    return ok(json(payload), payload as unknown as Record<string, unknown>);
  },
});