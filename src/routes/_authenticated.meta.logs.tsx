import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listMetaLogs } from "@/lib/meta.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/meta/logs")({
  component: LogsPage,
});

function LogsPage() {
  const fetchLogs = useServerFn(listMetaLogs);
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["meta-logs"],
    queryFn: () => fetchLogs(),
  });

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Logs</h1>
          <p className="text-sm text-muted-foreground">Últimas 100 operações do Meta Connector.</p>
        </div>
        <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </div>
      <Card className="divide-y divide-border">
        {isLoading ? (
          <div className="flex items-center gap-2 p-6 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
          </div>
        ) : !data?.length ? (
          <div className="p-6 text-sm text-muted-foreground">Nenhum log ainda.</div>
        ) : (
          data.map((log) => (
            <div key={log.id} className="flex items-start gap-3 p-4 text-sm">
              <Badge variant={log.level === "error" ? "destructive" : log.level === "warn" ? "secondary" : "default"}>
                {log.level}
              </Badge>
              <div className="flex-1">
                <div className="font-medium">{log.kind}</div>
                <div className="text-muted-foreground">{log.message}</div>
              </div>
              <div className="shrink-0 text-xs text-muted-foreground">
                {new Date(log.created_at).toLocaleString("pt-BR")}
              </div>
            </div>
          ))
        )}
      </Card>
    </div>
  );
}