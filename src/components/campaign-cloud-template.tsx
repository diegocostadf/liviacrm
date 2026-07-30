import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, RefreshCcw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { listCloudTemplates } from "@/lib/whatsapp-templates.functions";
import { updateCampaign } from "@/lib/campaigns.functions";

type Tpl = {
  id: string; name: string; language: string; category: string; status: string;
  variables_count: number; components: unknown; last_synced_at: string | null;
};

function bodyText(components: unknown): string {
  const arr = Array.isArray(components) ? (components as Array<Record<string, unknown>>) : [];
  const body = arr.find((c) => c.type === "BODY");
  return typeof body?.text === "string" ? body.text : "";
}

export function CampaignCloudTemplateCard({
  campaignId,
  currentTemplateId,
  currentVariables,
  onSaved,
}: {
  campaignId: string;
  currentTemplateId: string | null;
  currentVariables: Record<string, unknown> | null;
  onSaved?: () => void;
}) {
  const listFn = useServerFn(listCloudTemplates);
  const updateFn = useServerFn(updateCampaign);
  const [selected, setSelected] = useState<string>(currentTemplateId ?? "");
  const [vars, setVars] = useState<Record<string, string>>(
    Object.fromEntries(Object.entries(currentVariables ?? {}).map(([k, v]) => [k, String(v ?? "")])),
  );
  const [saving, setSaving] = useState(false);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["cloud-templates", "approved"],
    queryFn: () => listFn({ data: { approvedOnly: true } }),
    staleTime: 60_000,
  });

  useEffect(() => { setSelected(currentTemplateId ?? ""); }, [currentTemplateId]);

  const templates = (data?.templates ?? []) as Tpl[];
  const tpl = templates.find((t) => t.id === selected);
  const body = tpl ? bodyText(tpl.components) : "";
  const varKeys = useMemo(
    () => Array.from(new Set((body.match(/\{\{\s*(\d+)\s*\}\}/g) ?? []).map((m) => m.replace(/\D/g, "")))),
    [body],
  );
  const rendered = varKeys.reduce(
    (acc, k) => acc.replaceAll(new RegExp(`\\{\\{\\s*${k}\\s*\\}\\}`, "g"), vars[k] || `{{${k}}}`),
    body,
  );

  const save = async () => {
    setSaving(true);
    try {
      await updateFn({
        data: {
          id: campaignId,
          cloud_template_id: selected || null,
          cloud_template_variables: selected ? vars : {},
        },
      });
      toast.success(selected ? "Template vinculado à campanha." : "Template removido da campanha.");
      onSaved?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar template");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4" /> Template aprovado (WhatsApp Cloud)
        </CardTitle>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCcw className="mr-2 h-4 w-4" />}
          Sincronizar
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Fora da janela de 24h a Meta só entrega mensagens com template aprovado. A lista é sincronizada
          automaticamente com a Meta.
        </p>
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : !templates.length ? (
          <p className="text-sm text-muted-foreground">
            Nenhum template aprovado encontrado. Crie e aguarde aprovação em <strong>Configurações → Templates WhatsApp</strong>.
          </p>
        ) : (
          <>
            <div className="space-y-1">
              <Label className="text-xs">Template</Label>
              <Select value={selected || "none"} onValueChange={(v) => setSelected(v === "none" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem template (texto livre)</SelectItem>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name} · {t.language} · {t.category}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {tpl && (
              <div className="space-y-3 rounded-md border border-border bg-muted/20 p-3">
                <div className="flex items-center gap-2">
                  <Badge className="bg-emerald-600">{tpl.status}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {tpl.variables_count} variável(is){tpl.last_synced_at ? ` · sync ${new Date(tpl.last_synced_at).toLocaleString()}` : ""}
                  </span>
                </div>
                {varKeys.map((k) => (
                  <div key={k} className="space-y-1">
                    <Label className="text-xs">{`Variável {{${k}}}`}</Label>
                    <Input
                      value={vars[k] ?? ""}
                      placeholder="Ex.: {{name}} ou texto fixo"
                      onChange={(e) => setVars({ ...vars, [k]: e.target.value })}
                    />
                  </div>
                ))}
                <div className="whitespace-pre-wrap rounded-md bg-background p-3 text-sm">{rendered}</div>
              </div>
            )}
          </>
        )}
        <Button onClick={save} disabled={saving}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Salvar template
        </Button>
      </CardContent>
    </Card>
  );
}
