import { createFileRoute, Link, Outlet, useRouterState, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Bot, Sparkles, BookOpen, Webhook, Users, FileText, Smartphone, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Configurações — Lívia CRM" }] }),
  beforeLoad: ({ location }) => {
    if (location.pathname === "/settings" || location.pathname === "/settings/") {
      throw redirect({ to: "/settings/whatsapp-cloud" });
    }
  },
  component: SettingsLayout,
});

type WaCloudState = { accounts: Array<{ webhook_subscribed: boolean }> };

async function fetchWaCloudState(): Promise<WaCloudState> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Sessão expirada.");
  const res = await fetch("/api/whatsapp-cloud-settings", {
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (!res.ok) throw new Error("Erro");
  return (await res.json()) as WaCloudState;
}

type Item = { to: string; label: string; icon: typeof Bot; desc: string };

const GROUPS: Array<{ title: string; items: Item[] }> = [
  {
    title: "Conexão",
    items: [
      { to: "/settings/whatsapp-cloud", label: "WhatsApp Cloud API", icon: Smartphone, desc: "Conexão oficial da Meta" },
      { to: "/settings/whatsapp-templates", label: "Templates de Mensagem", icon: FileText, desc: "Templates aprovados pela Meta" },
    ],
  },
  {
    title: "Bot & IA",
    items: [
      { to: "/settings/bot", label: "Bot Júlia (IA)", icon: Bot, desc: "Persona, modelo e regras" },
      { to: "/settings/ai-providers", label: "Provedores de IA", icon: Sparkles, desc: "Lovable AI, Claude, OpenAI, Google" },
      { to: "/settings/knowledge", label: "Base de Conhecimento", icon: BookOpen, desc: "Documentos para RAG" },
    ],
  },
  {
    title: "Sistema",
    items: [
      { to: "/settings/users", label: "Usuários", icon: Users, desc: "Quem pode acessar o sistema" },
      { to: "/settings/webhooks", label: "Webhooks", icon: Webhook, desc: "Saída para CRM e integrações" },
    ],
  },
];

function SettingsLayout() {
  const { location } = useRouterState();
  const { data } = useQuery({ queryKey: ["wa-cloud"], queryFn: fetchWaCloudState, retry: false });
  const isConnected = (data?.accounts ?? []).some((a) => a.webhook_subscribed);

  return (
    <div className="flex h-full overflow-hidden">
      <aside className="hidden w-72 shrink-0 overflow-y-auto border-r border-border bg-card/40 p-3 md:block">
        <div className="px-2 pb-3 pt-1">
          <div className="text-sm font-semibold">Configurações</div>
          <div className="text-xs text-muted-foreground">Tudo do sistema em um lugar</div>
        </div>
        {GROUPS.map((g) => (
          <div key={g.title} className="mb-4">
            <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              {g.title}
            </div>
            <nav className="space-y-0.5">
              {g.items.map((it) => {
                const active = location.pathname.startsWith(it.to);
                const Icon = it.icon;
                const showBadge = it.to === "/settings/whatsapp-cloud";
                return (
                  <Link
                    key={it.to}
                    to={it.to}
                    className={`flex items-start gap-2.5 rounded-md px-3 py-2 text-sm transition ${
                      active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                    }`}
                  >
                    <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 leading-tight">
                        <span className="truncate">{it.label}</span>
                        {showBadge && (
                          isConnected ? (
                            <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600">
                              <CheckCircle2 className="h-2.5 w-2.5" /> Conectado
                            </span>
                          ) : (
                            <span className="shrink-0 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-600">
                              Configurar
                            </span>
                          )
                        )}
                      </div>
                      <div className="truncate text-[11px] text-muted-foreground/80">{it.desc}</div>
                    </div>
                  </Link>
                );
              })}
            </nav>
          </div>
        ))}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex gap-1 overflow-x-auto border-b border-border bg-card/40 p-2 md:hidden">
          {GROUPS.flatMap((g) => g.items).map((it) => {
            const active = location.pathname.startsWith(it.to);
            const Icon = it.icon;
            return (
              <Link
                key={it.to}
                to={it.to}
                className={`flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-xs transition ${
                  active ? "bg-accent text-accent-foreground" : "text-muted-foreground"
                }`}
              >
                <Icon className="h-3.5 w-3.5" /> {it.label}
              </Link>
            );
          })}
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
