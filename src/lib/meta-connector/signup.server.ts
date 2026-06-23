import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { graphFetch, logMeta } from "./client.server";
import { debugToken, exchangeCode, saveBusinessToken } from "./tokens.server";

/**
 * Full Embedded Signup orchestration:
 *  1. Exchange code → long-lived token
 *  2. Inspect token (debug_token) → scopes + expiration
 *  3. Resolve Business / WABA / Phone Number via Graph
 *  4. Persist meta_businesses, meta_whatsapp_accounts, meta_phone_numbers
 *  5. Encrypt + persist token in meta_tokens
 *  6. Subscribe app to WABA webhooks
 */
export async function runEmbeddedSignup(args: {
  code: string;
  redirectUri?: string;
  hint?: { wabaId?: string; phoneNumberId?: string; businessId?: string };
}) {
  await logMeta("embedded_signup_start", "info", "Iniciando Embedded Signup", {
    hasHint: !!args.hint,
  });

  // 1. Exchange code
  const { accessToken, expiresIn } = await exchangeCode(args.code, args.redirectUri);

  // 2. Token introspection
  const introspect = await debugToken(accessToken).catch(() => ({} as Awaited<ReturnType<typeof debugToken>>));
  const tokenExpiresAt =
    introspect.expires_at && introspect.expires_at > 0
      ? new Date(introspect.expires_at * 1000).toISOString()
      : expiresIn
        ? new Date(Date.now() + expiresIn * 1000).toISOString()
        : null;

  // 3. Resolve WABA — prefer hint, else first owned WABA.
  let wabaId = args.hint?.wabaId ?? null;
  let businessMetaId = args.hint?.businessId ?? null;

  if (!wabaId) {
    const biz = await graphFetch<{ data: Array<{ id: string }> }>("/me/businesses", { token: accessToken });
    const firstBiz = biz.data?.[0];
    if (!firstBiz) throw new Error("Nenhum Business encontrado para esta conta.");
    businessMetaId = businessMetaId ?? firstBiz.id;
    const wabas = await graphFetch<{ data: Array<{ id: string }> }>(
      `/${firstBiz.id}/owned_whatsapp_business_accounts`,
      { token: accessToken },
    );
    wabaId = wabas.data?.[0]?.id ?? null;
    if (!wabaId) throw new Error("Nenhum WABA encontrado para este Business.");
  }

  // Detail WABA
  const wabaInfo = await graphFetch<{
    id: string;
    name?: string;
    currency?: string;
    timezone_id?: string;
    message_template_namespace?: string;
    owner_business_info?: { id: string; name: string };
  }>(`/${wabaId}`, {
    token: accessToken,
    query: { fields: "id,name,currency,timezone_id,message_template_namespace,owner_business_info" },
  });

  if (!businessMetaId && wabaInfo.owner_business_info?.id) {
    businessMetaId = wabaInfo.owner_business_info.id;
  }
  if (!businessMetaId) throw new Error("Não foi possível identificar o Business da Meta.");

  // Detail Business
  const bizInfo = await graphFetch<{ id: string; name?: string; primary_page?: { id: string } }>(
    `/${businessMetaId}`,
    { token: accessToken, query: { fields: "id,name,primary_page" } },
  ).catch(() => ({ id: businessMetaId!, name: wabaInfo.owner_business_info?.name }));

  // 4. Persist business
  const { data: bizRow, error: bizErr } = await supabaseAdmin
    .from("meta_businesses")
    .upsert(
      {
        meta_business_id: businessMetaId,
        business_name: bizInfo.name ?? wabaInfo.owner_business_info?.name ?? "Sem nome",
        status: "connected",
        disconnected_at: null,
      },
      { onConflict: "meta_business_id" },
    )
    .select("id")
    .single();
  if (bizErr || !bizRow) throw new Error(bizErr?.message ?? "Falha ao salvar business.");

  // Persist WABA
  const { data: wabaRow, error: wabaErr } = await supabaseAdmin
    .from("meta_whatsapp_accounts")
    .upsert(
      {
        business_id: bizRow.id,
        waba_id: wabaId,
        name: wabaInfo.name ?? null,
        currency: wabaInfo.currency ?? null,
        timezone_id: wabaInfo.timezone_id ?? null,
        message_template_namespace: wabaInfo.message_template_namespace ?? null,
        status: "active",
      },
      { onConflict: "waba_id" },
    )
    .select("id")
    .single();
  if (wabaErr || !wabaRow) throw new Error(wabaErr?.message ?? "Falha ao salvar WABA.");

  // Phone numbers
  const phones = await graphFetch<{
    data: Array<{
      id: string;
      display_phone_number: string;
      verified_name?: string;
      quality_rating?: string;
      messaging_limit_tier?: string;
      code_verification_status?: string;
    }>;
  }>(`/${wabaId}/phone_numbers`, {
    token: accessToken,
    query: { fields: "id,display_phone_number,verified_name,quality_rating,messaging_limit_tier,code_verification_status" },
  }).catch(() => ({ data: [] }));

  const targetPhoneId = args.hint?.phoneNumberId ?? phones.data?.[0]?.id ?? null;
  for (const p of phones.data ?? []) {
    await supabaseAdmin.from("meta_phone_numbers").upsert(
      {
        waba_id: wabaRow.id,
        phone_number_id: p.id,
        display_phone_number: p.display_phone_number,
        verified_name: p.verified_name ?? null,
        quality_rating: p.quality_rating ?? null,
        messaging_limit: p.messaging_limit_tier ?? null,
        status: p.code_verification_status ?? null,
        is_default: p.id === targetPhoneId,
      },
      { onConflict: "phone_number_id" },
    );
  }

  // 5. Persist token (encrypted)
  await saveBusinessToken(bizRow.id, {
    token: accessToken,
    kind: "business",
    expiresAt: tokenExpiresAt,
    scopes: introspect.scopes ?? null,
    systemUserId: introspect.user_id ?? null,
  });

  // 6. Subscribe app to WABA webhooks
  let subscribed = false;
  try {
    await graphFetch(`/${wabaId}/subscribed_apps`, { method: "POST", token: accessToken });
    subscribed = true;
    await supabaseAdmin
      .from("meta_whatsapp_accounts")
      .update({ subscribed: true, subscribed_at: new Date().toISOString() })
      .eq("id", wabaRow.id);
  } catch (err) {
    await logMeta("subscribe_failed", "warn", (err as Error).message, { wabaId });
  }

  await logMeta("embedded_signup_complete", "info", "Embedded Signup concluído", {
    businessId: bizRow.id,
    wabaId,
    phoneCount: phones.data?.length ?? 0,
    subscribed,
  });

  return {
    ok: true as const,
    businessId: bizRow.id,
    wabaId,
    subscribed,
    phones: phones.data?.length ?? 0,
  };
}

export async function disconnectBusiness(businessId: string) {
  await supabaseAdmin
    .from("meta_businesses")
    .update({ status: "disconnected", disconnected_at: new Date().toISOString() })
    .eq("id", businessId);
  await supabaseAdmin
    .from("meta_tokens")
    .update({ is_active: false })
    .eq("business_id", businessId);
  await logMeta("disconnect", "info", "Business desconectado", { businessId });
}