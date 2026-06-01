import { createFileRoute } from "@tanstack/react-router";
import { Route as KnowledgeRoute } from "./_authenticated.knowledge";

export const Route = createFileRoute("/_authenticated/settings/knowledge")({
  head: () => ({ meta: [{ title: "Base de Conhecimento — Lívia CRM" }] }),
  component: KnowledgeRoute.options.component!,
});