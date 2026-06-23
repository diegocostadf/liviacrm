import { createServerFn } from "@tanstack/react-start";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { ConnectionOverview, EmbeddedSignupPayload } from "@/lib/meta-connector/types";

type Supa = SupabaseClient<Database>;

async function ensureAdmin(supabase: Supa, userId: string) {
  const { data, error } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Acesso restrito a administradores.");
}

/** Public config the client needs to bootstrap FB SDK / Embedded Signup. */
export const getMetaPublicConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await ensureAdmin(context.supabase, context.userId);
    return {
      appId: process.env.META_APP_ID ?? "",
      configId: process.env.META_LOGIN_CONFIG_ID ?? "",
      graphVersion: "v21.0",
    };
  });

/** Read current connection status (no token values exposed). */
export const getMetaOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ConnectionOverview> => {
    await ensureAdmin(context.supabase, context.userId);
    const { supabase } = context;

    const { data: biz } = await supabase
      .from("meta_businesses")
      .select("id,meta_business_id,business_name,portfolio_id,status,connected_at")
      .eq("status", "connected")
      .order("connected_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!biz) return { connected: false };

    const { data: waba } = await supabase
      .from("meta_whatsapp_accounts")
      .select("id,waba_id,name,subscribed")
      .eq("business_id", biz.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: phone } = waba
      ? await supabase
          .from("meta_phone_numbers")
          .select("id,phone_number_id,display_phone_number,verified_name,quality_rating,messaging_limit,is_default")
          .eq("waba_id", waba.id)
          .order("is_default", { ascending: false })
          .limit(1)
          .maybeSingle()
      : { data: null };

    const { data: token } = await supabase
      .from("meta_tokens")
      .select("kind,expires_at,last_refreshed_at,scopes")
      .eq("business_id", biz.id)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    return {
      connected: true,
      business: {
        id: biz.id,
        metaBusinessId: biz.meta_business_id,
        businessName: biz.business_name,
        portfolioId: biz.portfolio_id,
        connectedAt: biz.connected_at,
      },
      waba: waba
        ? { id: waba.id, wabaId: waba.waba_id, name: waba.name, subscribed: waba.subscribed }
        : undefined,
      phone: phone
        ? {
            id: phone.id,
            phoneNumberId: phone.phone_number_id,
            displayPhoneNumber: phone.display_phone_number,
            verifiedName: phone.verified_name,
            qualityRating: phone.quality_rating,
            messagingLimit: phone.messaging_limit,
          }
        : undefined,
      token: token
        ? {
            kind: (token.kind ?? "business") as "business" | "system_user",
            expiresAt: token.expires_at,
            lastRefreshedAt: token.last_refreshed_at,
            scopes: token.scopes,
            hasToken: true,
          }
        : undefined,
    };
  });

/** Execute Embedded Signup orchestration after FB.login returns a code. */
export const completeEmbeddedSignup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: EmbeddedSignupPayload) => {
    if (!data?.code || typeof data.code !== "string") throw new Error("code obrigatório.");
    return data;
  })
  .handler(async ({ data, context }) => {
    await ensureAdmin(context.supabase, context.userId);
    const { runEmbeddedSignup } = await import("@/lib/meta-connector/signup.server");
    return runEmbeddedSignup({
      code: data.code,
      hint: data.signupInfo
        ? {
            wabaId: data.signupInfo.waba_id,
            phoneNumberId: data.signupInfo.phone_number_id,
            businessId: data.signupInfo.business_id,
          }
        : undefined,
    });
  });

export const disconnectMetaBusiness = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { businessId: string }) => {
    if (!data?.businessId) throw new Error("businessId obrigatório.");
    return data;
  })
  .handler(async ({ data, context }) => {
    await ensureAdmin(context.supabase, context.userId);
    const { disconnectBusiness } = await import("@/lib/meta-connector/signup.server");
    await disconnectBusiness(data.businessId);
    return { ok: true as const };
  });

/** Recent audit logs. */
export const listMetaLogs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await ensureAdmin(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("meta_logs")
      .select("id,kind,level,message,meta,created_at")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return data ?? [];
  });