import { supabaseAdmin } from "@/integrations/supabase/client.server";

export async function assertAdmin(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  const isAdmin = (data ?? []).some((r) => r.role === "admin");
  if (!isAdmin) throw new Error("Apenas administradores podem gerenciar usuários.");
}