import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { processDocument, searchKnowledge } from "./knowledge.server";

export const listDocuments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { data, error } = await supabaseAdmin
      .from("knowledge_documents")
      .select("id, name, mime, size_bytes, status, error, created_at, updated_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    // counts of chunks per doc
    const ids = (data ?? []).map((d) => d.id);
    let counts: Record<string, number> = {};
    if (ids.length) {
      const { data: c } = await supabaseAdmin
        .from("knowledge_chunks")
        .select("document_id")
        .in("document_id", ids);
      counts = (c ?? []).reduce<Record<string, number>>((acc, r) => {
        acc[r.document_id] = (acc[r.document_id] ?? 0) + 1;
        return acc;
      }, {});
    }
    return (data ?? []).map((d) => ({ ...d, chunk_count: counts[d.id] ?? 0 }));
  });

const createSchema = z.object({
  name: z.string().min(1).max(200),
  mime: z.string().max(120).optional(),
  text: z.string().min(20).max(500_000),
});

export const createTextDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => createSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { data: doc, error } = await supabaseAdmin
      .from("knowledge_documents")
      .insert({
        name: data.name,
        mime: data.mime ?? "text/plain",
        size_bytes: data.text.length,
        source_text: data.text,
        status: "processing",
        uploaded_by: context.userId,
      })
      .select("id")
      .single();
    if (error || !doc) throw new Error(error?.message ?? "Falha ao criar documento.");
    // Process inline (fast enough for a few hundred KB). Errors are caught inside.
    await processDocument(doc.id, data.text);
    return { id: doc.id };
  });

export const reprocessDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { data: doc } = await supabaseAdmin
      .from("knowledge_documents")
      .select("source_text")
      .eq("id", data.id)
      .maybeSingle();
    if (!doc?.source_text) throw new Error("Texto original não disponível para reprocessar.");
    await supabaseAdmin.from("knowledge_chunks").delete().eq("document_id", data.id);
    await supabaseAdmin.from("knowledge_documents").update({ status: "processing", error: null }).eq("id", data.id);
    await processDocument(data.id, doc.source_text);
    return { ok: true };
  });

export const deleteDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { error } = await supabaseAdmin.from("knowledge_documents").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const testSearch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ query: z.string().min(2).max(500), k: z.number().int().min(1).max(10).default(5) }).parse(d))
  .handler(async ({ data }) => {
    const results = await searchKnowledge(data.query, data.k);
    return { results };
  });