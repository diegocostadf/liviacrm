import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Loader2, Trash2, RefreshCw, Search, FileText, Upload, Check, X, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";
import { listDocuments, createTextDocument, reprocessDocument, deleteDocument, testSearch, getDocument, updateDocument } from "@/lib/knowledge.functions";

export function KnowledgePage() {
  const list = useServerFn(listDocuments);
  const create = useServerFn(createTextDocument);
  const reproc = useServerFn(reprocessDocument);
  const del = useServerFn(deleteDocument);
  const search = useServerFn(testSearch);
  const fetchDoc = useServerFn(getDocument);
  const update = useServerFn(updateDocument);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["kb-docs"],
    queryFn: () => list(),
    refetchInterval: 4000,
  });

  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Array<{ id: string; content: string; similarity: number }>>([]);
  const [editing, setEditing] = useState<{ id: string; name: string; text: string } | null>(null);
  const [editLoading, setEditLoading] = useState(false);

  const createMut = useMutation({
    mutationFn: () => create({ data: { name: name.trim(), text: text.trim() } }),
    onSuccess: () => {
      toast.success("Documento adicionado.");
      setName(""); setText("");
      qc.invalidateQueries({ queryKey: ["kb-docs"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao salvar."),
  });

  const reprocMut = useMutation({
    mutationFn: (id: string) => reproc({ data: { id } }),
    onSuccess: () => { toast.success("Reprocessando…"); qc.invalidateQueries({ queryKey: ["kb-docs"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro."),
  });

  const delMut = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => { toast.success("Documento removido."); qc.invalidateQueries({ queryKey: ["kb-docs"] }); },
  });

  const updateMut = useMutation({
    mutationFn: () => update({ data: { id: editing!.id, name: editing!.name.trim(), text: editing!.text.trim() } }),
    onSuccess: () => {
      toast.success("Documento atualizado. Reindexando…");
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["kb-docs"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao atualizar."),
  });

  async function openEdit(id: string) {
    setEditLoading(true);
    try {
      const doc = await fetchDoc({ data: { id } });
      setEditing({ id: doc.id, name: doc.name, text: doc.source_text ?? "" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao carregar documento.");
    } finally {
      setEditLoading(false);
    }
  }

  async function onUploadFile(file: File) {
    if (!file) return;
    if (file.size > 800_000) {
      toast.error("Arquivo grande demais (máx 800KB de texto puro). Cole o conteúdo abaixo.");
      return;
    }
    try {
      const text = await file.text();
      setName((n) => n || file.name);
      setText(text);
    } catch {
      toast.error("Não foi possível ler o arquivo como texto.");
    }
  }

  async function runSearch() {
    if (!query.trim()) return;
    try {
      const r = await search({ data: { query: query.trim(), k: 5 } });
      setResults(r.results);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro na busca.");
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden p-6">
      <header className="mb-4">
        <h1 className="text-2xl font-bold">Base de Conhecimento</h1>
        <p className="text-sm text-muted-foreground">
          Documentos que alimentam o bot via busca semântica (RAG). Cole textos longos ou faça upload de .txt/.md.
        </p>
      </header>

      <Tabs defaultValue="docs" className="flex flex-1 flex-col overflow-hidden">
        <TabsList className="self-start">
          <TabsTrigger value="docs">Documentos</TabsTrigger>
          <TabsTrigger value="add">Adicionar</TabsTrigger>
          <TabsTrigger value="search">Testar busca</TabsTrigger>
        </TabsList>

        <TabsContent value="docs" className="flex-1 overflow-auto pt-4">
          {isLoading ? (
            <div className="flex h-32 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : !data?.length ? (
            <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              Nenhum documento ainda. Vá em "Adicionar" para criar o primeiro.
            </div>
          ) : (
            <div className="space-y-2">
              {data.map((d) => (
                <Card key={d.id}>
                  <CardContent className="flex items-center gap-3 p-4">
                    <FileText className="h-5 w-5 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{d.name}</div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{d.chunk_count} chunks</span>
                        <span>·</span>
                        <span>{(d.size_bytes ?? 0).toLocaleString()} bytes</span>
                        <span>·</span>
                        <span>{new Date(d.created_at).toLocaleString()}</span>
                      </div>
                      {d.error && <div className="mt-1 text-xs text-destructive">{d.error}</div>}
                    </div>
                    <StatusBadge status={d.status} />
                    <Button size="icon" variant="ghost" onClick={() => openEdit(d.id)} title="Editar" disabled={editLoading}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => reprocMut.mutate(d.id)} title="Reprocessar">
                      <RefreshCw className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => delMut.mutate(d.id)} title="Excluir">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="add" className="flex-1 overflow-auto pt-4">
          <Card className="max-w-3xl">
            <CardHeader><CardTitle>Novo documento</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Nome</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: FAQ do curso Russomano" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Texto</label>
                <Textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Cole o conteúdo aqui (FAQ, descrição do produto, objeções comuns, persona…)"
                  rows={14}
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border bg-secondary px-3 py-2 text-sm hover:bg-accent">
                  <Upload className="h-4 w-4" />
                  <span>Carregar .txt / .md</span>
                  <input type="file" accept=".txt,.md,text/*" className="hidden"
                    onChange={(e) => e.target.files?.[0] && onUploadFile(e.target.files[0])} />
                </label>
                <div className="ml-auto flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{text.length.toLocaleString()} chars</span>
                  <Button onClick={() => createMut.mutate()} disabled={createMut.isPending || !name.trim() || text.trim().length < 20}>
                    {createMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Adicionar e indexar
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="search" className="flex-1 overflow-auto pt-4">
          <Card className="max-w-3xl">
            <CardHeader><CardTitle>Testar busca semântica</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Input value={query} onChange={(e) => setQuery(e.target.value)}
                  placeholder="Faça uma pergunta como se fosse o lead…"
                  onKeyDown={(e) => e.key === "Enter" && runSearch()} />
                <Button onClick={runSearch}><Search className="mr-2 h-4 w-4" />Buscar</Button>
              </div>
              <div className="space-y-2">
                {results.map((r) => (
                  <div key={r.id} className="rounded-md border border-border bg-card p-3 text-sm">
                    <div className="mb-1 text-xs text-muted-foreground">similaridade {(r.similarity * 100).toFixed(1)}%</div>
                    <div className="whitespace-pre-wrap">{r.content}</div>
                  </div>
                ))}
                {!results.length && <div className="text-xs text-muted-foreground">Resultados aparecem aqui.</div>}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Editar documento</DialogTitle>
            <DialogDescription>
              Ao salvar, os chunks antigos serão removidos e o conteúdo será reindexado.
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Nome</label>
                <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Conteúdo</label>
                <Textarea
                  rows={18}
                  value={editing.text}
                  onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                  className="font-mono text-xs"
                />
                <div className="mt-1 text-[11px] text-muted-foreground">
                  {editing.text.length.toLocaleString()} caracteres
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button>
            <Button
              onClick={() => updateMut.mutate()}
              disabled={updateMut.isPending || !editing || !editing.name.trim() || editing.text.trim().length < 20}
            >
              {updateMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Salvar e reindexar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "ready") return <Badge variant="secondary" className="gap-1"><Check className="h-3 w-3" />pronto</Badge>;
  if (status === "processing") return <Badge variant="secondary" className="gap-1"><Loader2 className="h-3 w-3 animate-spin" />processando</Badge>;
  return <Badge variant="destructive" className="gap-1"><X className="h-3 w-3" />erro</Badge>;
}