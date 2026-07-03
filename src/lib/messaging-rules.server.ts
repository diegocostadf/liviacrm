import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Business rules that gate any outbound WhatsApp message.
 *
 * Meta rules:
 *  - Fora da janela de 24h desde a última mensagem recebida do contato,
 *    somente template aprovado é permitido.
 *  - Contatos com `opted_out = true` não podem receber mensagens.
 */

export type SendGateArgs = {
  contactId: string;
  /** true quando a mensagem é template aprovado */
  isTemplate: boolean;
};

export type SendGateResult =
  | { ok: true }
  | { ok: false; reason: "opted_out" | "outside_24h_window" | "contact_not_found"; message: string };

const WINDOW_MS = 24 * 60 * 60 * 1000;

export async function checkSendGate(args: SendGateArgs): Promise<SendGateResult> {
  const { data, error } = await supabaseAdmin
    .from("contacts")
    .select("id, opted_out, last_inbound_at")
    .eq("id", args.contactId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    return { ok: false, reason: "contact_not_found", message: "Contato não encontrado." };
  }
  if (data.opted_out) {
    return { ok: false, reason: "opted_out", message: "Contato optou por não receber mensagens (opt-out)." };
  }
  if (!args.isTemplate) {
    const last = data.last_inbound_at ? new Date(data.last_inbound_at).getTime() : 0;
    const insideWindow = last > 0 && Date.now() - last < WINDOW_MS;
    if (!insideWindow) {
      return {
        ok: false,
        reason: "outside_24h_window",
        message:
          "Fora da janela de 24h desde a última mensagem do contato. Envie um template aprovado.",
      };
    }
  }
  return { ok: true };
}

export async function assertCanSend(args: SendGateArgs): Promise<void> {
  const r = await checkSendGate(args);
  if (!r.ok) throw new Error(r.message);
}