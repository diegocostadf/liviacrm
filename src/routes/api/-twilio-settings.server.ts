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
const discoverSchema = z.object({
  action: z.literal("discover"),
  accountSid: z.string().trim().regex(/^AC[a-zA-Z0-9]+$/).optional().or(z.literal("")),
  authToken: z.string().trim().max(200).optional().or(z.literal("")),
  apiKeySid: z.string().trim().max(80).optional().or(z.literal("")),
  apiKeySecret: z.string().trim().max(200).optional().or(z.literal("")),
});
const sendTestSchema = z.object({
  action: z.literal("send-test"),
  toPhone: z.string().trim().min(5).max(40),
  text: z.string().trim().min(1).max(1000),
  useTemplate: z.boolean().optional(),
});
const crmTestSchema = z.object({ action: z.literal("crm-test") });
const postSchema = z.union([updateSchema, testSchema, discoverSchema, sendTestSchema, crmTestSchema]);

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

function pickCreds(
  prev: Record<string, unknown>,
  incoming: { accountSid?: string; authToken?: string; apiKeySid?: string; apiKeySecret?: string },
) {
  const sid = (incoming.accountSid && incoming.accountSid.trim()) || String(prev.accountSid ?? "");
  const keySid = (incoming.apiKeySid && incoming.apiKeySid.trim()) || (prev.apiKeySid as string) || "";
  const incSecret = incoming.apiKeySecret && incoming.apiKeySecret !== "••••••••" ? incoming.apiKeySecret : "";
  const keySecret = incSecret || (prev.apiKeySecret as string) || "";
  const incToken = incoming.authToken && incoming.authToken !== "••••••••" ? incoming.authToken : "";
  const authToken = incToken || (prev.authToken as string) || "";
  if (!sid) throw new Error("Informe o Account SID.");
  let user: string, pass: string;
  if (keySid && keySecret) { user = keySid; pass = keySecret; }
  else if (authToken) { user = sid; pass = authToken; }
  else throw new Error("Informe um Auth Token ou um par API Key SID/Secret.");
  return { sid, user, pass };
}

async function twilioGet(url: string, user: string, pass: string) {
  const auth = Buffer.from(`${user}:${pass}`).toString("base64");
  const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (body as { message?: string }).message ?? `Twilio ${res.status}`;
    throw new Error(msg);
  }
  return body as Record<string, unknown>;
}

async function discoverTwilio(
  prev: Record<string, unknown>,
  incoming: { accountSid?: string; authToken?: string; apiKeySid?: string; apiKeySecret?: string },
) {
  const { sid, user, pass } = pickCreds(prev, incoming);
  const started = Date.now();
  const account = await twilioGet(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`, user, pass);

  // run discovery requests in parallel, tolerate per-endpoint failures
  const safe = async <T,>(p: Promise<T>): Promise<{ ok: true; data: T } | { ok: false; error: string }> => {
    try { return { ok: true, data: await p }; }
    catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  };

  const [numbersR, servicesR, contentR] = await Promise.all([
    safe(twilioGet(`https://api.twilio.com/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers.json?PageSize=50`, user, pass)),
    safe(twilioGet(`https://messaging.twilio.com/v1/Services?PageSize=50`, user, pass)),
    safe(twilioGet(`https://content.twilio.com/v1/Content?PageSize=50`, user, pass)),
  ]);

  // WhatsApp senders (self-serve v1 + multi-channel v2). Either may 404 by region/plan.
  const [waV1R, waV2R] = await Promise.all([
    safe(twilioGet(`https://messaging.twilio.com/v1/whatsapp/Senders?PageSize=50`, user, pass)),
    safe(twilioGet(`https://messaging.twilio.com/v2/Channels/Senders?PageSize=50`, user, pass)),
  ]);
  const waSenders: Array<{ sid: string; phoneNumber: string; status: string; profileName: string }> = [];
  if (waV1R.ok) {
    for (const s of ((waV1R.data.senders ?? []) as Array<Record<string, unknown>>)) {
      const phone = String(s.phone_number ?? s.sender_id ?? "").replace(/^whatsapp:/, "");
      if (!phone) continue;
      waSenders.push({
        sid: String(s.sid ?? ""),
        phoneNumber: phone,
        status: String(s.status ?? ""),
        profileName: String(((s.profile ?? {}) as Record<string, unknown>).name ?? ""),
      });
    }
  }
  if (waV2R.ok) {
    for (const s of ((waV2R.data.senders ?? []) as Array<Record<string, unknown>>)) {
      const senderId = String(s.sender_id ?? "");
      if (!senderId.startsWith("whatsapp:")) continue;
      const phone = senderId.replace(/^whatsapp:/, "");
      if (waSenders.some((x) => x.phoneNumber === phone)) continue;
      waSenders.push({
        sid: String(s.sid ?? ""),
        phoneNumber: phone,
        status: String(s.status ?? ""),
        profileName: String(((s.profile ?? {}) as Record<string, unknown>).name ?? ""),
      });
    }
  }

  const numbers = numbersR.ok
    ? (((numbersR.data.incoming_phone_numbers ?? []) as Array<Record<string, unknown>>)).map((n) => ({
        sid: String(n.sid ?? ""),
        phoneNumber: String(n.phone_number ?? ""),
        friendlyName: String(n.friendly_name ?? ""),
        capabilities: (n.capabilities ?? {}) as Record<string, boolean>,
      }))
    : [];

  const services = servicesR.ok
    ? (((servicesR.data.services ?? []) as Array<Record<string, unknown>>)).map((s) => ({
        sid: String(s.sid ?? ""),
        friendlyName: String(s.friendly_name ?? ""),
      }))
    : [];

  const contents = contentR.ok
    ? (((contentR.data.contents ?? []) as Array<Record<string, unknown>>)).map((c) => ({
        sid: String(c.sid ?? ""),
        friendlyName: String(c.friendly_name ?? ""),
        language: String(c.language ?? ""),
        variables: (c.variables ?? {}) as Record<string, string>,
      }))
    : [];

  return {
    ok: true as const,
    latencyMs: Date.now() - started,
    account: {
      sid,
      friendlyName: (account.friendly_name as string) ?? null,
      status: (account.status as string) ?? null,
      type: (account.type as string) ?? null,
    },
    numbers,
    whatsappSenders: waSenders,
    services,
    contents,
    warnings: [
      !numbersR.ok ? `Números: ${numbersR.error}` : null,
      !servicesR.ok ? `Messaging Services: ${servicesR.error}` : null,
      !contentR.ok ? `Templates: ${contentR.error}` : null,
      waSenders.length === 0
        ? "Nenhum remetente WhatsApp registrado nesta conta. Para WhatsApp você precisa: (a) usar o Sandbox 'whatsapp:+14155238886' em testes, ou (b) cadastrar um WhatsApp Sender em Messaging → Senders no console Twilio."
        : null,
    ].filter((x): x is string => Boolean(x)),
  };
}

async function sendTwilioTest(
  prev: Record<string, unknown>,
  payload: { toPhone: string; text: string; useTemplate?: boolean },
) {
  const { invalidateMessagingCache } = await import("@/lib/messaging-broker.server");
  invalidateMessagingCache();
  const sid = String(prev.accountSid ?? "");
  if (!sid) throw new Error("Salve as configurações antes de testar.");

  const t0 = Date.now();
  try {
    const r = await brokerSendTextForTwilio(prev, payload);
    return { ok: true as const, sid: r.sid, status: r.status, latencyMs: Date.now() - t0 };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : String(e), latencyMs: Date.now() - t0 };
  }
}

async function brokerSendTextForTwilio(
  s: Record<string, unknown>,
  payload: { toPhone: string; text: string; useTemplate?: boolean },
) {
  const sid = String(s.accountSid ?? "");
  const user = s.apiKeySid && s.apiKeySecret ? String(s.apiKeySid) : sid;
  const pass = s.apiKeySid && s.apiKeySecret ? String(s.apiKeySecret) : String(s.authToken ?? "");
  if (!pass) throw new Error("Credenciais incompletas.");

  const digits = String(payload.toPhone).replace(/\D/g, "");
  if (!digits) throw new Error("Telefone destino inválido.");
  const toE = `+${digits}`;

  const useWhatsApp = Boolean(s.whatsappFrom);
  const to = useWhatsApp ? `whatsapp:${toE}` : toE;
  const params = new URLSearchParams({ To: to });

  const contentSid = payload.useTemplate ? String(s.contentSid ?? "") : "";
  if (contentSid) {
    params.set("ContentSid", contentSid);
    const varKey = (String(s.contentVariableKey ?? "1").trim() || "1");
    params.set("ContentVariables", JSON.stringify({ [varKey]: payload.text }));
  } else {
    params.set("Body", payload.text);
  }

  if (useWhatsApp) {
    const fromRaw = String(s.whatsappFrom).trim();
    const from = fromRaw.startsWith("whatsapp:") ? fromRaw : `whatsapp:+${fromRaw.replace(/\D/g, "")}`;
    params.set("From", from);
  } else if (s.messagingServiceSid) {
    params.set("MessagingServiceSid", String(s.messagingServiceSid));
  } else if (s.fromNumber) {
    params.set("From", `+${String(s.fromNumber).replace(/\D/g, "")}`);
  } else {
    throw new Error("Defina WhatsApp From, Número SMS ou Messaging Service SID antes de enviar.");
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
  const auth = Buffer.from(`${user}:${pass}`).toString("base64");
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const body = (await res.json().catch(() => ({}))) as { sid?: string; status?: string; message?: string };
  if (!res.ok) throw new Error(body.message ?? `Twilio ${res.status}`);
  return { sid: body.sid ?? null, status: body.status ?? null };
}

async function crmHealthCheck() {
  const checks: Array<{ name: string; ok: boolean; detail?: string }> = [];
  const start = Date.now();
  try {
    const { error } = await supabaseAdmin.from("app_settings").select("key").limit(1);
    checks.push({ name: "Banco de dados (app_settings)", ok: !error, detail: error?.message });
  } catch (e) { checks.push({ name: "Banco de dados (app_settings)", ok: false, detail: (e as Error).message }); }
  try {
    const { count, error } = await supabaseAdmin.from("contacts").select("*", { count: "exact", head: true });
    checks.push({ name: "Tabela de contatos", ok: !error, detail: error?.message ?? `${count ?? 0} contatos` });
  } catch (e) { checks.push({ name: "Tabela de contatos", ok: false, detail: (e as Error).message }); }
  try {
    const { count, error } = await supabaseAdmin.from("campaigns").select("*", { count: "exact", head: true });
    checks.push({ name: "Tabela de campanhas", ok: !error, detail: error?.message ?? `${count ?? 0} campanhas` });
  } catch (e) { checks.push({ name: "Tabela de campanhas", ok: false, detail: (e as Error).message }); }
  try {
    const { data, error } = await supabaseAdmin.from("app_settings").select("value").eq("key", "messaging_provider").maybeSingle();
    const v = (data?.value ?? {}) as { provider?: string };
    checks.push({ name: "Provedor de mensageria ativo", ok: !error, detail: error?.message ?? (v.provider ?? "evolution (padrão)") });
  } catch (e) { checks.push({ name: "Provedor de mensageria ativo", ok: false, detail: (e as Error).message }); }
  return { ok: checks.every((c) => c.ok), latencyMs: Date.now() - start, checks };
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
    if (payload.action === "discover") return json(await discoverTwilio(prev, payload));
    if (payload.action === "send-test") return json(await sendTwilioTest(prev, payload));
    if (payload.action === "crm-test") return json(await crmHealthCheck());

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