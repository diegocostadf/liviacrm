import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { evolutionFetch } from "./evolution.server";
import { getDefaultCloudAccount, sendFreeText, sendTemplateMessage } from "./whatsapp-cloud.server";

export type MessagingProvider = "evolution" | "twilio" | "cloud";

type TwilioSettings = {
  accountSid?: string;
  authToken?: string;
  apiKeySid?: string;
  apiKeySecret?: string;
  fromNumber?: string;
  messagingServiceSid?: string;
  whatsappFrom?: string;
  contentSid?: string;
  contentVariableKey?: string;
};

let cachedProvider: { value: MessagingProvider; at: number } | null = null;
let cachedTwilio: { value: TwilioSettings; at: number } | null = null;
const TTL_MS = 10_000;

export function invalidateMessagingCache() {
  cachedProvider = null;
  cachedTwilio = null;
}

export async function getActiveProvider(): Promise<MessagingProvider> {
  if (cachedProvider && Date.now() - cachedProvider.at < TTL_MS) return cachedProvider.value;
  const { data } = await supabaseAdmin
    .from("app_settings")
    .select("value")
    .eq("key", "messaging_provider")
    .maybeSingle();
  const v = (data?.value ?? {}) as { provider?: string };
  const provider: MessagingProvider =
    v.provider === "twilio" ? "twilio" : v.provider === "cloud" ? "cloud" : "evolution";
  cachedProvider = { value: provider, at: Date.now() };
  return provider;
}

async function loadTwilioSettings(): Promise<TwilioSettings> {
  if (cachedTwilio && Date.now() - cachedTwilio.at < TTL_MS) return cachedTwilio.value;
  const { data } = await supabaseAdmin
    .from("app_settings")
    .select("value")
    .eq("key", "twilio")
    .maybeSingle();
  const v = (data?.value ?? {}) as TwilioSettings;
  cachedTwilio = { value: v, at: Date.now() };
  return v;
}

function toE164(raw: string): string {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits) return "";
  return `+${digits}`;
}

async function twilioSendText(
  toPhone: string,
  text: string,
  opts?: { contentSid?: string; contentVariables?: Record<string, string> },
): Promise<{ id: string | null }> {
  const s = await loadTwilioSettings();
  if (!s.accountSid) throw new Error("Twilio Account SID não configurado.");
  const user = s.apiKeySid && s.apiKeySecret ? s.apiKeySid : s.accountSid;
  const pass = s.apiKeySid && s.apiKeySecret ? s.apiKeySecret : (s.authToken ?? "");
  if (!pass) throw new Error("Configure um Auth Token ou API Key SID/Secret do Twilio.");

  const toE = toE164(toPhone);
  if (!toE) throw new Error("Telefone destino inválido.");

  const useWhatsApp = Boolean(s.whatsappFrom);
  const to = useWhatsApp ? `whatsapp:${toE}` : toE;

  const params = new URLSearchParams({ To: to });

  // Template (ContentSid) tem prioridade sobre Body livre. Aceita override por
  // chamada; caso contrário usa o ContentSid padrão das configurações.
  const contentSid = opts?.contentSid ?? s.contentSid ?? "";
  if (contentSid) {
    params.set("ContentSid", contentSid);
    const varKey = (s.contentVariableKey ?? "1").trim() || "1";
    const vars = opts?.contentVariables ?? { [varKey]: text };
    params.set("ContentVariables", JSON.stringify(vars));
  } else {
    params.set("Body", text);
  }

  if (useWhatsApp) {
    const fromRaw = s.whatsappFrom!.trim();
    const from = fromRaw.startsWith("whatsapp:") ? fromRaw : `whatsapp:${toE164(fromRaw)}`;
    params.set("From", from);
  } else if (s.messagingServiceSid) {
    params.set("MessagingServiceSid", s.messagingServiceSid);
  } else if (s.fromNumber) {
    params.set("From", toE164(s.fromNumber));
  } else {
    throw new Error("Configure whatsappFrom, fromNumber ou messagingServiceSid no Twilio.");
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${s.accountSid}/Messages.json`;
  const auth = Buffer.from(`${user}:${pass}`).toString("base64");
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });
  const body = (await res.json().catch(() => ({}))) as { sid?: string; message?: string; code?: number };
  if (!res.ok) {
    throw new Error(body.message ?? `Twilio ${res.status}`);
  }
  return { id: body.sid ?? null };
}

/**
 * Envia texto pelo provedor ativo (Evolution ou Twilio).
 * - Evolution exige `evolutionInstanceName`.
 * - Twilio ignora a instância e usa as credenciais salvas em app_settings.twilio.
 */
export async function brokerSendText(args: {
  toPhone: string;
  text: string;
  evolutionInstanceName?: string | null;
  twilio?: { contentSid?: string; contentVariables?: Record<string, string> };
  cloud?: { templateName?: string; templateLanguage?: string; bodyVariables?: string[]; headerVariables?: string[] };
}): Promise<{ id: string | null; provider: MessagingProvider }> {
  const provider = await getActiveProvider();
  if (provider === "twilio") {
    const r = await twilioSendText(args.toPhone, args.text, args.twilio);
    return { id: r.id, provider };
  }
  if (provider === "cloud") {
    const acc = await getDefaultCloudAccount();
    if (!acc) throw new Error("Nenhuma conta WhatsApp Cloud configurada como padrão.");
    const to = String(args.toPhone).replace(/\D/g, "");
    if (!to) throw new Error("Telefone destino inválido.");
    if (args.cloud?.templateName) {
      const r = await sendTemplateMessage({
        phoneNumberId: acc.phone_number_id,
        token: acc.access_token,
        to,
        templateName: args.cloud.templateName,
        language: args.cloud.templateLanguage ?? "pt_BR",
        bodyVariables: args.cloud.bodyVariables,
        headerVariables: args.cloud.headerVariables,
      });
      return { id: r.id, provider };
    }
    const r = await sendFreeText({ phoneNumberId: acc.phone_number_id, token: acc.access_token, to, text: args.text });
    return { id: r.id, provider };
  }
  if (!args.evolutionInstanceName) {
    throw new Error("Instância Evolution não informada.");
  }
  const res = (await evolutionFetch(`/message/sendText/${args.evolutionInstanceName}`, {
    method: "POST",
    json: { number: String(args.toPhone).replace(/\D/g, ""), text: args.text },
  })) as { key?: { id?: string } };
  return { id: res?.key?.id ?? null, provider };
}