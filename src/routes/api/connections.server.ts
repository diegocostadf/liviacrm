import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";
import { evolutionFetch, pingEvolution } from "@/lib/evolution.server";

type InstanceStatus = Database["public"]["Enums"]["instance_status"];

const createSchema = z.object({ action: z.literal("create"), name: z.string().min(1).max(60).regex(/^[a-zA-Z0-9_-]+$/) });
const nameActionSchema = z.object({
  action: z.enum(["connect", "status", "disconnect", "delete"]),
  name: z.string().min(1).max(120),
});
const testSchema = z.object({ action: z.literal("test") });
const syncSchema = z.object({ action: z.literal("sync") });
const postSchema = z.union([createSchema, nameActionSchema, testSchema, syncSchema]);

function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}

function getErrorMessage(error: unknown) {
  if (error instanceof z.ZodError) return error.issues.map((issue) => issue.message).join("; ");
  return error instanceof Error ? error.message : String(error);
}

async function requireUser(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) throw new Error("Sessão expirada. Faça login novamente.");

  const token = authHeader.replace("Bearer ", "");
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Backend de autenticação não configurado.");

  const supabase = createClient<Database>(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getClaims(token);
  if (error || !data?.claims?.sub) throw new Error("Sessão inválida. Faça login novamente.");
  return data.claims.sub;
}

async function listAndSyncInstances(userId: string) {
  let syncError: string | null = null;
  try {
    await syncEvolutionInstances(userId);
  } catch (error) {
    syncError = getErrorMessage(error);
  }

  const { data, error } = await supabaseAdmin
    .from("whatsapp_instances")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return { instances: data ?? [], syncError };
}

async function syncEvolutionInstances(userId: string) {
  const remote = await getRemoteInstances();
  const { data: local, error } = await supabaseAdmin.from("whatsapp_instances").select("*");
  if (error) throw new Error(error.message);
  const byName = new Map((local ?? []).map((item) => [item.evolution_instance_name, item]));

  for (const raw of remote) {
    const parsed = parseRemoteInstance(raw);
    if (!parsed.name) continue;
    const existing = byName.get(parsed.name);
    const values = {
      status: parsed.status,
      phone_number: parsed.phone ?? null,
      profile_name: parsed.profileName ?? null,
      profile_pic_url: parsed.profilePic ?? null,
      last_sync_at: new Date().toISOString(),
      ...(existing?.owner_id ? {} : { owner_id: userId }),
    };

    if (existing) {
      await supabaseAdmin.from("whatsapp_instances").update(values).eq("id", existing.id);
    } else {
      await supabaseAdmin.from("whatsapp_instances").insert({
        ...values,
        name: parsed.name,
        evolution_instance_name: parsed.name,
      });
    }
  }
}

async function getRemoteInstances() {
  const response = await evolutionFetch("/instance/fetchInstances");
  return Array.isArray(response) ? (response as Record<string, unknown>[]) : [];
}

function parseRemoteInstance(raw: Record<string, unknown>) {
  const instance = (raw.instance && typeof raw.instance === "object" ? raw.instance : raw) as Record<string, unknown>;
  const name = String(instance.instanceName ?? raw.instanceName ?? raw.name ?? "");
  const state = String(instance.state ?? instance.status ?? raw.connectionStatus ?? raw.state ?? "");
  const status = mapStatus(state);
  const owner = String(instance.owner ?? raw.owner ?? "");
  return {
    name,
    status,
    phone: owner ? owner.split("@")[0] : undefined,
    profileName: typeof instance.profileName === "string" ? instance.profileName : undefined,
    profilePic: typeof instance.profilePictureUrl === "string" ? instance.profilePictureUrl : undefined,
  };
}

function mapStatus(state: string): InstanceStatus {
  const normalized = state.toLowerCase();
  if (["open", "connected", "online"].includes(normalized)) return "connected";
  if (["connecting", "qr", "qrcode", "pairing"].includes(normalized)) return "connecting";
  if (["error", "failed"].includes(normalized)) return "error";
  return "disconnected";
}

async function createInstanceForUser(name: string, userId: string, request: Request) {
  const evoName = name.toLowerCase();
  const remoteExists = (await getRemoteInstances()).some((item) => parseRemoteInstance(item).name === evoName);

  if (!remoteExists) {
    const payload: Record<string, unknown> = {
      instanceName: evoName,
      integration: "WHATSAPP-BAILEYS",
      qrcode: true,
      webhook: {
        url: buildWebhookUrl(request),
        byEvents: false,
        base64: true,
        events: ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CONNECTION_UPDATE", "QRCODE_UPDATED", "CONTACTS_UPSERT"],
      },
    };
    try {
      await evolutionFetch("/instance/create", { method: "POST", json: payload });
    } catch (error) {
      const message = getErrorMessage(error);
      if (!/exist|already|409|já/i.test(message)) throw error;
    }
  }

  const { data, error } = await supabaseAdmin
    .from("whatsapp_instances")
    .upsert({ name, evolution_instance_name: evoName, status: "disconnected", owner_id: userId }, { onConflict: "evolution_instance_name" })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

function buildWebhookUrl(request: Request) {
  const url = new URL("/api/public/webhooks/evolution", new URL(request.url).origin);
  const token = process.env.EVOLUTION_WEBHOOK_TOKEN;
  if (token) url.searchParams.set("token", token);
  return url.toString();
}

async function connectInstanceByName(name: string) {
  const res = (await evolutionFetch(`/instance/connect/${encodeURIComponent(name)}`)) as Record<string, unknown>;
  await supabaseAdmin.from("whatsapp_instances").update({ status: "connecting", last_sync_at: new Date().toISOString() }).eq("evolution_instance_name", name);
  const qr = (res?.base64 as string) ?? (res?.qrcode as { base64?: string })?.base64 ?? null;
  const code = (res?.code as string) ?? (res?.qrcode as { code?: string })?.code ?? null;
  return { qrBase64: qr, pairingCode: code };
}

async function refreshInstanceStatus(name: string) {
  const state = (await evolutionFetch(`/instance/connectionState/${encodeURIComponent(name)}`)) as { instance?: { state?: string } };
  const status = mapStatus(state?.instance?.state ?? "disconnected");
  await supabaseAdmin.from("whatsapp_instances").update({ status, last_sync_at: new Date().toISOString() }).eq("evolution_instance_name", name);
  return { status };
}

async function disconnectInstanceByName(name: string) {
  await evolutionFetch(`/instance/logout/${encodeURIComponent(name)}`, { method: "DELETE" });
  await supabaseAdmin.from("whatsapp_instances").update({ status: "disconnected" }).eq("evolution_instance_name", name);
  return { ok: true };
}

async function deleteInstanceByName(name: string) {
  try { await evolutionFetch(`/instance/logout/${encodeURIComponent(name)}`, { method: "DELETE" }); } catch { /* noop */ }
  try { await evolutionFetch(`/instance/delete/${encodeURIComponent(name)}`, { method: "DELETE" }); } catch { /* noop */ }
  await supabaseAdmin.from("whatsapp_instances").delete().eq("evolution_instance_name", name);
  return { ok: true };
}

export async function handleGet(request: Request) {
  try {
    const userId = await requireUser(request);
    return json(await listAndSyncInstances(userId));
  } catch (error) {
    return json({ error: getErrorMessage(error) }, 500);
  }
}

export async function handlePost(request: Request) {
  try {
    const userId = await requireUser(request);
    const payload = postSchema.parse(await request.json());

    if (payload.action === "test") return json(await pingEvolution());
    if (payload.action === "sync") return json(await listAndSyncInstances(userId));
    if (payload.action === "create") return json({ instance: await createInstanceForUser(payload.name, userId, request) });
    if (payload.action === "connect") return json(await connectInstanceByName(payload.name));
    if (payload.action === "status") return json(await refreshInstanceStatus(payload.name));
    if (payload.action === "disconnect") return json(await disconnectInstanceByName(payload.name));
    if (payload.action === "delete") return json(await deleteInstanceByName(payload.name));

    return json({ error: "Ação inválida." }, 400);
  } catch (error) {
    return json({ error: getErrorMessage(error) }, 500);
  }
}