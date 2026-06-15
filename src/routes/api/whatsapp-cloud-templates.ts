import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/whatsapp-cloud-templates")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { handleGet } = await import("./-whatsapp-cloud-templates.server");
        return handleGet(request);
      },
      POST: async ({ request }) => {
        const { handlePost } = await import("./-whatsapp-cloud-templates.server");
        return handlePost(request);
      },
    },
  },
});