import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/meta/coming-soon";

export const Route = createFileRoute("/_authenticated/meta/numbers")({
  component: () => <ComingSoon title="Números" subtitle="Lista de números, qualidade, limite e registro de novos." />,
});