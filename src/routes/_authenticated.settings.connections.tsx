import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/settings/connections")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/whatsapp-cloud", replace: true });
  },
  component: () => null,
});
