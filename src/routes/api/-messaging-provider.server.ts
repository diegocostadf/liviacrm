import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";

const schema = z.object({ provider: z.enum(["evolution", "twilio", "cloud", "zapi"]) });

function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}

async function requireAdmin(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) throw new Error("Sessão expirada. Faça login novamente.");
  const token = authHeader.replace("Bearer ", "");
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Backend de autenticação não configurado.");
  const supabase = createClient<Database>(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getClaims(token);
  if (error || !data?.claims?.sub) throw new Error("Sessão inválida. Faça login novamente.");
  const userId = data.claims.sub;
  const { data: roles } = await supabaseAdmin.from("user_roles").select("role").eq("user_id", userId);
  const isAdmin = (roles ?? []).some((r) => r.role === "admin");
  if (!isAdmin) throw new Error("Acesso restrito a administradores.");
  return userId;
}

type Provider = "evolution" | "twilio" | "cloud" | "zapi";
async function readProvider(): Promise<Provider> {
  const { data } = await supabaseAdmin
    .from("app_settings").select("value").eq("key", "messaging_provider").maybeSingle();
  const v = (data?.value ?? {}) as { provider?: string };
  return v.provider === "twilio" ? "twilio"
    : v.provider === "cloud" ? "cloud"
    : v.provider === "zapi" ? "zapi"
    : "evolution";
}

export async function handleGet(request: Request) {
  try {
    await requireAdmin(request);
    return json({ provider: await readProvider() });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}

export async function handlePost(request: Request) {
  try {
    const userId = await requireAdmin(request);
    const { provider } = schema.parse(await request.json());
    const { error } = await supabaseAdmin
      .from("app_settings")
      .upsert({ key: "messaging_provider", value: { provider }, updated_by: userId }, { onConflict: "key" });
    if (error) throw new Error(error.message);
    return json({ provider });
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.issues.map((i) => i.message).join("; ") : (e instanceof Error ? e.message : String(e));
    return json({ error: msg }, 500);
  }
}