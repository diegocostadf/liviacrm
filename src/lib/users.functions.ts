import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { assertAdmin } from "./users.server";

const ROLES = ["admin", "gestor", "vendedor", "atendimento"] as const;
const roleSchema = z.enum(ROLES);

export const listUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { data: authData, error } = await supabaseAdmin.auth.admin.listUsers({ perPage: 200 });
    if (error) throw new Error(error.message);
    const ids = authData.users.map((u) => u.id);
    const [{ data: profiles }, { data: roles }] = await Promise.all([
      supabaseAdmin.from("profiles").select("id, display_name, email, avatar_url").in("id", ids),
      supabaseAdmin.from("user_roles").select("user_id, role").in("user_id", ids),
    ]);
    const pmap = new Map((profiles ?? []).map((p) => [p.id, p]));
    const rmap = new Map<string, string[]>();
    for (const r of roles ?? []) {
      const arr = rmap.get(r.user_id) ?? [];
      arr.push(r.role as string);
      rmap.set(r.user_id, arr);
    }
    return authData.users.map((u) => ({
      id: u.id,
      email: u.email ?? pmap.get(u.id)?.email ?? null,
      display_name: pmap.get(u.id)?.display_name ?? null,
      avatar_url: pmap.get(u.id)?.avatar_url ?? null,
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at ?? null,
      email_confirmed_at: u.email_confirmed_at ?? null,
      roles: rmap.get(u.id) ?? [],
    }));
  });

export const createUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      email: z.string().email().max(200),
      password: z.string().min(8).max(72),
      display_name: z.string().trim().min(1).max(120),
      role: roleSchema,
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { display_name: data.display_name },
    });
    if (error) throw new Error(error.message);
    const uid = created.user!.id;
    // upsert profile (trigger should create it, ensure values)
    await supabaseAdmin.from("profiles").upsert({ id: uid, display_name: data.display_name, email: data.email });
    // ensure single role: remove existing then insert chosen one
    await supabaseAdmin.from("user_roles").delete().eq("user_id", uid);
    const { error: rErr } = await supabaseAdmin.from("user_roles").insert({ user_id: uid, role: data.role });
    if (rErr) throw new Error(rErr.message);
    return { id: uid };
  });

export const updateUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      id: z.string().uuid(),
      display_name: z.string().trim().min(1).max(120).optional(),
      email: z.string().email().max(200).optional(),
      password: z.string().min(8).max(72).optional(),
      role: roleSchema.optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const authPatch: Record<string, unknown> = {};
    if (data.email) authPatch.email = data.email;
    if (data.password) authPatch.password = data.password;
    if (data.display_name) authPatch.user_metadata = { display_name: data.display_name };
    if (Object.keys(authPatch).length > 0) {
      const { error } = await supabaseAdmin.auth.admin.updateUserById(data.id, authPatch);
      if (error) throw new Error(error.message);
    }
    const profilePatch: Record<string, unknown> = {};
    if (data.display_name !== undefined) profilePatch.display_name = data.display_name;
    if (data.email !== undefined) profilePatch.email = data.email;
    if (Object.keys(profilePatch).length > 0) {
      await supabaseAdmin.from("profiles").update(profilePatch).eq("id", data.id);
    }
    if (data.role) {
      await supabaseAdmin.from("user_roles").delete().eq("user_id", data.id);
      const { error: rErr } = await supabaseAdmin.from("user_roles").insert({ user_id: data.id, role: data.role });
      if (rErr) throw new Error(rErr.message);
    }
    return { ok: true };
  });

export const deleteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    if (data.id === context.userId) throw new Error("Você não pode remover seu próprio usuário.");
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });