import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/meta/")({
  beforeLoad: () => {
    throw redirect({ to: "/meta/overview" });
  },
});