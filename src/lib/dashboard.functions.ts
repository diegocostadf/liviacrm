import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getDashboardStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayIso = today.toISOString();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

    const [
      totalLeads,
      todayLeads,
      activeConvs,
      unread,
      connectedInstances,
      msgsLast7,
    ] = await Promise.all([
      supabase.from("contacts").select("id", { count: "exact", head: true }),
      supabase.from("contacts").select("id", { count: "exact", head: true }).gte("created_at", todayIso),
      supabase.from("conversations").select("id", { count: "exact", head: true }).eq("status", "open"),
      supabase.from("conversations").select("id", { count: "exact", head: true }).gt("unread_count", 0),
      supabase.from("whatsapp_instances").select("id", { count: "exact", head: true }).eq("status", "connected"),
      supabase.from("messages").select("direction, created_at").gte("created_at", sevenDaysAgo).limit(5000),
    ]);

    // Aggregate messages by day
    const days: Record<string, { date: string; in: number; out: number }> = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 3600 * 1000);
      const key = d.toISOString().slice(0, 10);
      days[key] = { date: key, in: 0, out: 0 };
    }
    for (const m of msgsLast7.data ?? []) {
      const key = String(m.created_at).slice(0, 10);
      if (!days[key]) continue;
      if (m.direction === "in") days[key].in += 1;
      else days[key].out += 1;
    }

    return {
      totalLeads: totalLeads.count ?? 0,
      todayLeads: todayLeads.count ?? 0,
      activeConversations: activeConvs.count ?? 0,
      unreadConversations: unread.count ?? 0,
      connectedInstances: connectedInstances.count ?? 0,
      messageSeries: Object.values(days),
    };
  });