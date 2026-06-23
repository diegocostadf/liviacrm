import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/meta/coming-soon";

export const Route = createFileRoute("/_authenticated/meta/templates")({
  component: () => <ComingSoon title="Templates" subtitle="Sincronização, criação e edição de templates HSM." />,
});