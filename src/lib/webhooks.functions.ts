import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function assertAdmin(userId: string) {
  const { data: roles } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  const ok = (roles ?? []).some((r) => r.role === "admin" || r.role === "gestor");
  if (!ok) throw new Error("Acesso restrito a administradores.");
}

export const WEBHOOK_EVENTS = [
  "conversation.created",
  "message.inbound",
  "message.outbound",
  "lead.scored",
  "lead.hot",
  "lead.handoff",
  "campaign.completed",
] as const;

const eventSchema = z.enum(WEBHOOK_EVENTS);

export const listWebhooks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { data, error } = await supabaseAdmin
      .from("webhook_endpoints")
      .select("id,name,url,events,active,secret,last_status,last_called_at,created_at,updated_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map((w) => ({
      ...w,
      secretPreview: w.secret ? `${w.secret.slice(0, 4)}••••${w.secret.slice(-4)}` : "",
    }));
  });

const upsertSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(120),
  url: z.string().url().max(500),
  events: z.array(eventSchema).min(1),
  active: z.boolean().default(true),
  secret: z.string().max(200).optional(), // empty = keep
});

export const upsertWebhook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => upsertSchema.parse(d))
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    if (data.id) {
      const patch: Record<string, unknown> = {
        name: data.name,
        url: data.url,
        events: data.events,
        active: data.active,
        updated_at: new Date().toISOString(),
      };
      if (data.secret) patch.secret = data.secret;
      const { error } = await supabaseAdmin.from("webhook_endpoints").update(patch).eq("id", data.id);
      if (error) throw new Error(error.message);
      return { ok: true, id: data.id };
    }
    const { data: row, error } = await supabaseAdmin
      .from("webhook_endpoints")
      .insert({
        name: data.name,
        url: data.url,
        events: data.events,
        active: data.active,
        secret: data.secret || null,
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { ok: true, id: row.id };
  });

export const deleteWebhook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const { error } = await supabaseAdmin.from("webhook_endpoints").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

async function signPayload(secret: string, body: string) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export const testWebhook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const { data: hook, error } = await supabaseAdmin
      .from("webhook_endpoints")
      .select("id,url,secret,events")
      .eq("id", data.id)
      .single();
    if (error || !hook) throw new Error(error?.message ?? "Webhook não encontrado.");

    const payload = {
      event: "test.ping",
      sent_at: new Date().toISOString(),
      data: { message: "Teste de entrega do Lívia CRM." },
    };
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (hook.secret) headers["X-Livia-Signature"] = await signPayload(hook.secret, body);

    const t0 = Date.now();
    let status = 0;
    let respText = "";
    let ok = false;
    try {
      const res = await fetch(hook.url, { method: "POST", headers, body });
      status = res.status;
      respText = (await res.text()).slice(0, 500);
      ok = res.ok;
    } catch (e) {
      respText = e instanceof Error ? e.message : String(e);
    }

    await supabaseAdmin.from("webhook_deliveries").insert({
      endpoint_id: hook.id,
      event: "test.ping",
      payload,
      response_status: status || null,
      response_body: respText,
      succeeded: ok,
    });
    await supabaseAdmin
      .from("webhook_endpoints")
      .update({ last_status: status || null, last_called_at: new Date().toISOString() })
      .eq("id", hook.id);

    return { ok, status, latencyMs: Date.now() - t0, response: respText };
  });

export const listDeliveries = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ endpointId: z.string().uuid().optional() }).parse(d ?? {}))
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    let q = supabaseAdmin
      .from("webhook_deliveries")
      .select("id,endpoint_id,event,response_status,succeeded,created_at,response_body")
      .order("created_at", { ascending: false })
      .limit(50);
    if (data.endpointId) q = q.eq("endpoint_id", data.endpointId);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });