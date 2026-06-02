import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/connections")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/connections" });
  },
});