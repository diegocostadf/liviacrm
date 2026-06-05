import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { materializeStep, tickStep } from "./campaign-steps.server";

const audienceEnum = z.enum([
  "all",
  "not_responded_step",
  "responded_step",
  "not_subscribed",
  "subscribed",
  "tag_any",
]);

const statusEnum = z.enum(["draft", "scheduled", "sending", "completed", "paused", "failed"]);

const baseStepSchema = z.object({
  campaign_id: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  label: z.string().trim().max(20).optional().nullable(),
  scheduled_at: z.string().datetime().optional().nullable(),
  template: z.string().trim().min(1).max(4000),
  audience: audienceEnum.default("all"),
  audience_step_id: z.string().uuid().optional().nullable(),
  audience_tags: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  audience_states: z.array(z.string().trim().min(1).max(40)).max(50).default([]),
  audience_cities: z.array(z.string().trim().min(1).max(80)).max(200).default([]),
  ord: z.number().int().min(0).max(999).default(1),
  // Overrides (null = herda da campanha)
  allowed_weekdays: z.array(z.number().int().min(0).max(6)).max(7).optional().nullable(),
  max_per_hour: z.number().int().min(1).max(10000).optional().nullable(),
  max_per_day: z.number().int().min(1).max(1000000).optional().nullable(),
  pause_on_reply: z.boolean().optional().nullable(),
  dedupe_skip_days: z.number().int().min(0).max(365).optional().nullable(),
  allowed_instance_ids: z.array(z.string().uuid()).max(20).optional().nullable(),
  retry_max_attempts: z.number().int().min(1).max(10).optional().nullable(),
  retry_backoff_seconds: z.number().int().min(10).max(3600).optional().nullable(),
});

export const listSteps = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ campaignId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { data: steps, error } = await supabaseAdmin
      .from("campaign_steps")
      .select("*")
      .eq("campaign_id", data.campaignId)
      .order("ord", { ascending: true })
      .order("scheduled_at", { ascending: true, nullsFirst: false });
    if (error) throw new Error(error.message);
    return { steps: steps ?? [] };
  });

export const createStep = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => baseStepSchema.parse(d))
  .handler(async ({ data }) => {
    const { data: row, error } = await supabaseAdmin
      .from("campaign_steps")
      .insert({
        campaign_id: data.campaign_id,
        name: data.name,
        label: data.label ?? null,
        scheduled_at: data.scheduled_at ?? null,
        template: data.template,
        audience: data.audience,
        audience_step_id: data.audience_step_id ?? null,
        audience_tags: data.audience_tags,
      audience_states: data.audience_states,
      audience_cities: data.audience_cities,
        ord: data.ord,
        allowed_weekdays: data.allowed_weekdays ?? null,
        max_per_hour: data.max_per_hour ?? null,
        max_per_day: data.max_per_day ?? null,
        pause_on_reply: data.pause_on_reply ?? null,
        dedupe_skip_days: data.dedupe_skip_days ?? null,
        allowed_instance_ids: data.allowed_instance_ids ?? null,
        retry_max_attempts: data.retry_max_attempts ?? null,
        retry_backoff_seconds: data.retry_backoff_seconds ?? null,
      })
      .select("id")
      .single();
    if (error || !row) throw new Error(error?.message ?? "Falha ao criar disparo");
    return { id: row.id };
  });

export const updateStep = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    baseStepSchema.partial().extend({ id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { id, ...patch } = data;
    const { error } = await supabaseAdmin.from("campaign_steps").update(patch).eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteStep = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    await supabaseAdmin.from("campaign_step_sends").delete().eq("step_id", data.id);
    const { error } = await supabaseAdmin.from("campaign_steps").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setStepStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid(), status: statusEnum }).parse(d))
  .handler(async ({ data }) => {
    const patch = {
      status: data.status,
      ...(data.status === "completed" ? { completed_at: new Date().toISOString() } : {}),
    };
    const { error } = await supabaseAdmin
      .from("campaign_steps")
      .update(patch as never)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const materializeStepFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => ({ created: await materializeStep(data.id) }));

export const tickStepFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ id: z.string().uuid(), batch: z.number().int().min(1).max(5).default(1) }).parse(d),
  )
  .handler(async ({ data }) => tickStep(data.id, data.batch));

export const updateCampaignOptOut = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      id: z.string().uuid(),
      opt_out_keywords: z.array(z.string().trim().min(1).max(40)).max(20),
      opt_out_reply: z.string().trim().max(1000).optional().nullable(),
      event_date: z.string().datetime().optional().nullable(),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const { id, ...patch } = data;
    const { error } = await supabaseAdmin.from("campaigns").update(patch).eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listCampaignLocations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ campaignId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    // Pega telefones da campanha em páginas
    const phones: string[] = [];
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data: rows, error } = await supabaseAdmin
        .from("campaign_targets")
        .select("phone")
        .eq("campaign_id", data.campaignId)
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      phones.push(...(rows ?? []).map((r) => r.phone));
      if (!rows || rows.length < PAGE) break;
    }
    const unique = [...new Set(phones)];
    const states = new Map<string, number>();
    const cities = new Map<string, { uf: string | null; count: number }>();
    for (let i = 0; i < unique.length; i += 500) {
      const slice = unique.slice(i, i + 500);
      const { data: cs, error } = await supabaseAdmin
        .from("contacts")
        .select("state, city")
        .in("phone", slice);
      if (error) throw new Error(error.message);
      for (const c of cs ?? []) {
        const uf = (c.state ?? "").trim().toUpperCase();
        const ci = (c.city ?? "").trim();
        if (uf) states.set(uf, (states.get(uf) ?? 0) + 1);
        if (ci) {
          const key = ci.toLowerCase();
          const prev = cities.get(key) ?? { uf: uf || null, count: 0 };
          cities.set(key, { uf: prev.uf ?? (uf || null), count: prev.count + 1 });
        }
      }
    }
    return {
      states: [...states.entries()]
        .map(([uf, count]) => ({ uf, count }))
        .sort((a, b) => b.count - a.count),
      cities: [...cities.entries()]
        .map(([name, v]) => ({ name, uf: v.uf, count: v.count }))
        .sort((a, b) => b.count - a.count),
    };
  });