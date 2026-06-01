import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const listFiltersSchema = z.object({
  status: z.enum(["open", "archived", "all"]).optional(),
  unread: z.boolean().optional(),
  favorites: z.boolean().optional(),
  mine: z.boolean().optional(),
  instanceId: z.string().uuid().optional(),
  tag: z.string().min(1).max(60).optional(),
}).optional();

export const listConversations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => listFiltersSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const f = data ?? {};
    let q = supabase
      .from("conversations")
      .select(`
        id, status, is_favorite, unread_count, last_message_at, last_message_preview, assigned_to, instance_id,
        contact:contacts!inner(id, name, phone, profile_pic_url, city, state, tags),
        instance:whatsapp_instances!inner(id, name, evolution_instance_name)
      `)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(300);
    if (!f.status || f.status === "open") q = q.eq("status", "open");
    else if (f.status === "archived") q = q.eq("status", "archived");
    if (f.unread) q = q.gt("unread_count", 0);
    if (f.favorites) q = q.eq("is_favorite", true);
    if (f.mine) q = q.eq("assigned_to", userId);
    if (f.instanceId) q = q.eq("instance_id", f.instanceId);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    const filtered = f.tag
      ? (rows ?? []).filter((r) => (r.contact?.tags ?? []).includes(f.tag!))
      : (rows ?? []);
    return filtered;
  });

export const getConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const [{ data: conv }, { data: messages }, { data: notes }] = await Promise.all([
      supabase.from("conversations").select(`
        id, status, is_favorite, unread_count, last_message_at, assigned_to, instance_id,
        contact:contacts!inner(*),
        instance:whatsapp_instances!inner(id, name, evolution_instance_name, status)
      `).eq("id", data.id).maybeSingle(),
      supabase.from("messages").select("*").eq("conversation_id", data.id).order("created_at", { ascending: true }).limit(500),
      supabase.from("internal_notes").select("*, author:profiles(display_name, avatar_url)").eq("conversation_id", data.id).order("created_at", { ascending: false }),
    ]);
    if (!conv) throw new Error("Conversation not found");
    return { conversation: conv, messages: messages ?? [], notes: notes ?? [] };
  });

export const markRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    await supabase.from("conversations").update({ unread_count: 0 }).eq("id", data.id);
    return { ok: true };
  });

export const toggleFavorite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid(), value: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    await supabase.from("conversations").update({ is_favorite: data.value }).eq("id", data.id);
    return { ok: true };
  });

export const setArchived = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid(), archived: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    await supabase.from("conversations").update({ status: data.archived ? "archived" : "open" }).eq("id", data.id);
    return { ok: true };
  });

export const addNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ conversationId: z.string().uuid(), content: z.string().min(1).max(2000) }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("internal_notes")
      .insert({ conversation_id: data.conversationId, content: data.content, author_id: userId })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const updateContact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    id: z.string().uuid(),
    name: z.string().max(255).optional(),
    city: z.string().max(120).optional(),
    state: z.string().max(60).optional(),
    email: z.string().email().max(255).optional().or(z.literal("")),
    company: z.string().max(255).optional(),
    tags: z.array(z.string().max(60)).max(50).optional(),
    assigned_to: z.string().uuid().nullable().optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { id, ...rest } = data;
    const { error } = await supabase.from("contacts").update(rest).eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listTeam = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data } = await supabase.from("profiles").select("id, display_name, email, avatar_url");
    return data ?? [];
  });

export const transferConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    id: z.string().uuid(),
    assignedTo: z.string().uuid().nullable(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase.from("conversations").update({ assigned_to: data.assignedTo }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setUnread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    await supabase.from("conversations").update({ unread_count: 1 }).eq("id", data.id);
    return { ok: true };
  });