import { Card } from "@/components/ui/card";
import { Construction } from "lucide-react";

export function ComingSoon({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mx-auto max-w-3xl p-8">
      <Card className="flex flex-col items-center justify-center gap-3 p-12 text-center">
        <Construction className="h-10 w-10 text-muted-foreground" />
        <h2 className="text-xl font-semibold">{title}</h2>
        {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
        <p className="mt-4 text-xs text-muted-foreground">Em desenvolvimento — próxima fase do roadmap.</p>
      </Card>
    </div>
  );
}