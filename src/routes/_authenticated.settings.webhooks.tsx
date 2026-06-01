import { createFileRoute } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Webhook } from "lucide-react";

export const Route = createFileRoute("/_authenticated/settings/webhooks")({
  head: () => ({ meta: [{ title: "Webhooks — Lívia CRM" }] }),
  component: WebhooksPage,
});

function WebhooksPage() {
  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-3xl space-y-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Webhook className="h-6 w-6" /> Webhooks externos
          </h1>
          <p className="text-sm text-muted-foreground">
            Envie eventos do sistema para CRMs e automações (Zapier, RD, ActiveCampaign…).
          </p>
        </div>
        <Card className="p-6 text-sm text-muted-foreground">
          Módulo em construção. A infraestrutura já está pronta (tabelas <code className="font-mono">webhook_endpoints</code> e <code className="font-mono">webhook_deliveries</code>). UI de cadastro vem no próximo passo.
        </Card>
      </div>
    </div>
  );
}