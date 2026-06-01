import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { evolutionFetch } from "./evolution.server";

const MAX_ATTEMPTS = 3;

/** Replace {{var}} tokens with values from fields. Missing → empty string. */
export function renderTemplate(template: string, fields: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, k) => {
    const v = fields[k];
    return v == null ? "" : String(v);
  });
}

function isWithinWindow(startHour: number, endHour: number, now = new Date()): boolean {
  // Approx BRT
  const h = (((now.getUTCHours() - 3) % 24) + 24) % 24;
  if (startHour === endHour) return true;
  if (startHour < endHour) return h >= startHour && h < endHour;
  return h >= startHour || h < endHour;
}

function randInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function normalizePhone(raw: string): string {
  return String(raw ?? "").replace(/\D/g, "");
}

type Campaign = {
  id: string;
  status: string;
  instance_id: string;
  template: string;
  throttle_min_seconds: number;
  throttle_max_seconds: number;
  window_start_hour: number;
  window_end_hour: number;
  sent_count: number;
  failed_count: number;
  total_count: number;
};

/** Process up to `batch` pending targets for one campaign. Returns counts. */
export async function tickCampaign(campaignId: string, batch = 1) {
  const { data: campaignRow, error: cErr } = await supabaseAdmin
    .from("campaigns")
    .select("id, status, instance_id, template, throttle_min_seconds, throttle_max_seconds, window_start_hour, window_end_hour, sent_count, failed_count, total_count")
    .eq("id", campaignId)
    .maybeSingle();
  if (cErr || !campaignRow) return { processed: 0, sent: 0, failed: 0, reason: "not_found" as const };
  const campaign = campaignRow as Campaign;
  if (campaign.status !== "running") return { processed: 0, sent: 0, failed: 0, reason: "not_running" as const };
  if (!isWithinWindow(campaign.window_start_hour, campaign.window_end_hour)) {
    return { processed: 0, sent: 0, failed: 0, reason: "out_of_window" as const };
  }

  const { data: inst } = await supabaseAdmin
    .from("whatsapp_instances")
    .select("evolution_instance_name, status")
    .eq("id", campaign.instance_id)
    .maybeSingle();
  if (!inst?.evolution_instance_name) {
    return { processed: 0, sent: 0, failed: 0, reason: "no_instance" as const };
  }

  const nowIso = new Date().toISOString();
  let processed = 0;
  let sent = 0;
  let failed = 0;

  for (let i = 0; i < batch; i++) {
    // Pick + lock next pending target
    const { data: candidates } = await supabaseAdmin
      .from("campaign_targets")
      .select("id, phone, name, custom_fields, attempts")
      .eq("campaign_id", campaign.id)
      .eq("status", "pending")
      .or(`locked_until.is.null,locked_until.lt.${nowIso}`)
      .order("created_at", { ascending: true })
      .limit(1);
    const target = candidates?.[0];
    if (!target) {
      // Nothing pending → mark completed if everything is done.
      const { count: pendingLeft } = await supabaseAdmin
        .from("campaign_targets")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", campaign.id)
        .eq("status", "pending");
      if ((pendingLeft ?? 0) === 0) {
        await supabaseAdmin
          .from("campaigns")
          .update({ status: "completed", completed_at: new Date().toISOString() })
          .eq("id", campaign.id);
      }
      return { processed, sent, failed, reason: "no_pending" as const };
    }

    // Lock for 60s to avoid double-send if another tick races us
    const lockUntil = new Date(Date.now() + 60_000).toISOString();
    await supabaseAdmin
      .from("campaign_targets")
      .update({ locked_until: lockUntil })
      .eq("id", target.id);

    const fields: Record<string, unknown> = {
      ...(target.custom_fields as Record<string, unknown> ?? {}),
      name: target.name ?? "",
      phone: target.phone,
    };
    const rendered = renderTemplate(campaign.template, fields).trim();
    const phone = normalizePhone(target.phone);

    if (!phone || !rendered) {
      await supabaseAdmin
        .from("campaign_targets")
        .update({
          status: "failed",
          error: !phone ? "Telefone inválido" : "Mensagem vazia após renderização",
          attempts: (target.attempts ?? 0) + 1,
          locked_until: null,
        })
        .eq("id", target.id);
      await supabaseAdmin
        .from("campaigns")
        .update({ failed_count: campaign.failed_count + 1 })
        .eq("id", campaign.id);
      failed++;
      processed++;
      continue;
    }

    try {
      const res = (await evolutionFetch(`/message/sendText/${inst.evolution_instance_name}`, {
        method: "POST",
        json: { number: phone, text: rendered },
      })) as { key?: { id?: string } };
      await supabaseAdmin
        .from("campaign_targets")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          rendered_message: rendered.slice(0, 2000),
          wa_message_id: res?.key?.id ?? null,
          attempts: (target.attempts ?? 0) + 1,
          locked_until: null,
          error: null,
        })
        .eq("id", target.id);
      sent++;
    } catch (e) {
      const attempts = (target.attempts ?? 0) + 1;
      const finalFail = attempts >= MAX_ATTEMPTS;
      await supabaseAdmin
        .from("campaign_targets")
        .update({
          status: finalFail ? "failed" : "pending",
          attempts,
          error: (e as Error).message?.slice(0, 500) ?? "send error",
          locked_until: finalFail ? null : new Date(Date.now() + 60_000).toISOString(),
          rendered_message: rendered.slice(0, 2000),
        })
        .eq("id", target.id);
      if (finalFail) failed++;
    }

    // Refresh campaign counters
    await supabaseAdmin
      .from("campaigns")
      .update({
        sent_count: campaign.sent_count + sent,
        failed_count: campaign.failed_count + failed,
      })
      .eq("id", campaign.id);

    processed++;

    // Throttle between sends inside the same tick
    if (i < batch - 1) {
      const wait = randInt(campaign.throttle_min_seconds, campaign.throttle_max_seconds) * 1000;
      await new Promise((r) => setTimeout(r, wait));
    }
  }

  return { processed, sent, failed, reason: "ok" as const };
}

/** Tick all running campaigns. Used by cron endpoint. */
export async function tickAllRunningCampaigns(batchPerCampaign = 1) {
  const { data: running } = await supabaseAdmin
    .from("campaigns")
    .select("id")
    .eq("status", "running");
  const results: Array<{ id: string; processed: number; sent: number; failed: number; reason: string }> = [];
  for (const c of running ?? []) {
    const r = await tickCampaign(c.id, batchPerCampaign);
    results.push({ id: c.id, ...r });
  }
  return results;
}