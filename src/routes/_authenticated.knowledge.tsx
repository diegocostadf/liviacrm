import { createFileRoute } from "@tanstack/react-router";
import { KnowledgePage } from "@/components/knowledge-page";

export const Route = createFileRoute("/_authenticated/knowledge")({
  component: KnowledgePage,
});
