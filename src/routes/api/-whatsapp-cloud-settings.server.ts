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
  loginConfigId,
  metaAppId,
  verifyToken,
  getAppDomains,
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
const listPhonesSchema = z.object({ action: z.literal("list-phones"), wabaId: z.string().min(3), accessToken: z.string().min(10) });
const saveAccountSchema = z.object({
  action: z.literal("save-account"),
  wabaId: z.string(), businessName: z.string().optional(),
  phoneNumberId: z.string(), displayPhoneNumber: z.string().optional(), verifiedName: z.string().optional(),
  accessToken: z.string().min(10),
  setDefault: z.boolean().default(true),
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
const postSchema = z.union([exchangeSchema, listWabasSchema, listPhonesSchema, saveAccountSchema, setDefaultSchema, deleteAccountSchema, subscribeSchema, syncTemplatesSchema, sendTestSchema, checkDomainSchema]);

export async function handleGet(request: Request) {
  try {
    await requireAdmin(request);
    const { data: accounts } = await supabaseAdmin.from("whatsapp_cloud_accounts").select("*").order("created_at", { ascending: true });
    return json({
      meta: { appId: metaAppId(), configId: loginConfigId(), verifyToken: verifyToken(), webhookUrl: webhookUrl(request) },
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
      case "exchange-code": {
        const r = await exchangeCodeForToken(body.code, body.redirectUri);
        return json(r);
      }
      case "list-wabas": {
        const r = await listWabasForToken(body.accessToken);
        return json({ businesses: r });
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
        return json({ account: data });
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
        await subscribeWaba(acc.waba_id, acc.access_token);
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
    }
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.issues.map((i) => i.message).join("; ") : (e instanceof Error ? e.message : String(e));
    return json({ error: msg }, 500);
  }
}