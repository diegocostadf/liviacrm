import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/messaging-provider")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { handleGet } = await import("./-messaging-provider.server");
        return handleGet(request);
      },
      POST: async ({ request }) => {
        const { handlePost } = await import("./-messaging-provider.server");
        return handlePost(request);
      },
    },
  },
});