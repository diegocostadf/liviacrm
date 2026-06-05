import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Users, UserPlus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  previewCrmFilter, addCampaignTargetsFromCrm, listCrmFacets,
} from "@/lib/campaigns.functions";

type Filter = {
  search?: string;
  lead_status?: "novo" | "engajado" | "inscrito" | "perdido";
  temperature?: "frio" | "morno" | "quente";
  tags_any?: string[];
  states?: string[];
  cities?: string[];
  source?: string;
  exclude_opted_out: boolean;
  exclude_journey_completed: boolean;
  has_email?: boolean;
};

export function CampaignCrmPicker({ campaignId }: { campaignId: string }) {
  const qc = useQueryClient();
  const previewFn = useServerFn(previewCrmFilter);
  const addFn = useServerFn(addCampaignTargetsFromCrm);
  const facetsFn = useServerFn(listCrmFacets);

  const [search, setSearch] = useState("");
  const [leadStatus, setLeadStatus] = useState<string>("all");
  const [temperature, setTemperature] = useState<string>("all");
  const [selStates, setSelStates] = useState<string[]>([]);
  const [selCities, setSelCities] = useState<string[]>([]);
  const [selTags, setSelTags] = useState<string[]>([]);
  const [source, setSource] = useState("");
  const [excludeOptOut, setExcludeOptOut] = useState(true);
  const [excludeJourney, setExcludeJourney] = useState(false);
  const [hasEmail, setHasEmail] = useState<string>("any");
  const [maxAdd, setMaxAdd] = useState<string>("");
  const [initialIntent, setInitialIntent] = useState<
    "interessado" | "inscrito" | "objecao" | "sem_interesse" | "silencio" | "fora_escopo" | "lead_quente"
  >("silencio");
  const [overwriteIntent, setOverwriteIntent] = useState(false);
  const [adding, setAdding] = useState(false);
  const [cityQuery, setCityQuery] = useState("");
  const [tagQuery, setTagQuery] = useState("");

  const filter: Filter = useMemo(() => ({
    search: search.trim() || undefined,
    lead_status: leadStatus !== "all" ? (leadStatus as Filter["lead_status"]) : undefined,
    temperature: temperature !== "all" ? (temperature as Filter["temperature"]) : undefined,
    tags_any: selTags.length ? selTags : undefined,
    states: selStates.length ? selStates : undefined,
    cities: selCities.length ? selCities : undefined,
    source: source.trim() || undefined,
    has_email: hasEmail === "any" ? undefined : hasEmail === "yes",
    exclude_opted_out: excludeOptOut,
    exclude_journey_completed: excludeJourney,
  }), [search, leadStatus, temperature, selTags, selStates, selCities, source, hasEmail, excludeOptOut, excludeJourney]);

  const { data: facets } = useQuery({
    queryKey: ["crm-facets"],
    queryFn: () => facetsFn(),
    staleTime: 60_000,
  });

  const { data: preview, isFetching } = useQuery({
    queryKey: ["crm-preview", campaignId, filter],
    queryFn: () => previewFn({ data: { campaignId, filter } }),
    staleTime: 5_000,
  });

  const stateOptions = facets?.states ?? [];
  const cityOptions = (facets?.cities ?? []).filter((c) => {
    if (selStates.length && (!c.uf || !selStates.includes(c.uf))) return false;
    if (cityQuery.trim()) return c.name.toLowerCase().includes(cityQuery.trim().toLowerCase());
    return true;
  });
  const tagOptions = (facets?.tags ?? []).filter((t) =>
    tagQuery.trim() ? t.name.toLowerCase().includes(tagQuery.trim().toLowerCase()) : true,
  );

  function toggle(list: string[], v: string, setter: (l: string[]) => void) {
    const i = list.indexOf(v);
    if (i >= 0) setter(list.filter((_, idx) => idx !== i));
    else setter([...list, v]);
  }

  async function doAdd() {
    if (!preview || preview.total === 0) {
      toast.error("Nenhum lead atende aos filtros.");
      return;
    }
    setAdding(true);
    try {
      const r = await addFn({
        data: {
          campaignId,
          filter,
          initial_intent: initialIntent,
          overwrite_intent: overwriteIntent,
          max: maxAdd ? Number(maxAdd) : undefined,
        },
      });
      toast.success(`${r.inserted} novo(s) destinatário(s) adicionados (de ${r.matched} elegíveis)`);
      qc.invalidateQueries({ queryKey: ["campaign", campaignId] });
      qc.invalidateQueries({ queryKey: ["crm-preview", campaignId] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setAdding(false);
    }
  }

  function clearAll() {
    setSearch(""); setLeadStatus("all"); setTemperature("all");
    setSelStates([]); setSelCities([]); setSelTags([]);
    setSource(""); setExcludeOptOut(true); setExcludeJourney(false);
    setHasEmail("any"); setMaxAdd("");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Users className="h-4 w-4" /> Selecionar leads do CRM
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Monte o público a partir dos contatos já cadastrados. Filtros são combinados (AND); listas múltiplas (estados/cidades/tags) usam OR.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Busca + status + temperatura */}
        <div className="grid gap-3 md:grid-cols-3">
          <div className="relative md:col-span-3">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Buscar por nome, telefone, e-mail, empresa, cidade…"
              value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Status do lead</Label>
            <Select value={leadStatus} onValueChange={setLeadStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="novo">Novo</SelectItem>
                <SelectItem value="engajado">Engajado</SelectItem>
                <SelectItem value="inscrito">Inscrito</SelectItem>
                <SelectItem value="perdido">Perdido</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Temperatura</Label>
            <Select value={temperature} onValueChange={setTemperature}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                <SelectItem value="quente">Quente</SelectItem>
                <SelectItem value="morno">Morno</SelectItem>
                <SelectItem value="frio">Frio</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Possui e-mail</Label>
            <Select value={hasEmail} onValueChange={setHasEmail}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Qualquer</SelectItem>
                <SelectItem value="yes">Com e-mail</SelectItem>
                <SelectItem value="no">Sem e-mail</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <Label className="text-xs">Origem / source</Label>
            <Input placeholder="ex.: campaign_import, landing_page, manual"
              value={source} onChange={(e) => setSource(e.target.value)} />
          </div>
          <div className="flex items-end gap-4">
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={excludeOptOut} onChange={(e) => setExcludeOptOut(e.target.checked)} />
              Excluir opt-outs
            </label>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={excludeJourney} onChange={(e) => setExcludeJourney(e.target.checked)} />
              Excluir já concluídos
            </label>
          </div>
        </div>

        {/* Estados */}
        <div className="rounded-md border border-border bg-muted/20 p-3">
          <div className="mb-1 flex items-center justify-between">
            <Label className="text-xs font-medium">Estados {stateOptions.length > 0 && `(${stateOptions.length})`}</Label>
            {selStates.length > 0 && (
              <button className="text-[10px] text-muted-foreground underline" onClick={() => setSelStates([])}>limpar</button>
            )}
          </div>
          <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
            {stateOptions.length === 0 && <span className="text-[11px] text-muted-foreground">Carregando…</span>}
            {stateOptions.map((s) => {
              const active = selStates.includes(s.uf);
              return (
                <button key={s.uf} type="button" onClick={() => toggle(selStates, s.uf, setSelStates)}
                  className={`rounded-md border px-2 py-0.5 text-[11px] ${active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground"}`}>
                  {s.uf} <span className="opacity-70">· {s.count}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Cidades */}
        <div className="rounded-md border border-border bg-muted/20 p-3">
          <div className="mb-1 flex items-center justify-between">
            <Label className="text-xs font-medium">
              Cidades {selStates.length > 0 && "(restritas às UF selecionadas)"}
            </Label>
            {selCities.length > 0 && (
              <button className="text-[10px] text-muted-foreground underline" onClick={() => setSelCities([])}>limpar</button>
            )}
          </div>
          <Input className="mb-2 h-7 text-xs" placeholder="Buscar cidade…" value={cityQuery} onChange={(e) => setCityQuery(e.target.value)} />
          <div className="flex max-h-36 flex-wrap gap-1.5 overflow-y-auto">
            {cityOptions.length === 0 && <span className="text-[11px] text-muted-foreground">Sem cidades.</span>}
            {cityOptions.slice(0, 300).map((c) => {
              const active = selCities.includes(c.name);
              return (
                <button key={`${c.uf ?? "_"}-${c.name}`} type="button" onClick={() => toggle(selCities, c.name, setSelCities)}
                  className={`rounded-md border px-2 py-0.5 text-[11px] ${active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground"}`}>
                  {c.name}{c.uf ? `/${c.uf}` : ""} <span className="opacity-70">· {c.count}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Tags */}
        <div className="rounded-md border border-border bg-muted/20 p-3">
          <div className="mb-1 flex items-center justify-between">
            <Label className="text-xs font-medium">Tags (qualquer uma)</Label>
            {selTags.length > 0 && (
              <button className="text-[10px] text-muted-foreground underline" onClick={() => setSelTags([])}>limpar</button>
            )}
          </div>
          <Input className="mb-2 h-7 text-xs" placeholder="Buscar tag…" value={tagQuery} onChange={(e) => setTagQuery(e.target.value)} />
          <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
            {tagOptions.length === 0 && <span className="text-[11px] text-muted-foreground">Sem tags.</span>}
            {tagOptions.slice(0, 200).map((t) => {
              const active = selTags.includes(t.name);
              return (
                <button key={t.name} type="button" onClick={() => toggle(selTags, t.name, setSelTags)}
                  className={`rounded-md border px-2 py-0.5 text-[11px] ${active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground"}`}>
                  {t.name} <span className="opacity-70">· {t.count}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Preview */}
        <div className="rounded-md border border-border p-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-muted-foreground">Leads que atendem aos filtros</div>
              <div className="text-2xl font-semibold">
                {isFetching ? <Loader2 className="inline h-5 w-5 animate-spin" /> : (preview?.total ?? 0).toLocaleString("pt-BR")}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {preview?.alreadyInCampaign ?? 0} já estão nesta campanha (serão pulados)
              </div>
            </div>
            <button className="text-xs text-muted-foreground underline" onClick={clearAll}>Limpar todos os filtros</button>
          </div>
          {!!preview?.sample?.length && (
            <div className="mt-3 grid gap-1.5 text-xs">
              <div className="text-[10px] uppercase text-muted-foreground">Amostra</div>
              {preview.sample.map((c: { id: string; name: string | null; phone: string; city: string | null; state: string | null; tags: string[] | null; lead_status: string }) => (
                <div key={c.id} className="flex items-center justify-between gap-2 rounded border border-border bg-muted/20 px-2 py-1">
                  <div className="min-w-0">
                    <div className="truncate">{c.name ?? "—"} <span className="text-muted-foreground">· {c.phone}</span></div>
                    <div className="text-[10px] text-muted-foreground">
                      {[c.city, c.state].filter(Boolean).join("/")} {c.tags?.length ? `· ${c.tags.slice(0, 3).join(", ")}` : ""}
                    </div>
                  </div>
                  <Badge variant="outline" className="text-[10px]">{c.lead_status}</Badge>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Classificação + limite + ação */}
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <Label className="text-xs">Classificação inicial</Label>
            <Select value={initialIntent} onValueChange={(v) => setInitialIntent(v as typeof initialIntent)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="silencio">SILÊNCIO</SelectItem>
                <SelectItem value="interessado">INTERESSADO</SelectItem>
                <SelectItem value="lead_quente">LEAD QUENTE</SelectItem>
                <SelectItem value="inscrito">INSCRITO</SelectItem>
                <SelectItem value="objecao">OBJEÇÃO</SelectItem>
                <SelectItem value="sem_interesse">SEM INTERESSE</SelectItem>
                <SelectItem value="fora_escopo">FORA DE ESCOPO</SelectItem>
              </SelectContent>
            </Select>
            <label className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
              <input type="checkbox" checked={overwriteIntent} onChange={(e) => setOverwriteIntent(e.target.checked)} />
              Sobrescrever classificação dos contatos
            </label>
          </div>
          <div>
            <Label className="text-xs">Limite (opcional)</Label>
            <Input type="number" min={1} placeholder="ex.: 5000"
              value={maxAdd} onChange={(e) => setMaxAdd(e.target.value)} />
            <div className="mt-1 text-[10px] text-muted-foreground">Em branco = todos os elegíveis.</div>
          </div>
          <div className="flex items-end justify-end">
            <Button onClick={doAdd} disabled={adding || !preview?.total}>
              {adding ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserPlus className="mr-2 h-4 w-4" />}
              Adicionar à campanha
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}