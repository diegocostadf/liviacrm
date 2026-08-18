import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { LayoutDashboard, MessageSquare, LogOut, Settings, Sun, Moon, Megaphone, Users, BarChart3, Menu } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getMyProfile } from "@/lib/auth.functions";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useTheme } from "@/hooks/use-theme";
import { useEffect, useState, type ReactNode } from "react";

const nav = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/inbox", label: "Conversas", icon: MessageSquare },
  { to: "/leads", label: "Contatos / Leads", icon: Users },
  { to: "/campaigns", label: "Campanhas", icon: Megaphone },
  { to: "/reports", label: "Relatórios", icon: BarChart3 },
  { to: "/settings", label: "Configurações", icon: Settings },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const { location } = useRouterState();
  const navigate = useNavigate();
  const fetchProfile = useServerFn(getMyProfile);
  const { data } = useQuery({ queryKey: ["me"], queryFn: () => fetchProfile() });
  const { theme, toggleTheme } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  async function handleLogout() {
    await supabase.auth.signOut();
    navigate({ to: "/login", replace: true });
  }

  const initial = data?.profile?.display_name?.[0]?.toUpperCase() ?? "U";

  const Brand = ({ size = "md" }: { size?: "md" | "lg" }) => (
    <div className="flex min-w-0 items-center gap-3">
      <div
        className={`grid shrink-0 place-items-center rounded-xl bg-primary font-bold text-primary-foreground shadow-sm ${
          size === "lg" ? "h-12 w-12 text-2xl" : "h-11 w-11 text-xl"
        }`}
      >
        L
      </div>
      <div className="min-w-0">
        <div className="truncate text-base font-semibold leading-tight">Lívia CRM</div>
        <div className="truncate text-xs text-muted-foreground">CRM & Disparos em Massa</div>
      </div>
    </div>
  );

  const NavLinks = () => (
    <nav className="flex-1 space-y-1 px-2 py-2">
      {nav.map((item) => {
        const active = location.pathname === item.to || location.pathname.startsWith(item.to + "/");
        const Icon = item.icon;
        return (
          <Link
            key={item.to}
            to={item.to}
            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${
              active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
            }`}
          >
            <Icon className="h-4.5 w-4.5 shrink-0" />
            <span className="truncate">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );

  const UserBar = () => (
    <div className="border-t border-border p-3">
          <div className="flex items-center gap-2">
        <Avatar className="h-9 w-9 shrink-0">
              <AvatarImage src={data?.profile?.avatar_url ?? undefined} />
              <AvatarFallback>{initial}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{data?.profile?.display_name ?? "Usuário"}</div>
              <div className="truncate text-[11px] text-muted-foreground">{data?.profile?.email}</div>
            </div>
            <Button
              variant="ghost"
              size="icon"
          className="h-9 w-9 shrink-0"
              onClick={toggleTheme}
              title={theme === "dark" ? "Mudar para tema claro" : "Mudar para tema escuro"}
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
        <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={handleLogout} title="Sair">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
    </div>
  );

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-background text-foreground">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-card lg:flex">
        <div className="px-4 py-4">
          <Brand size="lg" />
        </div>
        <NavLinks />
        <UserBar />
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex items-center gap-2 border-b border-border bg-card px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] lg:hidden">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0" aria-label="Abrir menu">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="flex w-[85vw] max-w-xs flex-col p-0">
              <SheetTitle className="sr-only">Menu</SheetTitle>
              <div className="px-4 py-4">
                <Brand size="lg" />
              </div>
              <NavLinks />
              <UserBar />
            </SheetContent>
          </Sheet>
          <div className="min-w-0 flex-1">
            <Brand />
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      </main>
    </div>
  );
}