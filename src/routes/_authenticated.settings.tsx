import { createFileRoute, Link, Outlet, useRouterState, redirect } from "@tanstack/react-router";
import { Bot, Sparkles, BookOpen, Webhook, Users, MessageSquare } from "lucide-react";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Configurações — Lívia CRM" }] }),
  beforeLoad: ({ location }) => {
    if (location.pathname === "/settings" || location.pathname === "/settings/") {
      throw redirect({ to: "/settings/whatsapp" });
    }
  },
  component: SettingsLayout,
});

const items = [
  { to: "/settings/whatsapp", label: "WhatsApp", icon: MessageSquare, desc: "Escolha o provedor (Evolution ou Twilio)" },
  { to: "/settings/ai-providers", label: "Provedores de IA", icon: Sparkles, desc: "Lovable AI, Claude, OpenAI, Google" },
  { to: "/settings/bot", label: "Bot Júlia", icon: Bot, desc: "Persona, modelo e regras por instância" },
  { to: "/settings/knowledge", label: "Base de conhecimento", icon: BookOpen, desc: "Documentos para RAG" },
  { to: "/settings/webhooks", label: "Webhooks externos", icon: Webhook, desc: "Saída para CRM e integrações" },
  { to: "/settings/users", label: "Usuários", icon: Users, desc: "Gerencie quem pode acessar o sistema" },
] as const;

function SettingsLayout() {
  const { location } = useRouterState();
  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="w-64 shrink-0 border-r border-border bg-card/40 p-3">
        <div className="px-2 pb-3 pt-1">
          <div className="text-sm font-semibold">Configurações</div>
          <div className="text-xs text-muted-foreground">Tudo do sistema em um lugar</div>
        </div>
        <nav className="space-y-0.5">
          {items.map((it) => {
            const active = location.pathname.startsWith(it.to);
            const Icon = it.icon;
            return (
              <Link
                key={it.to}
                to={it.to}
                className={`flex items-start gap-2.5 rounded-md px-3 py-2 text-sm transition ${
                  active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                }`}
              >
                <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="min-w-0">
                  <div className="leading-tight">{it.label}</div>
                  <div className="text-[11px] text-muted-foreground/80">{it.desc}</div>
                </div>
              </Link>
            );
          })}
        </nav>
      </aside>
      <div className="flex-1 overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
}