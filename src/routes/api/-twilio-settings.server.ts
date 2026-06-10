import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";

const updateSchema = z.object({
  action: z.literal("update"),
  accountSid: z.string().trim().min(10).max(80).regex(/^AC[a-zA-Z0-9]+$/),
  authToken: z.string().trim().max(200).optional().or(z.literal("")),
  apiKeySid: z.string().trim().max(80).optional().or(z.literal("")),
  apiKeySecret: z.string().trim().max(200).optional().or(z.literal("")),
  fromNumber: z.string().trim().max(40).optional().or(z.literal("")),
  messagingServiceSid: z.string().trim().max(80).optional().or(z.literal("")),
  whatsappFrom: z.string().trim().max(60).optional().or(z.literal("")),
  contentSid: z.string().trim().max(80).optional().or(z.literal("")),
  contentVariableKey: z.string().trim().max(20).optional().or(z.literal("")),
  webhookUrl: z.string().trim().url().max(500).optional().or(z.literal("")),
  webhookToken: z.string().trim().max(500).optional().or(z.literal("")),
});
const testSchema = z.object({ action: z.literal("test") });
const postSchema = z.union([updateSchema, testSchema]);

function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}
function getErrorMessage(error: unknown) {
  if (error instanceof z.ZodError) return error.issues.map((i) => i.message).join("; ");
  return error instanceof Error ? error.message : String(error);
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

async function getSettings() {
  const { data, error } = await supabaseAdmin
    .from("app_settings")
    .select("value, updated_at")
    .eq("key", "twilio")
    .maybeSingle();
  if (error) throw new Error(error.message);
  const value = (data?.value ?? {}) as Record<string, unknown>;
  const has = (k: string) => Boolean(value[k]);
  return {
    settings: {
      accountSid: typeof value.accountSid === "string" ? value.accountSid : "",
      authToken: has("authToken") ? "••••••••" : "",
      hasAuthToken: has("authToken"),
      apiKeySid: typeof value.apiKeySid === "string" ? value.apiKeySid : "",
      apiKeySecret: has("apiKeySecret") ? "••••••••" : "",
      hasApiKeySecret: has("apiKeySecret"),
      fromNumber: typeof value.fromNumber === "string" ? value.fromNumber : "",
      messagingServiceSid: typeof value.messagingServiceSid === "string" ? value.messagingServiceSid : "",
      whatsappFrom: typeof value.whatsappFrom === "string" ? value.whatsappFrom : "",
      contentSid: typeof value.contentSid === "string" ? value.contentSid : "",
      contentVariableKey: typeof value.contentVariableKey === "string" ? value.contentVariableKey : "",
      webhookUrl: typeof value.webhookUrl === "string" ? value.webhookUrl : "",
      webhookToken: has("webhookToken") ? "••••••••" : "",
      hasWebhookToken: has("webhookToken"),
      updatedAt: data?.updated_at ?? null,
    },
  };
}

async function pingTwilio(prev: Record<string, unknown>) {
  const sid = String(prev.accountSid ?? "");
  if (!sid) throw new Error("Account SID não configurado. Salve antes de testar.");
  const keySid = (prev.apiKeySid as string) || "";
  const keySecret = (prev.apiKeySecret as string) || "";
  const authToken = (prev.authToken as string) || "";
  let user: string;
  let pass: string;
  if (keySid && keySecret) { user = keySid; pass = keySecret; }
  else if (authToken) { user = sid; pass = authToken; }
  else throw new Error("Configure um Auth Token ou um par API Key SID/Secret.");
  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}.json`;
  const started = Date.now();
  const auth = Buffer.from(`${user}:${pass}`).toString("base64");
  const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (body as { message?: string }).message ?? `Twilio ${res.status}`;
    return { ok: false as const, error: msg };
  }
  return {
    ok: true as const,
    latencyMs: Date.now() - started,
    friendlyName: (body as { friendly_name?: string }).friendly_name ?? null,
    status: (body as { status?: string }).status ?? null,
    accountSid: sid,
  };
}

export async function handleGet(request: Request) {
  try {
    await requireAdmin(request);
    return json(await getSettings());
  } catch (error) {
    return json({ error: getErrorMessage(error) }, 500);
  }
}

export async function handlePost(request: Request) {
  try {
    const userId = await requireAdmin(request);
    const payload = postSchema.parse(await request.json());

    const { data: existing } = await supabaseAdmin
      .from("app_settings").select("value").eq("key", "twilio").maybeSingle();
    const prev = (existing?.value ?? {}) as Record<string, unknown>;

    if (payload.action === "test") return json(await pingTwilio(prev));

    const keepSecret = (incoming: string | undefined, prevKey: string) =>
      incoming && incoming !== "••••••••" ? incoming : ((prev[prevKey] as string | undefined) ?? "");

    const value = {
      accountSid: payload.accountSid,
      authToken: keepSecret(payload.authToken, "authToken"),
      apiKeySid: payload.apiKeySid || undefined,
      apiKeySecret: keepSecret(payload.apiKeySecret, "apiKeySecret"),
      fromNumber: payload.fromNumber || undefined,
      messagingServiceSid: payload.messagingServiceSid || undefined,
      whatsappFrom: payload.whatsappFrom || undefined,
      contentSid: payload.contentSid || undefined,
      contentVariableKey: payload.contentVariableKey || undefined,
      webhookUrl: payload.webhookUrl || undefined,
      webhookToken: keepSecret(payload.webhookToken, "webhookToken"),
    };

    const { error } = await supabaseAdmin
      .from("app_settings")
      .upsert({ key: "twilio", value, updated_by: userId }, { onConflict: "key" });
    if (error) throw new Error(error.message);

    return json(await getSettings());
  } catch (error) {
    return json({ error: getErrorMessage(error) }, 500);
  }
}