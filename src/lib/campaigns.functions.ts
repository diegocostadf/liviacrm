import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { tickCampaign, renderTemplate } from "./campaigns.server";

export const listCampaigns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { data, error } = await supabaseAdmin
      .from("campaigns")
      .select("id, name, status, instance_id, template, total_count, sent_count, failed_count, replied_count, created_at, scheduled_at, completed_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

const createSchema = z.object({
  name: z.string().trim().min(2).max(120),
  instance_id: z.string().uuid(),
  template: z.string().trim().min(2).max(4000),
  throttle_min_seconds: z.number().int().min(2).max(600).default(8),
  throttle_max_seconds: z.number().int().min(2).max(600).default(20),
  window_start_hour: z.number().int().min(0).max(23).default(8),
  window_end_hour: z.number().int().min(0).max(23).default(21),
});

export const createCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => createSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { data: inserted, error } = await supabaseAdmin
      .from("campaigns")
      .insert({
        name: data.name,
        instance_id: data.instance_id,
        template: data.template,
        throttle_min_seconds: data.throttle_min_seconds,
        throttle_max_seconds: Math.max(data.throttle_min_seconds, data.throttle_max_seconds),
        window_start_hour: data.window_start_hour,
        window_end_hour: data.window_end_hour,
        status: "draft",
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (error || !inserted) throw new Error(error?.message ?? "Falha ao criar campanha");
    return { id: inserted.id };
  });

const updateSchema = createSchema.partial().extend({ id: z.string().uuid() });

export const updateCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => updateSchema.parse(d))
  .handler(async ({ data }) => {
    const { id, ...patch } = data;
    const { error } = await supabaseAdmin.from("campaigns").update(patch).eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    await supabaseAdmin.from("campaign_targets").delete().eq("campaign_id", data.id);
    const { error } = await supabaseAdmin.from("campaigns").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { data: campaign, error } = await supabaseAdmin
      .from("campaigns")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!campaign) throw new Error("Campanha não encontrada");

    const { data: targets } = await supabaseAdmin
      .from("campaign_targets")
      .select("id, phone, name, status, sent_at, error, attempts, custom_fields, rendered_message")
      .eq("campaign_id", data.id)
      .order("created_at", { ascending: true })
      .limit(500);
    const { count: pendingCount } = await supabaseAdmin
      .from("campaign_targets")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", data.id)
      .eq("status", "pending");
    return { campaign, targets: targets ?? [], pendingCount: pendingCount ?? 0 };
  });

const targetItemSchema = z.object({
  phone: z.string().trim().min(6).max(40),
  name: z.string().trim().max(120).optional().nullable(),
  custom_fields: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});

export const addCampaignTargets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      campaignId: z.string().uuid(),
      targets: z.array(targetItemSchema).min(1).max(5000),
      dedupe: z.boolean().default(true),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const norm = (s: string) => s.replace(/\D/g, "");
    let items = data.targets
      .map((t) => ({
        campaign_id: data.campaignId,
        phone: norm(t.phone),
        name: t.name ?? null,
        custom_fields: t.custom_fields ?? {},
        status: "pending" as const,
      }))
      .filter((t) => t.phone.length >= 8);

    if (data.dedupe) {
      const seen = new Set<string>();
      items = items.filter((t) => {
        if (seen.has(t.phone)) return false;
        seen.add(t.phone);
        return true;
      });
      const { data: existing } = await supabaseAdmin
        .from("campaign_targets")
        .select("phone")
        .eq("campaign_id", data.campaignId);
      const existingSet = new Set((existing ?? []).map((e) => e.phone));
      items = items.filter((t) => !existingSet.has(t.phone));
    }

    if (!items.length) return { inserted: 0 };

    // Insert in chunks of 500
    let inserted = 0;
    for (let i = 0; i < items.length; i += 500) {
      const chunk = items.slice(i, i + 500);
      const { error } = await supabaseAdmin.from("campaign_targets").insert(chunk);
      if (error) throw new Error(error.message);
      inserted += chunk.length;
    }

    const { count } = await supabaseAdmin
      .from("campaign_targets")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", data.campaignId);
    await supabaseAdmin.from("campaigns").update({ total_count: count ?? 0 }).eq("id", data.campaignId);

    return { inserted };
  });

export const removeCampaignTarget = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid(), campaignId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    await supabaseAdmin.from("campaign_targets").delete().eq("id", data.id);
    const { count } = await supabaseAdmin
      .from("campaign_targets")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", data.campaignId);
    await supabaseAdmin.from("campaigns").update({ total_count: count ?? 0 }).eq("id", data.campaignId);
    return { ok: true };
  });

export const setCampaignStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      id: z.string().uuid(),
      status: z.enum(["draft", "running", "paused", "completed", "cancelled"]),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const patch: Record<string, unknown> = { status: data.status };
    if (data.status === "running") patch.started_at = new Date().toISOString();
    if (data.status === "completed" || data.status === "cancelled") {
      patch.completed_at = new Date().toISOString();
    }
    const { error } = await supabaseAdmin.from("campaigns").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const tickCampaignFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ id: z.string().uuid(), batch: z.number().int().min(1).max(5).default(1) }).parse(d),
  )
  .handler(async ({ data }) => {
    return tickCampaign(data.id, data.batch);
  });

export const previewCampaignMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      template: z.string().min(1).max(4000),
      fields: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    return { preview: renderTemplate(data.template, data.fields) };
  });