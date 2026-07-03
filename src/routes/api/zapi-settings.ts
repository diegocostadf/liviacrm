import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/zapi-settings")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { handleGet } = await import("./-zapi-settings.server");
        return handleGet(request);
      },
      POST: async ({ request }) => {
        const { handlePost } = await import("./-zapi-settings.server");
        return handlePost(request);
      },
    },
  },
});