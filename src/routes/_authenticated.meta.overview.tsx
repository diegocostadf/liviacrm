import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMetaOverview, disconnectMetaBusiness } from "@/lib/meta.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, PlugZap, Power, RefreshCw } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/meta/overview")({
  component: MetaOverview,
});

function MetaOverview() {
  const qc = useQueryClient();
  const fetchOverview = useServerFn(getMetaOverview);
  const disconnectFn = useServerFn(disconnectMetaBusiness);
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["meta-overview"],
    queryFn: () => fetchOverview(),
  });

  const disconnect = useMutation({
    mutationFn: (businessId: string) => disconnectFn({ data: { businessId } }),
    onSuccess: () => {
      toast.success("Business desconectado.");
      qc.invalidateQueries({ queryKey: ["meta-overview"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-10 text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando…
      </div>
    );
  }

  if (!data?.connected) {
    return (
      <div className="mx-auto max-w-2xl p-8">
        <Card className="p-8 text-center">
          <PlugZap className="mx-auto mb-4 h-10 w-10 text-muted-foreground" />
          <h2 className="mb-2 text-lg font-semibold">Nenhuma conta Meta conectada</h2>
          <p className="mb-6 text-sm text-muted-foreground">
            Conecte sua conta Meta para começar a enviar mensagens via WhatsApp Business Platform.
          </p>
          <Button asChild size="lg">
            <Link to="/meta/connect">Conectar WhatsApp</Link>
          </Button>
        </Card>
      </div>
    );
  }

  const { business, waba, phone, token } = data;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Visão Geral</h1>
          <p className="text-sm text-muted-foreground">Status da sua integração com a Meta.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
          <Button asChild variant="outline">
            <Link to="/meta/connect">Reconectar</Link>
          </Button>
          {business && (
            <Button
              variant="destructive"
              onClick={() => {
                if (confirm("Desconectar este Business? Tokens serão invalidados.")) {
                  disconnect.mutate(business.id);
                }
              }}
              disabled={disconnect.isPending}
            >
              <Power className="mr-2 h-4 w-4" />
              Desconectar
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card className="p-5">
          <div className="mb-3 text-xs uppercase tracking-wider text-muted-foreground">Business</div>
          <div className="space-y-2">
            <Row label="Nome" value={business?.businessName} />
            <Row label="Business ID" value={business?.metaBusinessId} mono />
            <Row label="Conectado em" value={fmtDate(business?.connectedAt)} />
          </div>
        </Card>

        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">WhatsApp Business Account</span>
            {waba?.subscribed ? (
              <Badge variant="default">Webhook ativo</Badge>
            ) : (
              <Badge variant="secondary">Webhook não inscrito</Badge>
            )}
          </div>
          <div className="space-y-2">
            <Row label="Nome" value={waba?.name ?? "—"} />
            <Row label="WABA ID" value={waba?.wabaId} mono />
          </div>
        </Card>

        <Card className="p-5">
          <div className="mb-3 text-xs uppercase tracking-wider text-muted-foreground">Número</div>
          <div className="space-y-2">
            <Row label="Display Name" value={phone?.verifiedName ?? "—"} />
            <Row label="Número" value={phone?.displayPhoneNumber} mono />
            <Row label="Phone Number ID" value={phone?.phoneNumberId} mono />
            <Row label="Qualidade" value={phone?.qualityRating ?? "—"} />
            <Row label="Limite mensagens" value={phone?.messagingLimit ?? "—"} />
          </div>
        </Card>

        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">Token</span>
            <Badge variant="default">Ativo</Badge>
          </div>
          <div className="space-y-2">
            <Row label="Tipo" value={token?.kind ?? "—"} />
            <Row label="Expira em" value={fmtDate(token?.expiresAt) ?? "Nunca"} />
            <Row label="Último refresh" value={fmtDate(token?.lastRefreshedAt)} />
            <Row label="Escopos" value={token?.scopes?.length ? `${token.scopes.length} permissões` : "—"} />
          </div>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value?: string | null; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className={`truncate text-right ${mono ? "font-mono text-xs" : ""}`}>{value ?? "—"}</span>
    </div>
  );
}

function fmtDate(iso?: string | null) {
  if (!iso) return undefined;
  return new Date(iso).toLocaleString("pt-BR");
}