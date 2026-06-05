import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/twilio-settings")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { handleGet } = await import("./-twilio-settings.server");
        return handleGet(request);
      },
      POST: async ({ request }) => {
        const { handlePost } = await import("./-twilio-settings.server");
        return handlePost(request);
      },
    },
  },
});