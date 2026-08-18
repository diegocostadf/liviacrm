import { defineTool } from "@lovable.dev/mcp-js";
import { fail, json, ok, supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_channels",
  title: "Listar canais e provedor ativo",
  description:
    "Mostra as instâncias/canais de WhatsApp cadastrados, contas do WhatsApp Cloud e qual provedor de envio está ativo.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) return fail("Não autenticado.");
    const supabase = supabaseForUser(ctx);
    const [{ data: instances }, { data: cloud }] = await Promise.all([
      supabase
        .from("whatsapp_instances")
        .select("id, name, evolution_instance_name, status, last_sync_at")
        .order("created_at", { ascending: true }),
      supabase
        .from("whatsapp_cloud_accounts")
        .select("id, waba_id, phone_number_id, display_phone_number, verified_name, is_default, status")
        .order("created_at", { ascending: true }),
    ]);
    let provider: string | null = null;
    try {
      const { getActiveProvider } = await import("@/lib/messaging-broker.server");
      provider = await getActiveProvider();
    } catch {
      provider = null;
    }
    const payload = { active_provider: provider, instances: instances ?? [], cloud_accounts: cloud ?? [] };
    return ok(json(payload), payload as Record<string, unknown>);
  },
});