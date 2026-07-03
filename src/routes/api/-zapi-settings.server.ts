import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";
import { invalidateZapiSettingsCache, pingZapi, zapiSendText } from "@/lib/zapi.server";

const updateSchema = z.object({
  action: z.literal("update"),
  instanceId: z.string().trim().min(1).max(200),
  instanceToken: z.string().trim().min(1).max(500),
  clientToken: z.string().trim().max(500).optional().or(z.literal("")),
  webhookUrl: z.string().trim().url().max(500).optional().or(z.literal("")),
});
const testSchema = z.object({ action: z.literal("test") });
const sendSchema = z.object({
  action: z.literal("send-test"),
  toPhone: z.string().trim().min(5).max(30),
  text: z.string().trim().min(1).max(1000),
});
const postSchema = z.union([updateSchema, testSchema, sendSchema]);

function json(data: unknown, status = 200) { return Response.json(data, { status }); }

async function requireAdmin(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) throw new Error("Sessão expirada.");
  const token = authHeader.replace("Bearer ", "");
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY!;
  const supabase = createClient<Database>(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getClaims(token);
  if (error || !data?.claims?.sub) throw new Error("Sessão inválida.");
  const userId = data.claims.sub;
  const { data: roles } = await supabaseAdmin.from("user_roles").select("role").eq("user_id", userId);
  if (!(roles ?? []).some((r) => r.role === "admin")) throw new Error("Acesso restrito a administradores.");
  return userId;
}

async function getSettings() {
  const { data, error } = await supabaseAdmin
    .from("app_settings")
    .select("value, updated_at")
    .eq("key", "zapi")
    .maybeSingle();
  if (error) throw new Error(error.message);
  const v = (data?.value ?? {}) as Record<string, unknown>;
  return {
    settings: {
      instanceId: typeof v.instanceId === "string" ? v.instanceId : "",
      instanceToken: typeof v.instanceToken === "string" && v.instanceToken ? "••••••••" : "",
      hasInstanceToken: Boolean(v.instanceToken),
      clientToken: typeof v.clientToken === "string" && v.clientToken ? "••••••••" : "",
      hasClientToken: Boolean(v.clientToken),
      webhookUrl: typeof v.webhookUrl === "string" ? v.webhookUrl : "",
      updatedAt: data?.updated_at ?? null,
    },
  };
}

export async function handleGet(request: Request) {
  try {
    await requireAdmin(request);
    return json(await getSettings());
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}

export async function handlePost(request: Request) {
  try {
    const userId = await requireAdmin(request);
    const payload = postSchema.parse(await request.json());

    if (payload.action === "test") {
      try { return json(await pingZapi()); }
      catch (e) { return json({ ok: false, error: e instanceof Error ? e.message : String(e) }); }
    }

    if (payload.action === "send-test") {
      try {
        const r = await zapiSendText(payload.toPhone, payload.text);
        return json({ ok: true, id: r.id });
      } catch (e) {
        return json({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }

    const { data: existing } = await supabaseAdmin
      .from("app_settings").select("value").eq("key", "zapi").maybeSingle();
    const prev = (existing?.value ?? {}) as Record<string, unknown>;

    const instanceToken = payload.instanceToken && payload.instanceToken !== "••••••••"
      ? payload.instanceToken : (prev.instanceToken as string | undefined) ?? "";
    const clientToken = payload.clientToken && payload.clientToken !== "••••••••"
      ? payload.clientToken : (prev.clientToken as string | undefined) ?? "";

    const value = {
      instanceId: payload.instanceId,
      instanceToken,
      clientToken: clientToken || undefined,
      webhookUrl: payload.webhookUrl || undefined,
    };

    const { error } = await supabaseAdmin
      .from("app_settings")
      .upsert({ key: "zapi", value, updated_by: userId }, { onConflict: "key" });
    if (error) throw new Error(error.message);

    invalidateZapiSettingsCache();
    return json(await getSettings());
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.issues.map((i) => i.message).join("; ") : (e instanceof Error ? e.message : String(e));
    return json({ error: msg }, 500);
  }
}