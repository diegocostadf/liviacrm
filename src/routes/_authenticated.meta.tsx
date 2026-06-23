import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import {
  LayoutGrid,
  Plug,
  Phone,
  Building2,
  KeyRound,
  FileText,
  Webhook,
  ScrollText,
  Settings,
} from "lucide-react";

const subnav = [
  { to: "/meta/overview", label: "Visão Geral", icon: LayoutGrid },
  { to: "/meta/connect", label: "Conectar WhatsApp", icon: Plug },
  { to: "/meta/numbers", label: "Números", icon: Phone },
  { to: "/meta/businesses", label: "Contas Comerciais", icon: Building2 },
  { to: "/meta/tokens", label: "Tokens", icon: KeyRound },
  { to: "/meta/templates", label: "Templates", icon: FileText },
  { to: "/meta/webhooks", label: "Webhooks", icon: Webhook },
  { to: "/meta/logs", label: "Logs", icon: ScrollText },
  { to: "/meta/settings", label: "Configurações", icon: Settings },
] as const;

export const Route = createFileRoute("/_authenticated/meta")({
  head: () => ({ meta: [{ title: "Meta Integration — Lívia CRM" }] }),
  component: MetaLayout,
});

function MetaLayout() {
  const { location } = useRouterState();
  return (
    <AppShell>
      <div className="flex h-full">
        <aside className="w-56 shrink-0 border-r border-border bg-card/60">
          <div className="px-4 py-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Meta Integration</div>
          </div>
          <nav className="space-y-0.5 px-2 pb-4">
            {subnav.map((item) => {
              const active =
                location.pathname === item.to || location.pathname.startsWith(item.to + "/");
              const Icon = item.icon;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition ${
                    active
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </aside>
        <div className="flex-1 overflow-auto">
          <Outlet />
        </div>
      </div>
    </AppShell>
  );
}