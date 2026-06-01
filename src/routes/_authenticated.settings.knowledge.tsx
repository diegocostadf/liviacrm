import { createFileRoute } from "@tanstack/react-router";
import { KnowledgePage } from "@/components/knowledge-page";

export const Route = createFileRoute("/_authenticated/settings/knowledge")({
  head: () => ({ meta: [{ title: "Base de Conhecimento — Lívia CRM" }] }),
  component: KnowledgePage,
});