import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";
import { createTemplate, deleteTemplate, updateTemplate, type TemplateComponent } from "@/lib/whatsapp-cloud.server";

function json(data: unknown, status = 200) { return Response.json(data, { status }); }

async function requireAuth(request: Request, adminOnly = false) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) throw new Error("Sessão expirada.");
  const token = authHeader.replace("Bearer ", "");
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY!;
  const supabase = createClient<Database>(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getClaims(token);
  if (error || !data?.claims?.sub) throw new Error("Sessão inválida.");
  const userId = data.claims.sub;
  if (adminOnly) {
    const { data: roles } = await supabaseAdmin.from("user_roles").select("role").eq("user_id", userId);
    if (!(roles ?? []).some((r) => r.role === "admin")) throw new Error("Acesso restrito a administradores.");
  }
  return userId;
}

const buttonSchema = z.object({
  type: z.enum(["QUICK_REPLY", "URL", "PHONE_NUMBER"]),
  text: z.string().min(1).max(25),
  url: z.string().url().optional(),
  phone_number: z.string().optional(),
});

const createSchema = z.object({
  action: z.literal("create"),
  accountId: z.string().uuid(),
  name: z.string().regex(/^[a-z0-9_]+$/, "Use minúsculas, números e _").min(1).max(60),
  language: z.string().min(2).max(10),
  category: z.enum(["MARKETING", "UTILITY", "AUTHENTICATION"]),
  headerText: z.string().max(60).optional(),
  body: z.string().min(1).max(1024),
  footer: z.string().max(60).optional(),
  buttons: z.array(buttonSchema).max(3).optional(),
  bodyExamples: z.array(z.string()).optional(),
});
const updateSchema = z.object({
  action: z.literal("update"),
  templateId: z.string().uuid(),
  headerText: z.string().max(60).optional(),
  body: z.string().min(1).max(1024),
  footer: z.string().max(60).optional(),
  buttons: z.array(buttonSchema).max(3).optional(),
  bodyExamples: z.array(z.string()).optional(),
});
const deleteSchema = z.object({ action: z.literal("delete"), templateId: z.string().uuid() });
const postSchema = z.union([createSchema, updateSchema, deleteSchema]);

function buildComponents(input: {
  headerText?: string; body: string; footer?: string;
  buttons?: Array<{ type: "QUICK_REPLY" | "URL" | "PHONE_NUMBER"; text: string; url?: string; phone_number?: string }>;
  bodyExamples?: string[];
}): TemplateComponent[] {
  const out: TemplateComponent[] = [];
  if (input.headerText) out.push({ type: "HEADER", format: "TEXT", text: input.headerText });
  const bodyComp: TemplateComponent = { type: "BODY", text: input.body };
  if (input.bodyExamples?.length) bodyComp.example = { body_text: [input.bodyExamples] };
  out.push(bodyComp);
  if (input.footer) out.push({ type: "FOOTER", text: input.footer });
  if (input.buttons?.length) out.push({ type: "BUTTONS", buttons: input.buttons });
  return out;
}

export async function handleGet(request: Request) {
  try {
    await requireAuth(request);
    const url = new URL(request.url);
    const accountId = url.searchParams.get("accountId");
    let q = supabaseAdmin.from("whatsapp_cloud_templates").select("*").order("updated_at", { ascending: false });
    if (accountId) q = q.eq("account_id", accountId);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return json({ templates: data ?? [] });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}

export async function handlePost(request: Request) {
  try {
    const userId = await requireAuth(request, true);
    const body = postSchema.parse(await request.json());
    if (body.action === "create") {
      const { data: acc } = await supabaseAdmin.from("whatsapp_cloud_accounts").select("*").eq("id", body.accountId).maybeSingle();
      if (!acc) throw new Error("Conta não encontrada.");
      const components = buildComponents(body);
      const r = await createTemplate(acc.waba_id, acc.access_token, { name: body.name, language: body.language, category: body.category, components });
      const variables = (body.body.match(/\{\{\s*\d+\s*\}\}/g) ?? []).length;
      const { data, error } = await supabaseAdmin.from("whatsapp_cloud_templates").upsert({
        account_id: body.accountId, meta_template_id: r.id, name: body.name, language: body.language, category: body.category,
        status: r.status, components: components as unknown as never, variables_count: variables,
        last_synced_at: new Date().toISOString(), created_by: userId,
      }, { onConflict: "account_id,name,language" }).select().single();
      if (error) throw new Error(error.message);
      return json({ template: data });
    }
    if (body.action === "update") {
      const { data: tpl } = await supabaseAdmin.from("whatsapp_cloud_templates").select("*, whatsapp_cloud_accounts!inner(*)").eq("id", body.templateId).maybeSingle();
      if (!tpl || !tpl.meta_template_id) throw new Error("Template não encontrado ou não sincronizado.");
      const acc = (tpl as unknown as { whatsapp_cloud_accounts: { access_token: string } }).whatsapp_cloud_accounts;
      const components = buildComponents(body);
      await updateTemplate(tpl.meta_template_id, acc.access_token, components);
      const variables = (body.body.match(/\{\{\s*\d+\s*\}\}/g) ?? []).length;
      await supabaseAdmin.from("whatsapp_cloud_templates").update({
        components: components as unknown as never, variables_count: variables, status: "PENDING", last_synced_at: new Date().toISOString(),
      }).eq("id", body.templateId);
      return json({ ok: true });
    }
    if (body.action === "delete") {
      const { data: tpl } = await supabaseAdmin.from("whatsapp_cloud_templates").select("*, whatsapp_cloud_accounts!inner(waba_id, access_token)").eq("id", body.templateId).maybeSingle();
      if (!tpl) throw new Error("Template não encontrado.");
      const acc = (tpl as unknown as { whatsapp_cloud_accounts: { waba_id: string; access_token: string } }).whatsapp_cloud_accounts;
      await deleteTemplate(acc.waba_id, acc.access_token, tpl.name, tpl.meta_template_id ?? undefined);
      await supabaseAdmin.from("whatsapp_cloud_templates").delete().eq("id", body.templateId);
      return json({ ok: true });
    }
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.issues.map((i) => i.message).join("; ") : (e instanceof Error ? e.message : String(e));
    return json({ error: msg }, 500);
  }
}