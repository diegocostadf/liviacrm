import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { PlugZap, MessageSquare, Smartphone, Settings as SettingsIcon, ArrowRight } from "lucide-react";

type Provider = "evolution" | "twilio";

async function apiCall<T>(method: "GET" | "POST", body?: unknown): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Sessão expirada. Faça login novamente.");
  const res = await fetch("/api/messaging-provider", {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Erro");
  return payload as T;
}

export const Route = createFileRoute("/_authenticated/settings/whatsapp")({
  head: () => ({ meta: [{ title: "WhatsApp — Lívia CRM" }] }),
  component: WhatsappSettingsPage,
});

function WhatsappSettingsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["messaging-provider"],
    queryFn: () => apiCall<{ provider: Provider }>("GET"),
  });
  const provider: Provider = data?.provider ?? "evolution";

  const setProvider = useMutation({
    mutationFn: (p: Provider) => apiCall<{ provider: Provider }>("POST", { provider: p }),
    onSuccess: (r) => {
      toast.success(`Provedor alterado para ${r.provider === "twilio" ? "Twilio" : "Evolution"}`);
      qc.invalidateQueries({ queryKey: ["messaging-provider"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });

  return (
    <div className="h-screen overflow-y-auto p-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">WhatsApp · Provedor de envio</h1>
          <p className="text-sm text-muted-foreground">
            Escolha qual provedor o sistema usará para enviar e receber mensagens de WhatsApp.
          </p>
        </div>

        <Card className="space-y-4 p-5">
          <Label className="text-base font-semibold">Provedor ativo</Label>
          <RadioGroup
            value={provider}
            onValueChange={(v) => setProvider.mutate(v as Provider)}
            className="grid gap-3 md:grid-cols-2"
            disabled={isLoading || setProvider.isPending}
          >
            <ProviderOption
              value="evolution"
              active={provider === "evolution"}
              title="Evolution API"
              desc="Servidor próprio com QR Code multi-instância."
              icon={<PlugZap className="h-5 w-5" />}
            />
            <ProviderOption
              value="twilio"
              active={provider === "twilio"}
              title="Twilio"
              desc="WhatsApp Business e SMS via Twilio API."
              icon={<MessageSquare className="h-5 w-5" />}
            />
          </RadioGroup>
          <p className="text-xs text-muted-foreground">
            A escolha define quais opções de configuração aparecem abaixo. Disparos novos passarão a usar o provedor ativo.
          </p>
        </Card>

        {provider === "evolution" ? <EvolutionLinks /> : <TwilioLinks />}
      </div>
    </div>
  );
}

function ProviderOption({ value, active, title, desc, icon }: {
  value: Provider; active: boolean; title: string; desc: string; icon: React.ReactNode;
}) {
  return (
    <label
      htmlFor={`prov-${value}`}
      className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition ${
        active ? "border-primary bg-accent/40" : "border-border hover:bg-accent/20"
      }`}
    >
      <RadioGroupItem id={`prov-${value}`} value={value} className="mt-1" />
      <div className="flex-1">
        <div className="flex items-center gap-2">
          {icon}
          <span className="font-medium">{title}</span>
          {active && <Badge variant="default">Ativo</Badge>}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{desc}</p>
      </div>
    </label>
  );
}

function NavCard({ to, icon, title, desc }: { to: string; icon: React.ReactNode; title: string; desc: string }) {
  return (
    <Link to={to} className="block">
      <Card className="flex items-center gap-3 p-4 transition hover:bg-accent/40">
        <div className="rounded-md bg-accent/60 p-2 text-accent-foreground">{icon}</div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium">{title}</div>
          <div className="text-xs text-muted-foreground">{desc}</div>
        </div>
        <ArrowRight className="h-4 w-4 text-muted-foreground" />
      </Card>
    </Link>
  );
}

function EvolutionLinks() {
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-muted-foreground">Configurações do Evolution</h2>
      <NavCard
        to="/settings/evolution"
        icon={<SettingsIcon className="h-4 w-4" />}
        title="Credenciais & Webhook"
        desc="URL da API, chave e webhook global do Evolution."
      />
      <NavCard
        to="/settings/connections"
        icon={<Smartphone className="h-4 w-4" />}
        title="Instâncias do WhatsApp"
        desc="Criar instâncias, escanear QR Code e gerenciar conexões."
      />
      <p className="text-xs text-muted-foreground">
        As instâncias só fazem sentido quando o provedor ativo é Evolution.
      </p>
    </div>
  );
}

function TwilioLinks() {
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-muted-foreground">Configurações do Twilio</h2>
      <NavCard
        to="/settings/twilio"
        icon={<MessageSquare className="h-4 w-4" />}
        title="Credenciais Twilio"
        desc="Account SID, Auth Token / API Key, números e webhook."
      />
      <Card className="p-4 text-xs text-muted-foreground">
        Twilio não usa instâncias com QR Code. As mensagens são enviadas pelo número ou Messaging Service configurados.
      </Card>
      <div className="flex justify-end">
        <Button asChild variant="outline" size="sm">
          <Link to="/settings/twilio">Abrir configurações Twilio</Link>
        </Button>
      </div>
    </div>
  );
}