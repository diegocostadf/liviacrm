import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";
import { invalidateEvolutionSettingsCache, pingEvolution } from "@/lib/evolution.server";

const updateSchema = z.object({
  action: z.literal("update"),
  apiUrl: z.string().trim().url().max(500),
  apiKey: z.string().trim().min(1).max(500),
  webhookUrl: z.string().trim().url().max(500).optional().or(z.literal("")),
  webhookToken: z.string().trim().max(500).optional().or(z.literal("")),
  webhookEvents: z.array(z.string().min(1).max(60)).max(30).optional(),
});
const testSchema = z.object({ action: z.literal("test") });
const postSchema = z.union([updateSchema, testSchema]);

function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}

function getErrorMessage(error: unknown) {
  if (error instanceof z.ZodError) return error.issues.map((i) => i.message).join("; ");
  return error instanceof Error ? error.message : String(error);
}

async function requireAdmin(request: Request) {
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
  const userId = data.claims.sub;
  const { data: roles } = await supabaseAdmin.from("user_roles").select("role").eq("user_id", userId);
  const isAdmin = (roles ?? []).some((r) => r.role === "admin");
  if (!isAdmin) throw new Error("Acesso restrito a administradores.");
  return userId;
}

async function getSettings() {
  const { data, error } = await supabaseAdmin
    .from("app_settings")
    .select("value, updated_at")
    .eq("key", "evolution")
    .maybeSingle();
  if (error) throw new Error(error.message);
  const value = (data?.value ?? {}) as Record<string, unknown>;
  return {
    settings: {
      apiUrl: typeof value.apiUrl === "string" ? value.apiUrl : (process.env.EVOLUTION_API_URL ?? ""),
      apiKey: typeof value.apiKey === "string" && value.apiKey ? "••••••••" : (process.env.EVOLUTION_API_KEY ? "••••••••" : ""),
      hasApiKey: Boolean(value.apiKey) || Boolean(process.env.EVOLUTION_API_KEY),
      webhookUrl: typeof value.webhookUrl === "string" ? value.webhookUrl : "",
      webhookToken: typeof value.webhookToken === "string" && value.webhookToken ? "••••••••" : (process.env.EVOLUTION_WEBHOOK_TOKEN ? "••••••••" : ""),
      hasWebhookToken: Boolean(value.webhookToken) || Boolean(process.env.EVOLUTION_WEBHOOK_TOKEN),
      webhookEvents: Array.isArray(value.webhookEvents) ? (value.webhookEvents as string[]) : [],
      updatedAt: data?.updated_at ?? null,
    },
  };
}

export async function handleGet(request: Request) {
  try {
    await requireAdmin(request);
    return json(await getSettings());
  } catch (error) {
    return json({ error: getErrorMessage(error) }, 500);
  }
}

export async function handlePost(request: Request) {
  try {
    const userId = await requireAdmin(request);
    const payload = postSchema.parse(await request.json());

    if (payload.action === "test") return json(await pingEvolution());

    // update
    const { data: existing } = await supabaseAdmin
      .from("app_settings")
      .select("value")
      .eq("key", "evolution")
      .maybeSingle();
    const prev = (existing?.value ?? {}) as Record<string, unknown>;

    // Keep prior apiKey/webhookToken if the field came empty (means "unchanged").
    const apiKey = payload.apiKey && payload.apiKey !== "••••••••" ? payload.apiKey : (prev.apiKey as string | undefined) ?? "";
    const webhookToken = payload.webhookToken && payload.webhookToken !== "••••••••"
      ? payload.webhookToken
      : (prev.webhookToken as string | undefined) ?? "";

    const value = {
      apiUrl: payload.apiUrl.replace(/\/$/, ""),
      apiKey,
      webhookUrl: payload.webhookUrl || undefined,
      webhookToken: webhookToken || undefined,
      webhookEvents: payload.webhookEvents,
    };

    const { error } = await supabaseAdmin
      .from("app_settings")
      .upsert({ key: "evolution", value, updated_by: userId }, { onConflict: "key" });
    if (error) throw new Error(error.message);

    invalidateEvolutionSettingsCache();
    return json(await getSettings());
  } catch (error) {
    return json({ error: getErrorMessage(error) }, 500);
  }
}