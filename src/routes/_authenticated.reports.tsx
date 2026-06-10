import { createFileRoute, Link, Outlet, useRouterState, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({ meta: [{ title: "Relatórios — Lívia CRM" }] }),
  beforeLoad: ({ location }) => {
    if (location.pathname === "/reports" || location.pathname === "/reports/") {
      throw redirect({ to: "/reports/overview" });
    }
  },
  component: ReportsLayout,
});

const tabs = [
  { to: "/reports/overview", label: "Dashboard" },
  { to: "/reports/lists", label: "Listas personalizadas" },
  { to: "/reports/exports", label: "Exportações" },
] as const;

function ReportsLayout() {
  const { location } = useRouterState();
  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="border-b border-border px-6 pt-5 pb-0">
        <h1 className="text-2xl font-semibold tracking-tight">Relatórios</h1>
        <p className="mt-1 text-sm text-muted-foreground">Performance do CRM, listas customizadas e exportações.</p>
        <nav className="mt-4 flex gap-1">
          {tabs.map((t) => {
            const active = location.pathname.startsWith(t.to);
            return (
              <Link key={t.to} to={t.to} className={`rounded-t-md border-b-2 px-3 py-2 text-sm transition ${active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
                {t.label}
              </Link>
            );
          })}
        </nav>
      </header>
      <div className="flex-1 overflow-y-auto p-6">
        <Outlet />
      </div>
    </div>
  );
}