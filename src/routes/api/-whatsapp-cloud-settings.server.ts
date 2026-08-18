import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";
import {
  exchangeCodeForToken,
  listWabasForToken,
  listPhoneNumbers,
  subscribeWaba,
  syncTemplatesForAccount,
  sendFreeText,
  sendTemplateMessage,
  getAppDomains,
  getMetaConfig,
  saveMetaConfig,
  configureAppWebhookSubscription,
  addAppDomain,
  validateMetaCredentials,
  fetchSignupDetails,
  registerPhoneNumber,
  requestPhoneCode,
  listSignupAccounts,
  getPhoneNumberStatus,
} from "@/lib/whatsapp-cloud.server";
import { invalidateMessagingCache } from "@/lib/messaging-broker.server";

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

const exchangeSchema = z.object({ action: z.literal("exchange-code"), code: z.string().min(5), redirectUri: z.string().url().optional() });
const listWabasSchema = z.object({ action: z.literal("list-wabas"), accessToken: z.string().min(10) });
const listSignupAccountsSchema = z.object({ action: z.literal("list-signup-accounts"), accessToken: z.string().min(10) });
const listPhonesSchema = z.object({ action: z.literal("list-phones"), wabaId: z.string().min(3), accessToken: z.string().min(10) });
const saveAccountSchema = z.object({
  action: z.literal("save-account"),
  wabaId: z.string(), businessName: z.string().optional(),
  phoneNumberId: z.string(), displayPhoneNumber: z.string().optional(), verifiedName: z.string().optional(),
  accessToken: z.string().min(10),
  setDefault: z.boolean().default(true),
});
const saveFromSignupSchema = z.object({
  action: z.literal("save-from-signup"),
  wabaId: z.string().min(3),
  phoneNumberId: z.string().min(3),
  accessToken: z.string().min(10),
});
const setDefaultSchema = z.object({ action: z.literal("set-default"), accountId: z.string().uuid() });
const deleteAccountSchema = z.object({ action: z.literal("delete-account"), accountId: z.string().uuid() });
const subscribeSchema = z.object({ action: z.literal("subscribe-webhook"), accountId: z.string().uuid() });
const syncTemplatesSchema = z.object({ action: z.literal("sync-templates"), accountId: z.string().uuid() });
const sendTestSchema = z.object({
  action: z.literal("send-test"),
  accountId: z.string().uuid(),
  toPhone: z.string().min(5),
  templateName: z.string().optional(),
  templateLanguage: z.string().optional(),
  bodyVariables: z.array(z.string()).optional(),
  text: z.string().optional(),
});
const checkDomainSchema = z.object({ action: z.literal("check-domain"), host: z.string().min(3) });
const addDomainSchema = z.object({ action: z.literal("add-domain"), host: z.string().min(3) });
const verifyWebhookSchema = z.object({ action: z.literal("verify-webhook") });
const registerPhoneSchema = z.object({
  action: z.literal("register-phone"),
  accountId: z.string().uuid(),
  pin: z.string().length(6).regex(/^\d{6}$/, "PIN deve ter exatamente 6 dígitos"),
});
const requestCodeSchema = z.object({
  action: z.literal("request-code"),
  accountId: z.string().uuid(),
  codeMethod: z.enum(["SMS", "VOICE"]).default("SMS"),
});
const checkPhoneStatusSchema = z.object({ action: z.literal("check-phone-status"), accountId: z.string().uuid() });
const saveMetaSchema = z.object({
  action: z.literal("save-meta-config"),
  appId: z.string().trim().optional(),
  appSecret: z.string().trim().optional(),
  configId: z.string().trim().optional(),
  verifyToken: z.string().trim().optional(),
});
const configureAppWebhookSchema = z.object({ action: z.literal("configure-app-webhook") });
const validateCredsSchema = z.object({
  action: z.literal("validate-credentials"),
  appId: z.string().trim().optional(),
  appSecret: z.string().trim().optional(),
  configId: z.string().trim().optional(),
  verifyToken: z.string().trim().optional(),
});
const postSchema = z.union([exchangeSchema, listWabasSchema, listSignupAccountsSchema, listPhonesSchema, saveAccountSchema, saveFromSignupSchema, setDefaultSchema, deleteAccountSchema, subscribeSchema, syncTemplatesSchema, sendTestSchema, registerPhoneSchema, requestCodeSchema, checkPhoneStatusSchema, checkDomainSchema, addDomainSchema, verifyWebhookSchema, saveMetaSchema, configureAppWebhookSchema, validateCredsSchema]);

export async function handleGet(request: Request) {
  try {
    await requireAdmin(request);
    const [{ data: accounts }, cfg] = await Promise.all([
      supabaseAdmin.from("whatsapp_cloud_accounts").select("*").order("created_at", { ascending: true }),
      getMetaConfig(),
    ]);
    return json({
      meta: {
        appId: cfg.appId,
        configId: cfg.configId,
        verifyToken: cfg.verifyToken,
        // Never leak the app secret; just tell the UI whether one is set.
        hasAppSecret: !!cfg.appSecret,
        webhookUrl: webhookUrl(request),
      },
      accounts: accounts ?? [],
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}

function webhookUrl(request: Request) {
  const u = new URL(request.url);
  return `${u.protocol}//${u.host}/api/public/webhooks/meta-whatsapp`;
}

export async function handlePost(request: Request) {
  try {
    const userId = await requireAdmin(request);
    const body = postSchema.parse(await request.json());
    switch (body.action) {
      case "validate-credentials": {
        const check = await validateMetaCredentials({
          appId: body.appId,
          appSecret: body.appSecret,
          configId: body.configId,
          verifyToken: body.verifyToken,
        });
        return json({ ok: true, check });
      }
      case "save-meta-config": {
        const saved = await saveMetaConfig({
          appId: body.appId,
          appSecret: body.appSecret,
          configId: body.configId,
          verifyToken: body.verifyToken,
        });
        return json({
          ok: true,
          meta: { appId: saved.appId, configId: saved.configId, verifyToken: saved.verifyToken, hasAppSecret: !!saved.appSecret },
        });
      }
      case "configure-app-webhook": {
        try {
          await configureAppWebhookSubscription(webhookUrl(request));
          return json({ ok: true });
        } catch (e) {
          return json({ ok: false, error: e instanceof Error ? e.message : String(e) });
        }
      }
      case "check-domain": {
        try {
          const domains = await getAppDomains();
          const host = body.host.toLowerCase();
          const allowed = domains.some((d) => {
            const dd = d.toLowerCase();
            return host === dd || host.endsWith(`.${dd}`);
          });
          return json({ ok: true, allowed, host, domains });
        } catch (e) {
          return json({ ok: false, allowed: false, host: body.host, domains: [], error: e instanceof Error ? e.message : String(e) });
        }
      }
      case "add-domain": {
        try {
          const { domains } = await addAppDomain(body.host);
          return json({ ok: true, host: body.host.toLowerCase(), domains });
        } catch (e) {
          return json({ ok: false, error: e instanceof Error ? e.message : String(e) });
        }
      }
      case "verify-webhook": {
        const url = webhookUrl(request);
        const token = (await getMetaConfig()).verifyToken;
        if (!token) return json({ ok: false, error: "META_WEBHOOK_VERIFY_TOKEN não configurado." });
        const challenge = `livia-${Date.now()}`;
        const target = `${url}?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(token)}&hub.challenge=${encodeURIComponent(challenge)}`;
        try {
          const res = await fetch(target, { method: "GET" });
          const text = await res.text();
          const ok = res.status === 200 && text === challenge;
          return json({
            ok,
            status: res.status,
            url,
            expected: challenge,
            got: text.slice(0, 200),
            error: ok ? null : (res.status === 403 ? "verify_token não bate (403)" : `Resposta inesperada (${res.status}).`),
          });
        } catch (e) {
          return json({ ok: false, url, error: e instanceof Error ? e.message : String(e) });
        }
      }
      case "exchange-code": {
        const r = await exchangeCodeForToken(body.code, body.redirectUri);
        return json(r);
      }
      case "list-wabas": {
        const r = await listWabasForToken(body.accessToken);
        return json({ businesses: r });
      }
      case "list-signup-accounts": {
        const cfg = await getMetaConfig();
        if (!cfg.appId || !cfg.appSecret) throw new Error("App ID e App Secret são necessários para listar contas.");
        const accounts = await listSignupAccounts(body.accessToken, cfg.appId, cfg.appSecret);
        return json({ accounts });
      }
      case "list-phones": {
        const r = await listPhoneNumbers(body.wabaId, body.accessToken);
        return json({ phones: r });
      }
      case "save-account": {
        if (body.setDefault) {
          await supabaseAdmin.from("whatsapp_cloud_accounts").update({ is_default: false }).neq("waba_id", body.wabaId);
        }
        const { data, error } = await supabaseAdmin
          .from("whatsapp_cloud_accounts")
          .upsert({
            waba_id: body.wabaId,
            business_name: body.businessName ?? null,
            phone_number_id: body.phoneNumberId,
            display_phone_number: body.displayPhoneNumber ?? null,
            verified_name: body.verifiedName ?? null,
            access_token: body.accessToken,
            is_default: body.setDefault,
            created_by: userId,
          }, { onConflict: "waba_id" })
          .select()
          .single();
        if (error) throw new Error(error.message);

        // Auto-subscribe webhook using this WABA's override_callback_uri so
        // the CRM starts receiving inbound + status events immediately.
        const callback = webhookUrl(request);
        const cfg = await getMetaConfig();
        let subscribed = false;
        let subscribeError: string | null = null;
        try {
          // Best-effort: also register the app-level subscription so the
          // Meta App Dashboard doesn't need any manual configuration.
          try { await configureAppWebhookSubscription(callback); } catch { /* non-fatal */ }
          await subscribeWaba(body.wabaId, body.accessToken, {
            overrideCallbackUri: callback,
            verifyToken: cfg.verifyToken,
          });
          subscribed = true;
          await supabaseAdmin
            .from("whatsapp_cloud_accounts")
            .update({ webhook_subscribed: true })
            .eq("id", data.id);
        } catch (e) {
          subscribeError = e instanceof Error ? e.message : String(e);
        }

        // Best-effort: sync templates so the user already sees them in Step 4.
        try {
          await syncTemplatesForAccount(data.id);
        } catch {
          /* non-fatal */
        }

        invalidateMessagingCache();
        return json({ account: { ...data, webhook_subscribed: subscribed }, subscribed, subscribeError });
      }
      case "save-from-signup": {
        // Fetch phone + WABA details directly (Embedded Signup token can't list /me/businesses).
        const details = await fetchSignupDetails(body.wabaId, body.phoneNumberId, body.accessToken);
        await supabaseAdmin.from("whatsapp_cloud_accounts").update({ is_default: false }).neq("waba_id", body.wabaId);
        const { data, error } = await supabaseAdmin
          .from("whatsapp_cloud_accounts")
          .upsert({
            waba_id: body.wabaId,
            business_name: details.wabaName,
            phone_number_id: body.phoneNumberId,
            display_phone_number: details.displayPhoneNumber,
            verified_name: details.verifiedName,
            access_token: body.accessToken,
            is_default: true,
            created_by: userId,
          }, { onConflict: "waba_id" })
          .select()
          .single();
        if (error) throw new Error(error.message);

        const callback = webhookUrl(request);
        const cfg = await getMetaConfig();
        let subscribed = false;
        let subscribeError: string | null = null;
        try {
          try { await configureAppWebhookSubscription(callback); } catch { /* non-fatal */ }
          await subscribeWaba(body.wabaId, body.accessToken, {
            overrideCallbackUri: callback,
            verifyToken: cfg.verifyToken,
          });
          subscribed = true;
          await supabaseAdmin
            .from("whatsapp_cloud_accounts")
            .update({ webhook_subscribed: true })
            .eq("id", data.id);
        } catch (e) {
          subscribeError = e instanceof Error ? e.message : String(e);
        }

        try { await syncTemplatesForAccount(data.id); } catch { /* non-fatal */ }

        invalidateMessagingCache();
        return json({ account: { ...data, webhook_subscribed: subscribed }, subscribed, subscribeError });
      }
      case "set-default": {
        await supabaseAdmin.from("whatsapp_cloud_accounts").update({ is_default: false }).neq("id", body.accountId);
        const { error } = await supabaseAdmin.from("whatsapp_cloud_accounts").update({ is_default: true }).eq("id", body.accountId);
        if (error) throw new Error(error.message);
        invalidateMessagingCache();
        return json({ ok: true });
      }
      case "delete-account": {
        const { error } = await supabaseAdmin.from("whatsapp_cloud_accounts").delete().eq("id", body.accountId);
        if (error) throw new Error(error.message);
        return json({ ok: true });
      }
      case "subscribe-webhook": {
        const { data: acc } = await supabaseAdmin.from("whatsapp_cloud_accounts").select("*").eq("id", body.accountId).maybeSingle();
        if (!acc) throw new Error("Conta não encontrada.");
        const cfg = await getMetaConfig();
        await subscribeWaba(acc.waba_id, acc.access_token, {
          overrideCallbackUri: webhookUrl(request),
          verifyToken: cfg.verifyToken,
        });
        await supabaseAdmin.from("whatsapp_cloud_accounts").update({ webhook_subscribed: true }).eq("id", body.accountId);
        return json({ ok: true });
      }
      case "sync-templates": {
        const r = await syncTemplatesForAccount(body.accountId);
        return json(r);
      }
      case "send-test": {
        const { data: acc } = await supabaseAdmin.from("whatsapp_cloud_accounts").select("*").eq("id", body.accountId).maybeSingle();
        if (!acc) throw new Error("Conta não encontrada.");
        const to = body.toPhone.replace(/\D/g, "");
        if (body.templateName) {
          const r = await sendTemplateMessage({
            phoneNumberId: acc.phone_number_id, token: acc.access_token, to,
            templateName: body.templateName, language: body.templateLanguage ?? "pt_BR",
            bodyVariables: body.bodyVariables,
          });
          return json({ ok: true, id: r.id });
        }
        const r = await sendFreeText({ phoneNumberId: acc.phone_number_id, token: acc.access_token, to, text: body.text ?? "Teste Lívia CRM" });
        return json({ ok: true, id: r.id });
      }
      case "request-code": {
        const { data: acc } = await supabaseAdmin
          .from("whatsapp_cloud_accounts")
          .select("phone_number_id, access_token")
          .eq("id", body.accountId)
          .maybeSingle();
        if (!acc) throw new Error("Conta não encontrada.");
        await requestPhoneCode(acc.phone_number_id, acc.access_token, body.codeMethod);
        return json({ ok: true });
      }
      case "check-phone-status": {
        const { data: acc } = await supabaseAdmin
          .from("whatsapp_cloud_accounts")
          .select("phone_number_id, access_token")
          .eq("id", body.accountId)
          .maybeSingle();
        if (!acc) throw new Error("Conta não encontrada.");
        const status = await getPhoneNumberStatus(acc.phone_number_id, acc.access_token);
        return json({ ok: true, status });
      }
      case "register-phone": {
        const { data: acc } = await supabaseAdmin
          .from("whatsapp_cloud_accounts")
          .select("phone_number_id, access_token")
          .eq("id", body.accountId)
          .maybeSingle();
        if (!acc) throw new Error("Conta não encontrada.");
        await registerPhoneNumber(acc.phone_number_id, acc.access_token, body.pin);
        await supabaseAdmin
          .from("whatsapp_cloud_accounts")
          .update({ webhook_subscribed: true })
          .eq("id", body.accountId);
        return json({ ok: true });
      }
    }
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.issues.map((i) => i.message).join("; ") : (e instanceof Error ? e.message : String(e));
    return json({ error: msg }, 500);
  }
}