import { Check } from "lucide-react";

export type PreviewButton = {
  type: "QUICK_REPLY" | "URL" | "PHONE_NUMBER";
  text: string;
  url?: string;
  phone_number?: string;
};

export type TemplatePreviewProps = {
  headerText?: string;
  body: string;
  footer?: string;
  buttons?: PreviewButton[];
  examples?: string[];
};

/** Renderiza uma bolha WhatsApp aproximada do que a Meta mostra ao usuário final. */
export function TemplatePreview({ headerText, body, footer, buttons, examples }: TemplatePreviewProps) {
  const rendered = renderVars(body, examples);
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  return (
    <div className="rounded-lg border bg-[#e5ddd5] p-4">
      <div className="mx-auto max-w-sm">
        <div className="relative rounded-lg bg-white p-3 shadow-sm">
          <span className="absolute -left-2 top-0 h-0 w-0 border-b-8 border-r-8 border-t-0 border-b-white border-r-transparent border-t-transparent" />
          {headerText && (
            <div className="mb-1 text-sm font-semibold text-gray-900 break-words">{headerText}</div>
          )}
          <div className="whitespace-pre-wrap break-words text-sm text-gray-900">{rendered}</div>
          {footer && <div className="mt-1 text-[11px] text-gray-500 break-words">{footer}</div>}
          <div className="mt-1 flex items-center justify-end gap-1 text-[10px] text-gray-500">
            <span>{hh}:{mm}</span>
            <Check className="h-3 w-3" />
            <Check className="-ml-2 h-3 w-3" />
          </div>
        </div>
        {buttons && buttons.length > 0 && (
          <div className="mt-1 divide-y divide-gray-200 overflow-hidden rounded-lg bg-white shadow-sm">
            {buttons.map((b, i) => (
              <div key={i} className="flex items-center justify-center gap-2 px-3 py-2 text-sm text-[#0088cc]">
                {b.type === "QUICK_REPLY" ? "↩" : b.type === "URL" ? "🔗" : "📞"}
                <span className="truncate">{b.text || <span className="text-gray-400">(sem texto)</span>}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function renderVars(text: string, examples?: string[]): React.ReactNode {
  if (!text) return null;
  const parts = text.split(/(\{\{\s*\d+\s*\}\})/g);
  return parts.map((p, i) => {
    const m = p.match(/\{\{\s*(\d+)\s*\}\}/);
    if (!m) return <span key={i}>{p}</span>;
    const idx = Number(m[1]) - 1;
    const val = examples?.[idx];
    return (
      <span key={i} className="rounded bg-yellow-200 px-1 font-medium text-gray-800">
        {val || `{{${m[1]}}}`}
      </span>
    );
  });
}