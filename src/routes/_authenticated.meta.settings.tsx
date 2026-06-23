import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/meta/coming-soon";

export const Route = createFileRoute("/_authenticated/meta/settings")({
  component: () => <ComingSoon title="Configurações" subtitle="Sandbox, IA por tenant, permissões." />,
});