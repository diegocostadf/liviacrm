import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { embed } from "./ai.server";

// Naive chunker: ~800 chars per chunk, ~100 chars overlap, split on paragraphs when possible.
export function chunkText(text: string, target = 800, overlap = 100): string[] {
  const clean = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (clean.length <= target) return [clean];
  const paragraphs = clean.split(/\n\n+/);
  const chunks: string[] = [];
  let buf = "";
  for (const p of paragraphs) {
    if ((buf + "\n\n" + p).length > target && buf) {
      chunks.push(buf.trim());
      buf = buf.slice(Math.max(0, buf.length - overlap)) + "\n\n" + p;
    } else {
      buf = buf ? buf + "\n\n" + p : p;
    }
  }
  if (buf.trim()) chunks.push(buf.trim());
  // Hard-split any chunk still over 2x target
  const out: string[] = [];
  for (const c of chunks) {
    if (c.length <= target * 2) { out.push(c); continue; }
    for (let i = 0; i < c.length; i += target - overlap) {
      out.push(c.slice(i, i + target));
    }
  }
  return out.filter((c) => c.trim().length > 0);
}

export async function processDocument(documentId: string, fullText: string) {
  try {
    const chunks = chunkText(fullText);
    if (chunks.length === 0) {
      await supabaseAdmin
        .from("knowledge_documents")
        .update({ status: "error", error: "Documento vazio" })
        .eq("id", documentId);
      return;
    }
    // Embed in batches of 50 to stay safe
    const BATCH = 50;
    let ord = 0;
    for (let i = 0; i < chunks.length; i += BATCH) {
      const slice = chunks.slice(i, i + BATCH);
      const embeddings = await embed(slice, 1536);
      const rows = slice.map((content, j) => ({
        document_id: documentId,
        ord: ord + j,
        content,
        token_count: Math.ceil(content.length / 4),
        embedding: embeddings[j] as unknown as string, // pgvector accepts JSON array
      }));
      const { error } = await supabaseAdmin.from("knowledge_chunks").insert(rows);
      if (error) throw new Error(error.message);
      ord += slice.length;
    }
    await supabaseAdmin
      .from("knowledge_documents")
      .update({ status: "ready", error: null })
      .eq("id", documentId);
  } catch (e) {
    console.error("[processDocument]", e);
    await supabaseAdmin
      .from("knowledge_documents")
      .update({ status: "error", error: e instanceof Error ? e.message : String(e) })
      .eq("id", documentId);
  }
}

export async function searchKnowledge(query: string, k = 5) {
  const [embedding] = await embed(query, 1536);
  const { data, error } = await supabaseAdmin.rpc("match_knowledge_chunks", {
    query_embedding: embedding as unknown as string,
    match_count: k,
  });
  if (error) {
    console.error("[searchKnowledge]", error);
    return [];
  }
  return (data ?? []) as Array<{ id: string; document_id: string; content: string; similarity: number }>;
}