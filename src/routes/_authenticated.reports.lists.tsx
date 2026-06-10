import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Download, Save, Trash2, Eye } from "lucide-react";
import { toast } from "sonner";
import {
  previewContactFilter, listSavedLists, saveList, deleteSavedList,
  exportContactsList, type ContactFilters,
} from "@/lib/reports.functions";

export const Route = createFileRoute("/_authenticated/reports/lists")({
  component: ListsPage,
});

const STATUS_OPTS = ["novo", "engajado", "inscrito", "perdido"] as const;
const TEMP_OPTS = ["quente", "morno", "frio"] as const;

function downloadBase64(filename: string, mime: string, b64: string) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function ListsPage() {
  const qc = useQueryClient();
  const fetchLists = useServerFn(listSavedLists);
  const fetchPreview = useServerFn(previewContactFilter);
  const saveFn = useServerFn(saveList);
  const delFn = useServerFn(deleteSavedList);
  const exportFn = useServerFn(exportContactsList);

  const [filters, setFilters] = useState<ContactFilters>({});
  const [tagInput, setTagInput] = useState("");
  const [saveOpen, setSaveOpen] = useState(false);
  const [listName, setListName] = useState("");
  const [listDesc, setListDesc] = useState("");
  const [shared, setShared] = useState(false);

  const lists = useQuery({ queryKey: ["saved-lists"], queryFn: () => fetchLists() });

  const preview = useQuery({
    queryKey: ["filter-preview", filters],
    queryFn: () => fetchPreview({ data: { filters, limit: 50 } }),
  });

  const saveMut = useMutation({
    mutationFn: () => saveFn({ data: { name: listName, description: listDesc, filters, shared } }),
    onSuccess: () => { toast.success("Lista salva"); setSaveOpen(false); setListName(""); setListDesc(""); qc.invalidateQueries({ queryKey: ["saved-lists"] }); },
    onError: (e: any) => toast.error(e.message ?? "Erro ao salvar"),
  });

  const exportMut = useMutation({
    mutationFn: (format: "csv" | "xlsx") => exportFn({ data: { filters, format } }),
    onSuccess: (r) => { downloadBase64(r.filename, r.mime, r.data); toast.success(`${r.count} contatos exportados`); },
    onError: (e: any) => toast.error(e.message ?? "Erro ao exportar"),
  });

  function update<K extends keyof ContactFilters>(k: K, v: ContactFilters[K]) {
    setFilters((f) => ({ ...f, [k]: v }));
  }

  function toggleArray<T extends string>(key: keyof ContactFilters, value: T) {
    setFilters((f) => {
      const cur = (f[key] as T[] | undefined) ?? [];
      const next = cur.includes(value) ? cur.filter((x) => x !== value) : [...cur, value];
      return { ...f, [key]: next.length ? next : undefined };
    });
  }

  function addTag() {
    const t = tagInput.trim();
    if (!t) return;
    update("tags", [...(filters.tags ?? []), t]);
    setTagInput("");
  }

  function loadList(f: ContactFilters) { setFilters(f ?? {}); }

  const summary = useMemo(() => `${preview.data?.total ?? 0} contatos correspondem`, [preview.data]);

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
      <Card className="p-4 space-y-4">
        <div>
          <h2 className="text-sm font-semibold">Filtros</h2>
          <p className="text-xs text-muted-foreground">Combine critérios e salve como lista reutilizável.</p>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Busca</Label>
          <Input value={filters.search ?? ""} placeholder="nome, telefone, email, empresa..." onChange={(e) => update("search", e.target.value || undefined)} />
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Status do lead</Label>
          <div className="flex flex-wrap gap-1">
            {STATUS_OPTS.map((s) => {
              const on = filters.lead_status?.includes(s);
              return <Badge key={s} variant={on ? "default" : "outline"} className="cursor-pointer capitalize" onClick={() => toggleArray("lead_status", s)}>{s}</Badge>;
            })}
          </div>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Temperatura</Label>
          <div className="flex flex-wrap gap-1">
            {TEMP_OPTS.map((s) => {
              const on = filters.temperature?.includes(s);
              return <Badge key={s} variant={on ? "default" : "outline"} className="cursor-pointer capitalize" onClick={() => toggleArray("temperature", s)}>{s}</Badge>;
            })}
          </div>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Tags</Label>
          <div className="flex gap-1">
            <Input value={tagInput} onChange={(e) => setTagInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addTag())} placeholder="adicionar tag" />
            <Button type="button" variant="outline" onClick={addTag}>+</Button>
          </div>
          <div className="flex flex-wrap gap-1 pt-1">
            {(filters.tags ?? []).map((t) => (
              <Badge key={t} variant="secondary" className="cursor-pointer" onClick={() => update("tags", (filters.tags ?? []).filter((x) => x !== t))}>{t} ×</Badge>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Cidade</Label>
            <Input value={filters.city ?? ""} onChange={(e) => update("city", e.target.value || undefined)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">UF</Label>
            <Input value={filters.state ?? ""} onChange={(e) => update("state", e.target.value || undefined)} />
          </div>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Fonte</Label>
          <Input value={filters.source ?? ""} onChange={(e) => update("source", e.target.value || undefined)} />
        </div>

        <div className="flex items-center justify-between">
          <Label className="text-xs">Opt-out</Label>
          <Select value={filters.opted_out === undefined ? "all" : filters.opted_out ? "yes" : "no"} onValueChange={(v) => update("opted_out", v === "all" ? undefined : v === "yes")}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="no">Apenas ativos</SelectItem>
              <SelectItem value="yes">Apenas opt-out</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Criado após</Label>
            <Input type="date" value={(filters.created_after ?? "").slice(0, 10)} onChange={(e) => update("created_after", e.target.value ? new Date(e.target.value).toISOString() : undefined)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Criado antes</Label>
            <Input type="date" value={(filters.created_before ?? "").slice(0, 10)} onChange={(e) => update("created_before", e.target.value ? new Date(e.target.value).toISOString() : undefined)} />
          </div>
        </div>

        <div className="flex flex-wrap gap-2 pt-2">
          <Button size="sm" variant="outline" onClick={() => setFilters({})}>Limpar</Button>
          <Button size="sm" onClick={() => setSaveOpen(true)}><Save className="h-3.5 w-3.5 mr-1" />Salvar lista</Button>
        </div>
      </Card>

      <div className="space-y-4">
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold">Resultado</h2>
              <p className="text-xs text-muted-foreground">{preview.isLoading ? "Calculando..." : summary}</p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => exportMut.mutate("csv")} disabled={exportMut.isPending}>
                <Download className="h-3.5 w-3.5 mr-1" />CSV
              </Button>
              <Button size="sm" onClick={() => exportMut.mutate("xlsx")} disabled={exportMut.isPending}>
                <Download className="h-3.5 w-3.5 mr-1" />Excel
              </Button>
            </div>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground">
                <tr><th className="py-2">Nome</th><th>Telefone</th><th>Cidade</th><th>Status</th><th>Tags</th></tr>
              </thead>
              <tbody>
                {(preview.data?.rows ?? []).slice(0, 50).map((r: any) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="py-2">{r.name ?? "—"}</td>
                    <td className="text-xs">{r.phone}</td>
                    <td className="text-xs text-muted-foreground">{r.city ?? "—"}</td>
                    <td className="text-xs">{r.lead_status}</td>
                    <td className="text-xs">{(r.tags ?? []).join(", ")}</td>
                  </tr>
                ))}
                {!preview.data?.rows.length && !preview.isLoading && (
                  <tr><td colSpan={5} className="py-6 text-center text-xs text-muted-foreground">Nenhum contato.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {(preview.data?.total ?? 0) > 50 && (
            <p className="mt-2 text-xs text-muted-foreground">Mostrando 50 de {preview.data?.total}. Exporte para ver todos.</p>
          )}
        </Card>

        <Card className="p-4">
          <h2 className="text-sm font-semibold mb-3">Listas salvas</h2>
          <div className="space-y-2">
            {(lists.data?.rows ?? []).map((l: any) => (
              <div key={l.id} className="flex items-center justify-between rounded-md border border-border p-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{l.name}</span>
                    {l.shared && <Badge variant="outline" className="text-[10px]">compartilhada</Badge>}
                  </div>
                  {l.description && <div className="text-xs text-muted-foreground truncate">{l.description}</div>}
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => loadList(l.filters)}><Eye className="h-3.5 w-3.5 mr-1" />Carregar</Button>
                  {l.mine && (
                    <Button size="sm" variant="ghost" onClick={async () => { if (confirm("Excluir esta lista?")) { await delFn({ data: { id: l.id } }); qc.invalidateQueries({ queryKey: ["saved-lists"] }); } }}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
            {!lists.data?.rows.length && <p className="text-xs text-muted-foreground">Nenhuma lista salva ainda.</p>}
          </div>
        </Card>
      </div>

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Salvar lista personalizada</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Nome</Label>
              <Input value={listName} onChange={(e) => setListName(e.target.value)} placeholder="ex.: Leads quentes SP" />
            </div>
            <div className="space-y-1">
              <Label>Descrição (opcional)</Label>
              <Input value={listDesc} onChange={(e) => setListDesc(e.target.value)} />
            </div>
            <div className="flex items-center justify-between">
              <Label>Compartilhar com a equipe</Label>
              <Switch checked={shared} onCheckedChange={setShared} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveOpen(false)}>Cancelar</Button>
            <Button onClick={() => saveMut.mutate()} disabled={!listName.trim() || saveMut.isPending}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}