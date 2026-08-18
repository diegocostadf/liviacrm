import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { decryptToken, encryptToken } from "./crypto.server";
import { appId, appSecret, graphFetch } from "./client.server";

/** Trade short-lived OAuth code for a long-lived business access token (~60d). */
export async function exchangeCode(code: string, redirectUri?: string) {
  const id = await appId();
  const secret = await appSecret();
  if (!id || !secret) {
    throw new Error("App ID/App Secret da Meta ausentes. Configure em Configurações → WhatsApp Cloud.");
  }
  const params = new URLSearchParams({
    client_id: id,
    client_secret: secret,
    code,
  });
  if (redirectUri) params.set("redirect_uri", redirectUri);
  const res = await fetch(`https://graph.facebook.com/v21.0/oauth/access_token?${params.toString()}`);
  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: { message?: string };
  };
  if (!res.ok || json.error || !json.access_token) {
    throw new Error(json.error?.message ?? `Erro ao trocar code (${res.status}).`);
  }
  return { accessToken: json.access_token, expiresIn: json.expires_in ?? null };
}

/** Introspect a token (`/debug_token`). Returns expiration + scopes. */
export async function debugToken(token: string) {
  const id = await appId();
  const secret = await appSecret();
  const r = await graphFetch<{
    data?: {
      app_id?: string;
      type?: string;
      expires_at?: number;
      data_access_expires_at?: number;
      is_valid?: boolean;
      scopes?: string[];
      user_id?: string;
    };
  }>("/debug_token", { token: `${id}|${secret}`, query: { input_token: token } });
  return r.data ?? {};
}

/** Persist a token row for a business. Marks any previous active tokens inactive. */
export async function saveBusinessToken(
  businessId: string,
  args: {
    token: string;
    kind?: "business" | "system_user";
    expiresAt?: string | null;
    scopes?: string[] | null;
    systemUserId?: string | null;
  },
) {
  await supabaseAdmin
    .from("meta_tokens")
    .update({ is_active: false })
    .eq("business_id", businessId)
    .eq("is_active", true);
  const { data, error } = await supabaseAdmin
    .from("meta_tokens")
    .insert({
      business_id: businessId,
      kind: args.kind ?? "business",
      token_encrypted: encryptToken(args.token),
      expires_at: args.expiresAt ?? null,
      scopes: args.scopes ?? null,
      system_user_id: args.systemUserId ?? null,
      is_active: true,
      last_refreshed_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

/** Load the active token for a business (decrypted). Server-only. */
export async function loadActiveToken(businessId: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from("meta_tokens")
    .select("token_encrypted")
    .eq("business_id", businessId)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.token_encrypted) throw new Error("Nenhum token ativo para este Business.");
  return decryptToken(data.token_encrypted);
}