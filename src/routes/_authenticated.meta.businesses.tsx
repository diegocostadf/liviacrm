import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/meta/coming-soon";

export const Route = createFileRoute("/_authenticated/meta/businesses")({
  component: () => <ComingSoon title="Contas Comerciais" subtitle="Gestão dos Business Portfolios conectados." />,
});