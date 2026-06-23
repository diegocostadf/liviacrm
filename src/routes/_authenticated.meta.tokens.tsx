import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/meta/coming-soon";

export const Route = createFileRoute("/_authenticated/meta/tokens")({
  component: () => <ComingSoon title="Tokens" subtitle="Validade, escopos e renovação manual de tokens." />,
});