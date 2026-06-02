import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { evolutionFetch } from "./evolution.server";
import { renderTemplate } from "./campaigns.server";

function normalizePhone(raw: string): string {
  return String(raw ?? "").replace(/\D/g, "");
}

/** Approx BRT (UTC-3). */
function brtNow(now = new Date()) {
  const ms = now.getTime() - 3 * 3600 * 1000;
  const d = new Date(ms);
  return {
    hour: d.getUTCHours(),
    weekday: d.getUTCDay(), // 0..6 (dom..sáb)
  };
}

function isWithinWindow(startHour: number, endHour: number, now = new Date()): boolean {
  const h = (((now.getUTCHours() - 3) % 24) + 24) % 24;
  if (startHour === endHour) return true;
  if (startHour < endHour) return h >= startHour && h < endHour;
  return h >= startHour || h < endHour;
}

function isWithinSchedule(
  startHour: number,
  endHour: number,
  weekdays: number[] | null | undefined,
  now = new Date(),
): boolean {
  const { weekday } = brtNow(now);
  const days = weekdays && weekdays.length ? weekdays : [0, 1, 2, 3, 4, 5, 6];
  if (!days.includes(weekday)) return false;
  return isWithinWindow(startHour, endHour, now);
}

type Step = {
  id: string;
  campaign_id: string;
  status: string;
  template: string;
  scheduled_at: string | null;
  audience: "all" | "not_responded_step" | "responded_step" | "not_subscribed" | "subscribed" | "tag_any";
  audience_step_id: string | null;
  audience_tags: string[] | null;
  materialized_at: string | null;
  sent_count: number;
  failed_count: number;
  // Overrides (NULL = herda da campanha)
  allowed_weekdays: number[] | null;
  max_per_hour: number | null;
  max_per_day: number | null;
  pause_on_reply: boolean | null;
  dedupe_skip_days: number | null;
  allowed_instance_ids: string[] | null;
  retry_max_attempts: number | null;
  retry_backoff_seconds: number | null;
};

type Campaign = {
  id: string;
  status: string;
  instance_id: string;
  throttle_min_seconds: number;
  throttle_max_seconds: number;
  window_start_hour: number;
  window_end_hour: number;
  allowed_weekdays: number[];
  max_per_hour: number;
  max_per_day: number;
  pause_on_reply: boolean;
  dedupe_skip_days: number;
  allowed_instance_ids: string[];
  retry_max_attempts: number;
  retry_backoff_seconds: number;
  last_instance_idx: number;
};

export type EffectiveRules = {
  weekdays: number[];
  windowStart: number;
  windowEnd: number;
  maxPerHour: number;
  maxPerDay: number;
  pauseOnReply: boolean;
  dedupeSkipDays: number;
  instanceIds: string[];
  retryMaxAttempts: number;
  retryBackoffSeconds: number;
};

export function effectiveRules(step: Step, campaign: Campaign): EffectiveRules {
  const instanceIds =
    step.allowed_instance_ids && step.allowed_instance_ids.length
      ? step.allowed_instance_ids
      : campaign.allowed_instance_ids && campaign.allowed_instance_ids.length
        ? campaign.allowed_instance_ids
        : [campaign.instance_id];
  return {
    weekdays: step.allowed_weekdays ?? campaign.allowed_weekdays ?? [1, 2, 3, 4, 5],
    windowStart: campaign.window_start_hour,
    windowEnd: campaign.window_end_hour,
    maxPerHour: step.max_per_hour ?? campaign.max_per_hour ?? 60,
    maxPerDay: step.max_per_day ?? campaign.max_per_day ?? 500,
    pauseOnReply: step.pause_on_reply ?? campaign.pause_on_reply ?? true,
    dedupeSkipDays: step.dedupe_skip_days ?? campaign.dedupe_skip_days ?? 0,
    instanceIds,
    retryMaxAttempts: step.retry_max_attempts ?? campaign.retry_max_attempts ?? 3,
    retryBackoffSeconds: step.retry_backoff_seconds ?? campaign.retry_backoff_seconds ?? 120,
  };
}

/**
 * Cria registros em campaign_step_sends a partir do public-alvo do step:
 * - all: todos os campaign_targets da campanha
 * - not_responded_step / responded_step: filtra pelos step_sends do step referenciado
 * - not_subscribed / subscribed: usa contacts.journey_completed via contacts.phone
 * - tag_any: contatos com pelo menos uma das tags listadas
 *
 * Em qualquer caso, contatos com opted_out=true são pulados.
 * Retorna o nº de step_sends criados.
 */
export async function materializeStep(stepId: string): Promise<number> {
  const { data: step } = await supabaseAdmin
    .from("campaign_steps")
    .select("*")
    .eq("id", stepId)
    .maybeSingle();
  if (!step) return 0;
  if (step.materialized_at) return 0;

  // Pool de contatos da campanha
  const { data: pool } = await supabaseAdmin
    .from("campaign_targets")
    .select("id, phone, name, custom_fields")
    .eq("campaign_id", step.campaign_id);
  if (!pool?.length) {
    await supabaseAdmin
      .from("campaign_steps")
      .update({ materialized_at: new Date().toISOString(), total_count: 0 })
      .eq("id", stepId);
    return 0;
  }

  const phones = pool.map((p) => p.phone);

  // Mapa de contatos para opt-out / journey / tags
  const { data: contacts } = await supabaseAdmin
    .from("contacts")
    .select("id, phone, opted_out, journey_completed, tags")
    .in("phone", phones);
  const cByPhone = new Map((contacts ?? []).map((c) => [c.phone, c]));

  // Filtro por step referenciado
  let allowedTargetIds: Set<string> | null = null;
  if ((step.audience === "not_responded_step" || step.audience === "responded_step") && step.audience_step_id) {
    const { data: prev } = await supabaseAdmin
      .from("campaign_step_sends")
      .select("target_id, status, replied_at")
      .eq("step_id", step.audience_step_id);
    const replied = new Set((prev ?? []).filter((r) => r.replied_at || r.status === "replied").map((r) => r.target_id));
    if (step.audience === "responded_step") {
      allowedTargetIds = replied;
    } else {
      const sent = new Set((prev ?? []).filter((r) => r.status === "sent" || r.status === "replied").map((r) => r.target_id));
      allowedTargetIds = new Set([...sent].filter((id) => !replied.has(id)));
    }
  }

  const tagsLower = (step.audience_tags ?? []).map((t: string) => t.toLowerCase());

  const rows = pool
    .filter((t) => {
      const c = cByPhone.get(t.phone);
      if (c?.opted_out) return false;
      if (allowedTargetIds && !allowedTargetIds.has(t.id)) return false;
      if (step.audience === "not_subscribed" && c?.journey_completed) return false;
      if (step.audience === "subscribed" && !c?.journey_completed) return false;
      if (step.audience === "tag_any") {
        const ctags = (c?.tags ?? []).map((x: string) => x.toLowerCase());
        if (!tagsLower.some((t2) => ctags.includes(t2))) return false;
      }
      return true;
    })
    .map((t) => ({
      step_id: stepId,
      campaign_id: step.campaign_id,
      target_id: t.id,
      contact_id: cByPhone.get(t.phone)?.id ?? null,
      phone: t.phone,
      status: "pending" as const,
    }));

  // Insere em chunks; UNIQUE(step_id,target_id) evita duplicatas em re-execuções
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error } = await supabaseAdmin
      .from("campaign_step_sends")
      .upsert(chunk, { onConflict: "step_id,target_id", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
    inserted += chunk.length;
  }

  await supabaseAdmin
    .from("campaign_steps")
    .update({
      materialized_at: new Date().toISOString(),
      total_count: inserted,
      status: step.status === "draft" ? "scheduled" : step.status,
    })
    .eq("id", stepId);

  return inserted;
}

/**
 * Processa até `batch` envios pendentes de um disparo (step).
 * Respeita janela horária + dias da semana, multi-instância (round-robin com
 * quota hora/dia), pausa-se-respondeu, dedupe-multi-campanha, retry com
 * backoff exponencial. Marca step como completed quando esgota pendentes.
 */
export async function tickStep(stepId: string, batch = 1) {
  const { data: step } = await supabaseAdmin
    .from("campaign_steps")
    .select("*")
    .eq("id", stepId)
    .maybeSingle();
  if (!step) return { sent: 0, failed: 0, reason: "not_found" as const };
  const s = step as unknown as Step;

  if (!["scheduled", "sending"].includes(s.status)) {
    return { sent: 0, failed: 0, reason: "not_active" as const };
  }
  if (s.scheduled_at && new Date(s.scheduled_at).getTime() > Date.now()) {
    return { sent: 0, failed: 0, reason: "not_due" as const };
  }

  if (!s.materialized_at) {
    await materializeStep(stepId);
  }

  const { data: campaign } = await supabaseAdmin
    .from("campaigns")
    .select("*")
    .eq("id", s.campaign_id)
    .maybeSingle();
  if (!campaign) return { sent: 0, failed: 0, reason: "no_campaign" as const };
  const c = campaign as unknown as Campaign;
  const rules = effectiveRules(s, c);

  if (!isWithinSchedule(rules.windowStart, rules.windowEnd, rules.weekdays)) {
    return { sent: 0, failed: 0, reason: "out_of_window" as const };
  }

  // Carrega TODAS as instâncias permitidas
  const { data: instRows } = await supabaseAdmin
    .from("whatsapp_instances")
    .select("id, evolution_instance_name")
    .in("id", rules.instanceIds);
  const instances = (instRows ?? []).filter((i) => i.evolution_instance_name);
  if (!instances.length) return { sent: 0, failed: 0, reason: "no_instance" as const };

  await supabaseAdmin.from("campaign_steps").update({ status: "sending" }).eq("id", stepId);

  // Pré-carrega contatos que já responderam nesta campanha (para pause_on_reply)
  let repliedPhones = new Set<string>();
  if (rules.pauseOnReply) {
    const { data: replies } = await supabaseAdmin
      .from("campaign_step_sends")
      .select("phone")
      .eq("campaign_id", s.campaign_id)
      .not("replied_at", "is", null);
    repliedPhones = new Set((replies ?? []).map((r) => r.phone));
  }

  // Pré-carrega telefones recém-contatados em OUTRAS campanhas (dedupe)
  let dedupedPhones = new Set<string>();
  if (rules.dedupeSkipDays > 0) {
    const cutoff = new Date(Date.now() - rules.dedupeSkipDays * 86400 * 1000).toISOString();
    const { data: recent } = await supabaseAdmin
      .from("campaign_step_sends")
      .select("phone, campaign_id")
      .eq("status", "sent")
      .gt("sent_at", cutoff);
    dedupedPhones = new Set(
      (recent ?? []).filter((r) => r.campaign_id !== s.campaign_id).map((r) => r.phone),
    );
  }

  // Conta envios já feitos por instância nas últimas 1h e 24h
  async function getInstanceQuota(instanceId: string) {
    const hourAgo = new Date(Date.now() - 3600 * 1000).toISOString();
    const dayAgo = new Date(Date.now() - 86400 * 1000).toISOString();
    const [{ count: hCount }, { count: dCount }] = await Promise.all([
      supabaseAdmin
        .from("campaign_step_sends")
        .select("id", { count: "exact", head: true })
        .eq("instance_id_used", instanceId)
        .eq("status", "sent")
        .gt("sent_at", hourAgo),
      supabaseAdmin
        .from("campaign_step_sends")
        .select("id", { count: "exact", head: true })
        .eq("instance_id_used", instanceId)
        .eq("status", "sent")
        .gt("sent_at", dayAgo),
    ]);
    return { perHour: hCount ?? 0, perDay: dCount ?? 0 };
  }

  // Cache de quotas por instância (atualizada após cada envio bem-sucedido)
  const quotas = new Map<string, { perHour: number; perDay: number }>();
  for (const inst of instances) {
    quotas.set(inst.id, await getInstanceQuota(inst.id));
  }

  let rrIdx = c.last_instance_idx ?? 0;
  function pickInstance(): { id: string; evolution_instance_name: string } | null {
    for (let k = 0; k < instances.length; k++) {
      const inst = instances[(rrIdx + k) % instances.length];
      const q = quotas.get(inst.id) ?? { perHour: 0, perDay: 0 };
      if (q.perHour < rules.maxPerHour && q.perDay < rules.maxPerDay) {
        rrIdx = (rrIdx + k + 1) % instances.length;
        return inst as { id: string; evolution_instance_name: string };
      }
    }
    return null;
  }

  let sent = 0;
  let failed = 0;
  const nowIso = new Date().toISOString();

  for (let i = 0; i < batch; i++) {
    // Quota global esgotada para todas as instâncias deste tick
    const anyAvailable = instances.some((inst) => {
      const q = quotas.get(inst.id) ?? { perHour: 0, perDay: 0 };
      return q.perHour < rules.maxPerHour && q.perDay < rules.maxPerDay;
    });
    if (!anyAvailable) {
      return { sent, failed, reason: "rate_limited" as const };
    }

    const { data: candidates } = await supabaseAdmin
      .from("campaign_step_sends")
      .select("id, target_id, phone, attempts")
      .eq("step_id", stepId)
      .eq("status", "pending")
      .or(`locked_until.is.null,locked_until.lt.${nowIso}`)
      .order("created_at", { ascending: true })
      .limit(1);
    const send = candidates?.[0];
    if (!send) {
      // Nada mais pendente: marca step como concluído.
      const { count: stillPending } = await supabaseAdmin
        .from("campaign_step_sends")
        .select("id", { count: "exact", head: true })
        .eq("step_id", stepId)
        .eq("status", "pending");
      if ((stillPending ?? 0) === 0) {
        await supabaseAdmin
          .from("campaign_steps")
          .update({ status: "completed", completed_at: new Date().toISOString() })
          .eq("id", stepId);
      }
      return { sent, failed, reason: "no_pending" as const };
    }

    // Lock 60s
    await supabaseAdmin
      .from("campaign_step_sends")
      .update({ locked_until: new Date(Date.now() + 60_000).toISOString() })
      .eq("id", send.id);

    // Pausa-se-respondeu / dedupe
    if (rules.pauseOnReply && repliedPhones.has(send.phone)) {
      await supabaseAdmin
        .from("campaign_step_sends")
        .update({ status: "skipped_replied", error: "pause_on_reply", locked_until: null })
        .eq("id", send.id);
      continue;
    }
    if (rules.dedupeSkipDays > 0 && dedupedPhones.has(send.phone)) {
      await supabaseAdmin
        .from("campaign_step_sends")
        .update({ status: "skipped_dedupe", error: `dedupe_${rules.dedupeSkipDays}d`, locked_until: null })
        .eq("id", send.id);
      continue;
    }

    // Recarrega target para variáveis
    const { data: target } = await supabaseAdmin
      .from("campaign_targets")
      .select("name, custom_fields")
      .eq("id", send.target_id)
      .maybeSingle();

    // Re-checa opt-out na hora do envio
    const { data: contact } = await supabaseAdmin
      .from("contacts")
      .select("opted_out")
      .eq("phone", send.phone)
      .maybeSingle();
    if (contact?.opted_out) {
      await supabaseAdmin
        .from("campaign_step_sends")
        .update({ status: "skipped", error: "opt-out", locked_until: null })
        .eq("id", send.id);
      continue;
    }

    // Escolhe instância disponível (round-robin com quota)
    const inst = pickInstance();
    if (!inst) {
      // Liberar lock e abortar este tick
      await supabaseAdmin
        .from("campaign_step_sends")
        .update({ locked_until: null })
        .eq("id", send.id);
      return { sent, failed, reason: "rate_limited" as const };
    }

    const fields = {
      ...(target?.custom_fields as Record<string, unknown> ?? {}),
      name: target?.name ?? "",
      phone: send.phone,
    };
    const rendered = renderTemplate(s.template, fields).trim();
    const phone = normalizePhone(send.phone);

    if (!phone || !rendered) {
      await supabaseAdmin
        .from("campaign_step_sends")
        .update({
          status: "failed",
          error: !phone ? "Telefone inválido" : "Mensagem vazia",
          attempts: (send.attempts ?? 0) + 1,
          locked_until: null,
        })
        .eq("id", send.id);
      failed++;
      continue;
    }

    try {
      const res = (await evolutionFetch(`/message/sendText/${inst.evolution_instance_name}`, {
        method: "POST",
        json: { number: phone, text: rendered },
      })) as { key?: { id?: string } };
      await supabaseAdmin
        .from("campaign_step_sends")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          rendered_message: rendered.slice(0, 2000),
          wa_message_id: res?.key?.id ?? null,
          attempts: (send.attempts ?? 0) + 1,
          locked_until: null,
          error: null,
          instance_id_used: inst.id,
        })
        .eq("id", send.id);
      sent++;
      const q = quotas.get(inst.id) ?? { perHour: 0, perDay: 0 };
      quotas.set(inst.id, { perHour: q.perHour + 1, perDay: q.perDay + 1 });
    } catch (e) {
      const attempts = (send.attempts ?? 0) + 1;
      const finalFail = attempts >= rules.retryMaxAttempts;
      const backoffSec = Math.min(
        3600,
        rules.retryBackoffSeconds * Math.pow(2, Math.max(0, attempts - 1)),
      );
      await supabaseAdmin
        .from("campaign_step_sends")
        .update({
          status: finalFail ? "failed" : "pending",
          attempts,
          error: (e as Error).message?.slice(0, 500) ?? "send error",
          locked_until: finalFail ? null : new Date(Date.now() + backoffSec * 1000).toISOString(),
          rendered_message: rendered.slice(0, 2000),
          instance_id_used: inst.id,
        })
        .eq("id", send.id);
      if (finalFail) failed++;
    }

    await supabaseAdmin
      .from("campaign_steps")
      .update({
        sent_count: s.sent_count + sent,
        failed_count: s.failed_count + failed,
      })
      .eq("id", stepId);

    if (i < batch - 1) {
      const min = c.throttle_min_seconds;
      const max = Math.max(min, c.throttle_max_seconds);
      const wait = (Math.floor(Math.random() * (max - min + 1)) + min) * 1000;
      await new Promise((r) => setTimeout(r, wait));
    }
  }

  // Persiste último índice de round-robin para a próxima tick
  if (instances.length > 1) {
    await supabaseAdmin
      .from("campaigns")
      .update({ last_instance_idx: rrIdx })
      .eq("id", c.id);
  }

  return { sent, failed, reason: "ok" as const };
}

/**
 * Detecta comandos de opt-out (SAIR/PARAR/NÃO etc) em mensagem recebida e:
 * 1. Marca contacts.opted_out = true
 * 2. Marca quaisquer step_sends pendentes para esse telefone como 'skipped'
 * 3. Envia resposta automática usando a primeira campanha ativa com opt_out_reply
 *
 * Retorna true se o opt-out foi acionado (caller pode encerrar o pipeline).
 */
export async function handleOptOut(args: {
  instanceName: string;
  phone: string;
  text: string;
}): Promise<boolean> {
  const txt = (args.text ?? "").trim().toLowerCase();
  if (!txt) return false;

  // Junta keywords de todas as campanhas + fallback padrão
  const { data: camps } = await supabaseAdmin
    .from("campaigns")
    .select("opt_out_keywords, opt_out_reply")
    .limit(50);
  const defaultKw = ["sair", "parar", "não", "nao", "remover", "cancelar", "stop"];
  const kwSet = new Set<string>(defaultKw);
  for (const c of camps ?? []) {
    for (const k of (c.opt_out_keywords ?? []) as string[]) {
      const v = String(k ?? "").trim().toLowerCase();
      if (v) kwSet.add(v);
    }
  }

  // Match: a mensagem precisa SER a palavra-chave (ou ela isolada).
  // Evita falso positivo em "nao gostei do video" — pega só "não", "sair" etc.
  const isMatch = [...kwSet].some((kw) => {
    const re = new RegExp(`^\\s*${kw.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\s*[.!?]?\\s*$`, "i");
    return re.test(txt);
  });
  if (!isMatch) return false;

  // Marca contato como opt-out
  await supabaseAdmin
    .from("contacts")
    .update({
      opted_out: true,
      opted_out_at: new Date().toISOString(),
      opt_out_reason: args.text.slice(0, 200),
    })
    .eq("phone", args.phone);

  // Cancela envios pendentes para esse telefone em qualquer step
  await supabaseAdmin
    .from("campaign_step_sends")
    .update({ status: "skipped", error: "opt-out", locked_until: null })
    .eq("phone", args.phone)
    .eq("status", "pending");

  // Tenta enviar resposta automática
  const reply =
    (camps ?? []).map((c) => c.opt_out_reply).find((r) => r && String(r).trim().length > 0) ??
    "Tudo bem! Você não receberá mais mensagens deste número. 🙏";
  try {
    await evolutionFetch(`/message/sendText/${args.instanceName}`, {
      method: "POST",
      json: { number: args.phone, text: String(reply) },
    });
  } catch (e) {
    console.warn("[opt-out] falha ao enviar reply", e);
  }

  return true;
}

/**
 * Quando recebemos mensagem inbound de um contato, marca como 'replied'
 * todos os step_sends 'sent' desse telefone (em qualquer campanha) que
 * ainda não tinham replied_at. Útil para o filtro "não respondeu".
 */
export async function markRepliesForPhone(phone: string): Promise<void> {
  await supabaseAdmin
    .from("campaign_step_sends")
    .update({ status: "replied", replied_at: new Date().toISOString() })
    .eq("phone", phone)
    .eq("status", "sent");
}