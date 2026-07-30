/**
 * Formata números para KPIs com limite na casa de centena:
 * nunca mais de 3 dígitos antes da unidade, evitando quebra de layout.
 * 999 -> "999" | 1234 -> "1,2 mil" | 12345 -> "12 mil" | 1234567 -> "1,2 mi"
 */
export function formatCompactNumber(value: number | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "0";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";

  const units: { limit: number; suffix: string }[] = [
    { limit: 1_000_000_000_000, suffix: "tri" },
    { limit: 1_000_000_000, suffix: "bi" },
    { limit: 1_000_000, suffix: "mi" },
    { limit: 1_000, suffix: "mil" },
  ];

  if (abs < 1_000) return sign + String(Math.round(abs));

  for (const { limit, suffix } of units) {
    if (abs >= limit) {
      const scaled = abs / limit;
      const digits = scaled < 10 ? 1 : 0;
      const text = scaled.toLocaleString("pt-BR", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });
      return `${sign}${text} ${suffix}`;
    }
  }
  return sign + String(Math.round(abs));
}

/** Valor completo para tooltip/acessibilidade. */
export function formatFullNumber(value: number | null | undefined): string {
  return Number(value ?? 0).toLocaleString("pt-BR");
}
