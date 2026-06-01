import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/connections")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { handleGet } = await import("./connections.server");
        return handleGet(request);
      },
      POST: async ({ request }) => {
        const { handlePost } = await import("./connections.server");
        return handlePost(request);
      },
    },
  },
});