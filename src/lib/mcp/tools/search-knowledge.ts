import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { fail, json, ok } from "../supabase";

export default defineTool({
  name: "search_knowledge",
  title: "Buscar na base de conhecimento",
  description:
    "Busca semântica nos documentos da base de conhecimento do CRM e retorna os trechos mais relevantes.",
  inputSchema: {
    query: z.string().trim().min(2),
    limit: z.number().int().min(1).max(10).default(5),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) return fail("Não autenticado.");
    try {
      const { searchKnowledge } = await import("@/lib/knowledge.server");
      const chunks = await searchKnowledge(input.query, input.limit);
      return ok(json(chunks), { chunks });
    } catch (e) {
      return fail(e instanceof Error ? e.message : "Falha na busca.");
    }
  },
});