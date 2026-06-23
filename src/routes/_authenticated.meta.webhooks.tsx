import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/meta/coming-soon";

export const Route = createFileRoute("/_authenticated/meta/webhooks")({
  component: () => <ComingSoon title="Webhooks" subtitle="Status, último evento, reprocessamento e diagnóstico." />,
});