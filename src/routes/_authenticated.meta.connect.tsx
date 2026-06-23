import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { completeEmbeddedSignup, getMetaPublicConfig } from "@/lib/meta.functions";
import { EmbeddedSignupButton } from "@/components/meta/embedded-signup-button";
import { Card } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/meta/connect")({
  component: ConnectPage,
});

function ConnectPage() {
  const navigate = useNavigate();
  const fetchConfig = useServerFn(getMetaPublicConfig);
  const signupFn = useServerFn(completeEmbeddedSignup);
  const { data, isLoading, error } = useQuery({
    queryKey: ["meta-public-config"],
    queryFn: () => fetchConfig(),
    staleTime: 5 * 60_000,
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-8">
      <div>
        <h1 className="text-2xl font-semibold">Conectar WhatsApp</h1>
        <p className="text-sm text-muted-foreground">
          Fluxo oficial Embedded Signup da Meta. Você escolhe (ou cria) o Business, seleciona o WABA e o número.
        </p>
      </div>

      {isLoading ? (
        <Card className="flex items-center gap-2 p-6 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando configuração…
        </Card>
      ) : error ? (
        <Alert variant="destructive">
          <AlertTitle>Erro</AlertTitle>
          <AlertDescription>{(error as Error).message}</AlertDescription>
        </Alert>
      ) : !data?.appId || !data?.configId ? (
        <Alert>
          <AlertTitle>Configuração incompleta</AlertTitle>
          <AlertDescription>
            Defina <code>META_APP_ID</code> e <code>META_LOGIN_CONFIG_ID</code> (Solution ID) nos
            secrets do projeto.
          </AlertDescription>
        </Alert>
      ) : (
        <Card className="space-y-5 p-6">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 text-primary" />
            <div className="text-sm text-muted-foreground">
              Ao clicar, uma janela do Facebook abrirá para você logar com seu administrador da Meta
              e selecionar a WABA. Nenhum dado sensível é armazenado em texto plano — todos os
              tokens ficam criptografados (AES-256-GCM).
            </div>
          </div>
          <div>
            <EmbeddedSignupButton
              appId={data.appId}
              configId={data.configId}
              graphVersion={data.graphVersion}
              onComplete={async ({ code, signupInfo }) => {
                try {
                  const result = await signupFn({ data: { code, signupInfo } });
                  toast.success(
                    `Conectado! ${result.phones} número(s) sincronizado(s). Webhook: ${result.subscribed ? "OK" : "pendente"}.`,
                  );
                  navigate({ to: "/meta/overview" });
                } catch (err) {
                  toast.error((err as Error).message);
                }
              }}
            />
          </div>
        </Card>
      )}
    </div>
  );
}