import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/whatsapp-cloud-settings")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { handleGet } = await import("./-whatsapp-cloud-settings.server");
        return handleGet(request);
      },
      POST: async ({ request }) => {
        const { handlePost } = await import("./-whatsapp-cloud-settings.server");
        return handlePost(request);
      },
    },
  },
});