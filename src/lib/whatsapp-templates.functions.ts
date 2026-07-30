import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const STALE_MS = 5 * 60 * 1000;

/**
 * Lista templates do WhatsApp Cloud, sincronizando automaticamente com a Meta
 * quando os dados locais estiverem ausentes ou desatualizados (> 5 min).
 */
export const listCloudTemplates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      accountId: z.string().uuid().optional(),
      approvedOnly: z.boolean().default(false),
      forceSync: z.boolean().default(false),
    }).parse(d ?? {}),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { syncTemplatesForAccount } = await import("./whatsapp-cloud.server");

    let accQuery = supabaseAdmin
      .from("whatsapp_cloud_accounts")
      .select("id, waba_id, display_phone_number, is_default");
    if (data.accountId) accQuery = accQuery.eq("id", data.accountId);
    const { data: accounts } = await accQuery;
    const accountIds = (accounts ?? []).map((a) => a.id);

    let synced = 0;
    const syncErrors: string[] = [];
    for (const accId of accountIds) {
      const { data: latest } = await supabaseAdmin
        .from("whatsapp_cloud_templates")
        .select("last_synced_at")
        .eq("account_id", accId)
        .order("last_synced_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const last = latest?.last_synced_at ? new Date(latest.last_synced_at).getTime() : 0;
      const stale = data.forceSync || Date.now() - last > STALE_MS;
      if (!stale) continue;
      try {
        const r = await syncTemplatesForAccount(accId);
        synced += r.count;
      } catch (e) {
        syncErrors.push(e instanceof Error ? e.message : String(e));
      }
    }

    let q = supabaseAdmin
      .from("whatsapp_cloud_templates")
      .select("id, account_id, name, language, category, status, rejection_reason, variables_count, components, last_synced_at, meta_template_id")
      .order("name", { ascending: true });
    if (accountIds.length) q = q.in("account_id", accountIds);
    if (data.approvedOnly) q = q.eq("status", "APPROVED");
    const { data: templates, error } = await q;
    if (error) throw new Error(error.message);

    return {
      templates: templates ?? [],
      accounts: accounts ?? [],
      synced,
      syncErrors,
    };
  });
