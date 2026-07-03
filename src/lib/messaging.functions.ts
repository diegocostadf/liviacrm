import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const getMessagingProvider = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { data } = await supabaseAdmin
      .from("app_settings")
      .select("value")
      .eq("key", "messaging_provider")
      .maybeSingle();
    const v = (data?.value ?? {}) as { provider?: string };
    const provider: "evolution" | "twilio" | "cloud" | "zapi" =
      v.provider === "twilio" ? "twilio"
      : v.provider === "cloud" ? "cloud"
      : v.provider === "zapi" ? "zapi"
      : "evolution";
    return { provider };
  });