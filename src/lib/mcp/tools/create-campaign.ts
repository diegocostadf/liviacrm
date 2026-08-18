import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { fail, json, ok, supabaseForUser } from "../supabase";

export default defineTool({
  name: "create_campaign",
  title: "Criar campanha",
  description:
    "Cria uma campanha em rascunho com template de mensagem e regras de janela/throttle. Depois use add_campaign_targets e set_campaign_status.",
  inputSchema: {
    name: z.string().trim().min(2).max(120),
    template: z.string().trim().min(1).describe("Mensagem com variáveis no formato {{nome}}."),
    cloud_template_id: z.string().uuid().optional().describe("Template aprovado do WhatsApp Cloud, quando aplicável."),
    cloud_template_variables: z.record(z.string(), z.string()).optional(),
    scheduled_at: z.string().datetime().optional(),
    window_start_hour: z.number().int().min(0).max(23).optional(),
    window_end_hour: z.number().int().min(0).max(23).optional(),
    max_per_hour: z.number().int().min(1).max(10000).optional(),
    max_per_day: z.number().int().min(1).max(100000).optional(),
    throttle_min_seconds: z.number().int().min(0).max(3600).optional(),
    throttle_max_seconds: z.number().int().min(0).max(3600).optional(),
    pause_on_reply: z.boolean().optional(),
    opt_out_keywords: z.array(z.string().trim()).optional(),
    instance_id: z.string().uuid().optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) return fail("Não autenticado.");
    const supabase = supabaseForUser(ctx);
    const insert: Record<string, unknown> = {
      name: input.name,
      template: input.template,
      status: input.scheduled_at ? "scheduled" : "draft",
      created_by: ctx.getUserId(),
    };
    for (const key of [
      "cloud_template_id",
      "cloud_template_variables",
      "scheduled_at",
      "window_start_hour",
      "window_end_hour",
      "max_per_hour",
      "max_per_day",
      "throttle_min_seconds",
      "throttle_max_seconds",
      "pause_on_reply",
      "opt_out_keywords",
      "instance_id",
    ] as const) {
      const value = (input as Record<string, unknown>)[key];
      if (value !== undefined) insert[key] = value;
    }
    const { data, error } = await supabase.from("campaigns").insert(insert).select().single();
    if (error) return fail(error.message);
    return ok(json(data), { campaign: data });
  },
});