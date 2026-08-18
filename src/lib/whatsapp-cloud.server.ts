import { supabaseAdmin } from "@/integrations/supabase/client.server";

const GRAPH = "https://graph.facebook.com/v21.0";

export type MetaConfig = { appId: string; appSecret: string; configId: string; verifyToken: string };

/**
 * Read Meta App credentials. Values in `app_settings.meta_app` take precedence
 * over env vars, so the admin can edit them straight from the panel without
 * touching secrets.
 */
export async function getMetaConfig(): Promise<MetaConfig> {
  const { data } = await supabaseAdmin
    .from("app_settings")
    .select("value")
    .eq("key", "meta_app")
    .maybeSingle();
  const v = (data?.value ?? {}) as Partial<MetaConfig>;
  return {
    appId: v.appId?.trim() || process.env.META_APP_ID || "",
    appSecret: v.appSecret?.trim() || process.env.META_APP_SECRET || "",
    configId: v.configId?.trim() || process.env.META_LOGIN_CONFIG_ID || "",
    verifyToken: v.verifyToken?.trim() || process.env.META_WEBHOOK_VERIFY_TOKEN || "",
  };
}

export async function saveMetaConfig(patch: Partial<MetaConfig>) {
  const current = await getMetaConfig();
  const merged: MetaConfig = {
    appId: (patch.appId ?? current.appId).trim(),
    appSecret: (patch.appSecret ?? current.appSecret).trim(),
    configId: (patch.configId ?? current.configId).trim(),
    verifyToken: (patch.verifyToken ?? current.verifyToken).trim()
      || `livia_${crypto.randomUUID().replace(/-/g, "")}`,
  };
  await supabaseAdmin
    .from("app_settings")
    .upsert({ key: "meta_app", value: merged as unknown as never }, { onConflict: "key" });
  return merged;
}

export type FieldCheck = { ok: boolean; message: string; detail?: string };
export type CredentialsCheck = {
  appId: FieldCheck;
  appSecret: FieldCheck;
  configId: FieldCheck;
  verifyToken: FieldCheck;
  overall: boolean;
};

/**
 * Validate Meta App credentials against the Graph API without persisting anything.
 * If any field in `override` is provided, it is used instead of the stored value —
 * lets the UI test uncommitted form values before saving.
 */
export async function validateMetaCredentials(
  override: Partial<MetaConfig> = {},
): Promise<CredentialsCheck> {
  const current = await getMetaConfig();
  const cfg: MetaConfig = {
    appId: (override.appId ?? current.appId).trim(),
    appSecret: (override.appSecret ?? current.appSecret).trim(),
    configId: (override.configId ?? current.configId).trim(),
    verifyToken: (override.verifyToken ?? current.verifyToken).trim(),
  };

  const result: CredentialsCheck = {
    appId: { ok: false, message: "" },
    appSecret: { ok: false, message: "" },
    configId: { ok: false, message: "" },
    verifyToken: { ok: false, message: "" },
    overall: false,
  };

  // 1. App ID — required + numeric.
  if (!cfg.appId) {
    result.appId = { ok: false, message: "App ID obrigatório." };
  } else if (!/^\d{6,}$/.test(cfg.appId)) {
    result.appId = { ok: false, message: "Formato inválido — App ID da Meta é numérico (>=6 dígitos)." };
  } else {
    result.appId = { ok: true, message: "Formato válido." };
  }

  // 2. Verify Token — required + mínimo de segurança.
  if (!cfg.verifyToken) {
    result.verifyToken = { ok: false, message: "Verify Token obrigatório." };
  } else if (cfg.verifyToken.length < 8) {
    result.verifyToken = { ok: false, message: "Verify Token muito curto (mínimo 8 caracteres)." };
  } else if (!/^[A-Za-z0-9._~-]+$/.test(cfg.verifyToken)) {
    result.verifyToken = { ok: false, message: "Use apenas letras, números e . _ ~ - (sem espaços)." };
  } else {
    result.verifyToken = { ok: true, message: "OK." };
  }

  // Sem App ID válido não dá pra testar Secret nem Config ID no Graph.
  if (!result.appId.ok) {
    result.appSecret = { ok: false, message: "Corrija o App ID antes de validar o secret." };
    result.configId = { ok: false, message: "Corrija o App ID antes de validar o Config ID." };
    result.overall = false;
    return result;
  }

  // 3. App Secret — validate by calling GET /{app-id} with app access token.
  if (!cfg.appSecret) {
    result.appSecret = { ok: false, message: "App Secret obrigatório." };
  } else {
    const appToken = `${cfg.appId}|${cfg.appSecret}`;
    try {
      const url = new URL(`${GRAPH}/${cfg.appId}`);
      url.searchParams.set("fields", "id,name");
      url.searchParams.set("access_token", appToken);
      const res = await fetch(url.toString());
      const j = (await res.json().catch(() => ({}))) as { id?: string; name?: string } & GraphErr;
      if (res.ok && j.id === cfg.appId) {
        result.appSecret = { ok: true, message: j.name ? `App "${j.name}" autenticado.` : "Secret válido." };
      } else if (j.error) {
        const code = j.error.code;
        const msg = j.error.message ?? `Meta ${res.status}`;
        if (code === 101 || code === 1 || code === 190 || /secret|invalid/i.test(msg)) {
          result.appSecret = { ok: false, message: "App Secret inválido para este App ID.", detail: msg };
        } else {
          result.appSecret = { ok: false, message: msg, detail: `code=${code}` };
        }
      } else {
        result.appSecret = { ok: false, message: `Meta respondeu HTTP ${res.status}.` };
      }
    } catch (e) {
      result.appSecret = { ok: false, message: e instanceof Error ? e.message : "Falha ao chamar Graph API." };
    }
  }

  // 4. Login Configuration ID — a Facebook Login for Business config is NOT a
  // Graph API object, so `GET /{config-id}` sempre retorna "does not exist".
  // O único caminho real de validação é abrir o Embedded Signup (passo 2).
  // Aqui só validamos o formato e informamos o usuário.
  if (!cfg.configId) {
    result.configId = { ok: false, message: "Login Configuration ID obrigatório." };
  } else if (!/^\d{6,}$/.test(cfg.configId)) {
    result.configId = { ok: false, message: "Formato inválido — Config ID é numérico." };
  } else {
    result.configId = {
      ok: true,
      message: "Formato válido. A Meta só confirma o Config ID ao abrir o Embedded Signup (passo 2).",
    };
  }

  result.overall = result.appId.ok && result.appSecret.ok && result.configId.ok && result.verifyToken.ok;
  return result;
}

// Legacy sync helpers — kept only for meta-connector modules that still read env.
export function verifyToken() { return process.env.META_WEBHOOK_VERIFY_TOKEN ?? ""; }
export function loginConfigId() { return process.env.META_LOGIN_CONFIG_ID ?? ""; }
export function metaAppId() { return process.env.META_APP_ID ?? ""; }

/**
 * Read App Domains from Meta App settings using an app access token
 * (`{app_id}|{app_secret}`). Returns the list of configured domains.
 */
export async function getAppDomains(): Promise<string[]> {
  const cfg = await getMetaConfig();
  if (!cfg.appId || !cfg.appSecret) throw new Error("META_APP_ID/META_APP_SECRET ausentes.");
  const appToken = `${cfg.appId}|${cfg.appSecret}`;
  const url = new URL(`${GRAPH}/${cfg.appId}`);
  url.searchParams.set("fields", "app_domains");
  url.searchParams.set("access_token", appToken);
  const res = await fetch(url.toString());
  const json = (await res.json().catch(() => ({}))) as { app_domains?: string[] } & GraphErr;
  if (!res.ok || json.error) throw new Error(json.error?.message ?? `Meta ${res.status}`);
  return Array.isArray(json.app_domains) ? json.app_domains : [];
}

/**
 * Add a host to the Meta App's App Domains list (merging with what already exists).
 * Uses the app access token — the Meta account that owns the App must have granted
 * the necessary permissions when the App was created.
 */
export async function addAppDomain(host: string): Promise<{ domains: string[] }> {
  const cfg = await getMetaConfig();
  if (!cfg.appId || !cfg.appSecret) throw new Error("META_APP_ID/META_APP_SECRET ausentes.");
  const clean = host.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!clean) throw new Error("Host inválido.");
  const current = await getAppDomains();
  const set = new Set(current.map((d) => d.toLowerCase()));
  set.add(clean);
  const appToken = `${cfg.appId}|${cfg.appSecret}`;
  const body = new URLSearchParams();
  for (const d of set) body.append("app_domains[]", d);
  body.set("access_token", appToken);
  const res = await fetch(`${GRAPH}/${cfg.appId}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const j = (await res.json().catch(() => ({}))) as { success?: boolean } & GraphErr;
  if (!res.ok || j.error || j.success === false) {
    throw new Error(j.error?.message ?? `Meta ${res.status} ao atualizar App Domains.`);
  }
  return { domains: Array.from(set) };
}

/**
 * Register the CRM webhook against the Meta App itself
 * (`POST /{app-id}/subscriptions`). Meta then routes WABA events to that
 * callback for every WABA subscribed via this app.
 */
export async function configureAppWebhookSubscription(callbackUrl: string) {
  const cfg = await getMetaConfig();
  if (!cfg.appId || !cfg.appSecret) throw new Error("Configure META_APP_ID / META_APP_SECRET primeiro.");
  if (!cfg.verifyToken) throw new Error("Configure o Verify Token primeiro.");
  const appToken = `${cfg.appId}|${cfg.appSecret}`;
  const body = new URLSearchParams({
    object: "whatsapp_business_account",
    callback_url: callbackUrl,
    verify_token: cfg.verifyToken,
    fields: "messages,message_template_status_update,account_review_update,phone_number_quality_update",
    access_token: appToken,
  });
  const res = await fetch(`${GRAPH}/${cfg.appId}/subscriptions`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const j = (await res.json().catch(() => ({}))) as { success?: boolean } & GraphErr;
  if (!res.ok || j.error || j.success === false) {
    throw new Error(j.error?.message ?? `Meta ${res.status} ao registrar subscription do App.`);
  }
  return { ok: true };
}

type GraphErr = { error?: { message?: string; code?: number; error_subcode?: number; type?: string } };

export async function graph<T = unknown>(
  path: string,
  opts: { method?: "GET" | "POST" | "DELETE"; token: string; body?: Record<string, unknown> | URLSearchParams; query?: Record<string, string> } = { token: "" },
): Promise<T> {
  const url = new URL(`${GRAPH}${path.startsWith("/") ? path : `/${path}`}`);
  if (opts.query) for (const [k, v] of Object.entries(opts.query)) url.searchParams.set(k, v);
  const headers: Record<string, string> = { Authorization: `Bearer ${opts.token}` };
  let body: BodyInit | undefined;
  if (opts.body instanceof URLSearchParams) {
    body = opts.body.toString();
    headers["Content-Type"] = "application/x-www-form-urlencoded";
  } else if (opts.body) {
    body = JSON.stringify(opts.body);
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(url.toString(), { method: opts.method ?? "GET", headers, body });
  const json = (await res.json().catch(() => ({}))) as T & GraphErr;
  if (!res.ok || (json as GraphErr).error) {
    const err = (json as GraphErr).error;
    throw new Error(err?.message ? `Meta: ${err.message}` : `Meta ${res.status}`);
  }
  return json as T;
}

/** Trade OAuth `code` for a long-lived business access token. */
export async function exchangeCodeForToken(code: string, redirectUri?: string) {
  const cfg = await getMetaConfig();
  if (!cfg.appId || !cfg.appSecret) throw new Error("META_APP_ID/META_APP_SECRET ausentes.");
  const params = new URLSearchParams({
    client_id: cfg.appId,
    client_secret: cfg.appSecret,
    code,
  });
  if (redirectUri) params.set("redirect_uri", redirectUri);
  const res = await fetch(`${GRAPH}/oauth/access_token?${params.toString()}`);
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; token_type?: string; expires_in?: number } & GraphErr;
  if (!res.ok || json.error || !json.access_token) {
    throw new Error(json.error?.message ?? `Erro ao trocar code (${res.status}).`);
  }
  return { accessToken: json.access_token, expiresIn: json.expires_in ?? null };
}

export async function listWabasForToken(token: string) {
  const me = await graph<{ id: string }>("/debug_token", { token, query: { input_token: token } }).catch(() => null);
  void me;
  const r = await graph<{ data: Array<{ id: string; name: string; currency?: string }> }>(
    "/me/businesses",
    { token },
  );
  const result: Array<{ businessId: string; businessName: string; wabas: Array<{ id: string; name: string }> }> = [];
  for (const biz of r.data ?? []) {
    const w = await graph<{ data: Array<{ id: string; name: string }> }>(
      `/${biz.id}/owned_whatsapp_business_accounts`,
      { token },
    ).catch(() => ({ data: [] as Array<{ id: string; name: string }> }));
    result.push({ businessId: biz.id, businessName: biz.name, wabas: w.data ?? [] });
  }
  return result;
}

export async function listPhoneNumbers(wabaId: string, token: string) {
  const r = await graph<{ data: Array<{ id: string; display_phone_number: string; verified_name: string; quality_rating?: string }> }>(
    `/${wabaId}/phone_numbers`,
    { token },
  );
  return r.data ?? [];
}

/**
 * Fetch a phone number + its WABA name directly by ID, without listing
 * `/me/businesses`. Required for the Embedded Signup flow: the signup token
 * grants access to a *shared* WABA that never shows up under
 * `/me/businesses` → `/{biz}/owned_whatsapp_business_accounts`.
 */
export async function fetchSignupDetails(
  wabaId: string,
  phoneNumberId: string,
  token: string,
) {
  const phone = await graph<{ id: string; display_phone_number?: string; verified_name?: string }>(
    `/${phoneNumberId}`,
    { token, query: { fields: "display_phone_number,verified_name" } },
  );
  const waba = await graph<{ id: string; name?: string }>(
    `/${wabaId}`,
    { token, query: { fields: "name,owner_business_info" } },
  ).catch(() => ({ id: wabaId, name: undefined }));
  return {
    displayPhoneNumber: phone.display_phone_number ?? null,
    verifiedName: phone.verified_name ?? null,
    wabaName: waba.name ?? null,
  };
}

export async function subscribeWaba(
  wabaId: string,
  token: string,
  opts?: { overrideCallbackUri?: string; verifyToken?: string },
) {
  const body: Record<string, unknown> = {};
  if (opts?.overrideCallbackUri) body.override_callback_uri = opts.overrideCallbackUri;
  if (opts?.verifyToken) body.verify_token = opts.verifyToken;
  await graph(`/${wabaId}/subscribed_apps`, {
    method: "POST",
    token,
    body: Object.keys(body).length ? body : undefined,
  });
  return true;
}

export type TemplateComponent =
  | { type: "HEADER"; format: "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT"; text?: string; example?: Record<string, unknown> }
  | { type: "BODY"; text: string; example?: Record<string, unknown> }
  | { type: "FOOTER"; text: string }
  | { type: "BUTTONS"; buttons: Array<{ type: "QUICK_REPLY" | "URL" | "PHONE_NUMBER"; text: string; url?: string; phone_number?: string }> };

export async function listTemplates(wabaId: string, token: string) {
  const r = await graph<{ data: Array<{
    id: string; name: string; language: string; status: string; category: string;
    quality_score?: { score?: string }; rejected_reason?: string; components: TemplateComponent[];
  }> }>(`/${wabaId}/message_templates`, { token, query: { fields: "id,name,language,status,category,quality_score,rejected_reason,components", limit: "200" } });
  return r.data ?? [];
}

export async function createTemplate(
  wabaId: string,
  token: string,
  payload: { name: string; language: string; category: "MARKETING" | "UTILITY" | "AUTHENTICATION"; components: TemplateComponent[] },
) {
  return graph<{ id: string; status: string; category: string }>(`/${wabaId}/message_templates`, {
    method: "POST",
    token,
    body: payload as unknown as Record<string, unknown>,
  });
}

export async function updateTemplate(templateId: string, token: string, components: TemplateComponent[]) {
  return graph(`/${templateId}`, { method: "POST", token, body: { components } });
}

export async function deleteTemplate(wabaId: string, token: string, name: string, hsmId?: string) {
  const query: Record<string, string> = { name };
  if (hsmId) query.hsm_id = hsmId;
  return graph(`/${wabaId}/message_templates`, { method: "DELETE", token, query });
}

export type SendTemplateArgs = {
  phoneNumberId: string;
  token: string;
  to: string; // E.164 digits, no +
  templateName: string;
  language: string;
  bodyVariables?: string[];
  headerVariables?: string[];
};

export async function sendTemplateMessage(args: SendTemplateArgs) {
  const components: Array<Record<string, unknown>> = [];
  if (args.headerVariables && args.headerVariables.length) {
    components.push({
      type: "header",
      parameters: args.headerVariables.map((v) => ({ type: "text", text: v })),
    });
  }
  if (args.bodyVariables && args.bodyVariables.length) {
    components.push({
      type: "body",
      parameters: args.bodyVariables.map((v) => ({ type: "text", text: v })),
    });
  }
  const body = {
    messaging_product: "whatsapp",
    to: args.to,
    type: "template",
    template: {
      name: args.templateName,
      language: { code: args.language },
      ...(components.length ? { components } : {}),
    },
  };
  const r = await graph<{ messages?: Array<{ id: string }> }>(`/${args.phoneNumberId}/messages`, {
    method: "POST",
    token: args.token,
    body,
  });
  return { id: r.messages?.[0]?.id ?? null };
}

export async function sendFreeText(args: { phoneNumberId: string; token: string; to: string; text: string }) {
  const r = await graph<{ messages?: Array<{ id: string }> }>(`/${args.phoneNumberId}/messages`, {
    method: "POST",
    token: args.token,
    body: {
      messaging_product: "whatsapp",
      to: args.to,
      type: "text",
      text: { body: args.text, preview_url: false },
    },
  });
  return { id: r.messages?.[0]?.id ?? null };
}

export async function registerPhoneNumber(
  phoneNumberId: string,
  token: string,
  pin: string,
): Promise<{ success: boolean }> {
  const res = await fetch(
    `https://graph.facebook.com/v21.0/${phoneNumberId}/register`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ messaging_product: "whatsapp", pin }),
    },
  );
  const data = await res.json();
  if (!res.ok) {
    const msg = (data as { error?: { message?: string } }).error?.message ?? "Falha ao registrar número.";
    throw new Error(msg);
  }
  return { success: true };
}

export async function requestPhoneCode(
  phoneNumberId: string,
  token: string,
  codeMethod: "SMS" | "VOICE" = "SMS",
  language = "pt_BR",
): Promise<{ success: boolean }> {
  const res = await fetch(
    `https://graph.facebook.com/v21.0/${phoneNumberId}/request_code`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ code_method: codeMethod, language }),
    },
  );
  const data = await res.json();
  if (!res.ok) {
    const msg = (data as { error?: { message?: string } }).error?.message ?? "Falha ao solicitar código.";
    throw new Error(msg);
  }
  return { success: true };
}


/** Pull current default account row (admin context). */
export async function getDefaultCloudAccount() {
  const { data, error } = await supabaseAdmin
    .from("whatsapp_cloud_accounts")
    .select("*")
    .eq("is_default", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Cloud API não tem "instância" como a Evolution, mas o CRM (conversas/inbox)
 * exige `conversations.instance_id`. Garante uma linha virtual em
 * whatsapp_instances por phone_number_id da Cloud API.
 */
export async function ensureCloudInstance(args: {
  phoneNumberId: string;
  displayPhoneNumber?: string | null;
  verifiedName?: string | null;
}): Promise<{ id: string } | null> {
  const evoName = `cloud:${args.phoneNumberId}`;
  const { data: existing } = await supabaseAdmin
    .from("whatsapp_instances")
    .select("id")
    .eq("evolution_instance_name", evoName)
    .maybeSingle();
  if (existing) return existing;
  const { data } = await supabaseAdmin
    .from("whatsapp_instances")
    .upsert(
      {
        name: args.verifiedName || args.displayPhoneNumber || "WhatsApp Cloud",
        evolution_instance_name: evoName,
        status: "connected",
        phone_number: args.displayPhoneNumber ?? null,
        profile_name: args.verifiedName ?? null,
      },
      { onConflict: "evolution_instance_name" },
    )
    .select("id")
    .single();
  return data ?? null;
}

/** Sync templates list for an account, upserting into local table. */
export async function syncTemplatesForAccount(accountId: string) {
  const { data: account, error } = await supabaseAdmin
    .from("whatsapp_cloud_accounts").select("*").eq("id", accountId).maybeSingle();
  if (error || !account) throw new Error(error?.message ?? "Conta não encontrada.");
  const list = await listTemplates(account.waba_id, account.access_token);
  const now = new Date().toISOString();
  for (const t of list) {
    const body = (t.components ?? []).find((c) => c.type === "BODY") as { text?: string } | undefined;
    const variables = body?.text ? Array.from(new Set(body.text.match(/\{\{\s*\d+\s*\}\}/g) ?? [])).length : 0;
    await supabaseAdmin
      .from("whatsapp_cloud_templates")
      .upsert({
        account_id: accountId,
        meta_template_id: t.id,
        name: t.name,
        language: t.language,
        category: t.category,
        status: t.status,
        rejection_reason: t.rejected_reason ?? null,
        quality_score: t.quality_score?.score ?? null,
        components: t.components as unknown as never,
        variables_count: variables,
        last_synced_at: now,
      }, { onConflict: "account_id,name,language" });
  }
  return { count: list.length };
}