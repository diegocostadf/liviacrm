import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { evolutionFetch } from "./evolution.server";
import { chatComplete, type ChatMessage, type ProviderId } from "./ai.server";
import { searchKnowledge } from "./knowledge.server";

type BotConfig = {
  id: string;
  instance_id: string;
  enabled: boolean;
  persona: string;
  goal: string;
  tone: string;
  language: string;
  model_provider: string;
  model_name: string;
  temperature: number;
  max_tokens: number;
  system_extra: string | null;
  group_link: string | null;
  landing_link: string | null;
  out_of_hours_message: string | null;
  handoff_keywords: string[];
  handoff_phone: string | null;
  typing_indicator: boolean;
  business_hours: { start_hour?: number; end_hour?: number; enabled?: boolean } | null;
};

const REPLY_TOOL = {
  type: "function" as const,
  function: {
    name: "reply_and_score",
    description: "Responda ao lead e classifique a intenção/temperatura.",
    parameters: {
      type: "object",
      properties: {
        reply: { type: "string", description: "Resposta curta para enviar ao lead (máx ~600 chars)." },
        send_group_link: { type: "boolean", description: "Anexar o link do grupo do WhatsApp?" },
        send_landing_link: { type: "boolean", description: "Anexar o link da landing/checkout?" },
        handoff: { type: "boolean", description: "Transferir para humano (encerra o bot na conversa)?" },
        temperature: { type: "string", enum: ["frio", "morno", "quente"] },
        intent: {
          type: "string",
          enum: ["curioso", "interessado", "pronto_pra_comprar", "objecao", "desinteressado"],
        },
        score: { type: "integer", minimum: 0, maximum: 100 },
        next_step: { type: "string", description: "Próximo passo recomendado em 1 frase." },
        summary: { type: "string", description: "Resumo do lead em 1 frase." },
        contact_name: { type: "string", description: "Nome completo do lead, se mencionado na conversa. Caso contrário, omita." },
        contact_email: { type: "string", description: "E-mail do lead, se mencionado. Caso contrário, omita." },
        contact_city: { type: "string", description: "Cidade do lead, se mencionada. Caso contrário, omita." },
        contact_state: { type: "string", description: "Estado/UF do lead, se mencionado." },
        contact_company: { type: "string", description: "Empresa/instituição do lead, se mencionada." },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Tags curtas (1-3 palavras, minúsculas) representando interesse, produto desejado, perfil ou objeções. Ex.: 'concurso-federal','duvida-preco','oab','interessado-grupo'.",
        },
      },
      required: ["reply", "temperature", "intent", "score", "next_step", "summary"],
      additionalProperties: false,
    },
  },
};

function isWithinBusinessHours(cfg: BotConfig): boolean {
  const bh = cfg.business_hours ?? {};
  if (!bh.enabled) return true;
  const start = typeof bh.start_hour === "number" ? bh.start_hour : 0;
  const end = typeof bh.end_hour === "number" ? bh.end_hour : 24;
  const h = new Date().getUTCHours() - 3; // approx BRT
  const hour = ((h % 24) + 24) % 24;
  if (start <= end) return hour >= start && hour < end;
  return hour >= start || hour < end; // overnight window
}

function leadStatusFor(
  t: string,
  intent: string,
): "novo" | "engajado" | "inscrito" | "perdido" {
  if (intent === "desinteressado" || t === "frio") return "perdido";
  if (intent === "pronto_pra_comprar" || intent === "interessado" || t === "quente" || t === "morno") return "engajado";
  return "novo";
}

/**
 * Orchestrates the bot's reply for an inbound message. Safe to fire-and-forget
 * from the webhook — it never throws into the caller.
 */
export async function handleBotReply(conversationId: string): Promise<void> {
  try {
    const { data: conv, error: cErr } = await supabaseAdmin
      .from("conversations")
      .select(
        `id, bot_active, instance_id, contact_id,
         contacts(id, name, phone, lead_status),
         whatsapp_instances(id, evolution_instance_name)`,
      )
      .eq("id", conversationId)
      .maybeSingle();
    if (cErr || !conv || !conv.bot_active) return;

    const instanceId = conv.instance_id;
    const { data: cfg } = await supabaseAdmin
      .from("ai_bot_configs")
      .select("*")
      .eq("instance_id", instanceId)
      .maybeSingle();
    const bot = cfg as BotConfig | null;
    if (!bot || !bot.enabled) return;

    const instance = (conv as unknown as {
      whatsapp_instances: { evolution_instance_name: string };
    }).whatsapp_instances;
    const contact = (conv as unknown as {
      contacts: {
        id: string;
        name: string | null;
        phone: string;
        email?: string | null;
        city?: string | null;
        state?: string | null;
        company?: string | null;
        tags?: string[] | null;
      };
    }).contacts;
    if (!instance?.evolution_instance_name || !contact?.phone) return;

    // Load recent message history (last 20)
    const { data: history } = await supabaseAdmin
      .from("messages")
      .select("direction, content, sent_by, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(20);
    const messages = (history ?? []).reverse();
    const lastInbound = [...messages].reverse().find((m) => m.direction === "in");
    const lastText = (lastInbound?.content ?? "").trim();
    if (!lastText) return;

    // Handoff keyword?
    const triggered = (bot.handoff_keywords ?? []).find((kw) =>
      lastText.toLowerCase().includes(kw.toLowerCase()),
    );
    if (triggered) {
      await supabaseAdmin
        .from("conversations")
        .update({ bot_active: false, assigned_to: null })
        .eq("id", conversationId);
      await sendBotMessage(
        conversationId,
        instance.evolution_instance_name,
        contact.phone,
        "Entendido! Vou chamar um humano da equipe pra continuar com você por aqui. 👋",
        undefined,
        bot.typing_indicator,
      );
      await notifyHumanHandoff(bot, instance.evolution_instance_name, contact, "Palavra-chave de handoff detectada.");
      return;
    }

    // Business hours
    if (!isWithinBusinessHours(bot) && bot.out_of_hours_message) {
      await sendBotMessage(
        conversationId,
        instance.evolution_instance_name,
        contact.phone,
        bot.out_of_hours_message,
        undefined,
        bot.typing_indicator,
      );
      return;
    }

    // RAG context
    let kbContext = "";
    try {
      const hits = await searchKnowledge(lastText, 4);
      if (hits.length) {
        kbContext =
          "Base de conhecimento (use APENAS o que for relevante, cite naturalmente):\n" +
          hits.map((h, i) => `[${i + 1}] ${h.content}`).join("\n---\n");
      }
    } catch (e) {
      console.warn("[bot] RAG search failed", e);
    }

    const linkBlock = [
      bot.group_link ? `Link do grupo: ${bot.group_link}` : null,
      bot.landing_link ? `Link da página/checkout: ${bot.landing_link}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    const system = [
      `Você é ${bot.persona}`,
      `Objetivo: ${bot.goal}`,
      `Tom: ${bot.tone}`,
      `Idioma: ${bot.language}`,
      `Nome do lead: ${contact.name ?? "desconhecido"}.`,
      linkBlock ? `Links disponíveis:\n${linkBlock}` : "",
      bot.system_extra ?? "",
      "Regras: respostas curtas e humanas (máx 3 frases). Nunca invente preço, prazo ou bônus. Se não souber, peça contexto. Use os links somente quando o lead demonstrar interesse claro. Marque handoff=true se o lead pedir falar com humano, reclamar, ou demonstrar irritação.",
      kbContext,
    ]
      .filter((s) => s && s.trim())
      .join("\n\n");

    const chatMessages: ChatMessage[] = [
      { role: "system", content: system },
      ...messages.map<ChatMessage>((m) => ({
        role: m.direction === "in" ? "user" : "assistant",
        content: m.content ?? "",
      })),
    ];

    const result = await chatComplete({
      provider: bot.model_provider as ProviderId,
      model: bot.model_name,
      temperature: Number(bot.temperature) || 0.4,
      maxTokens: bot.max_tokens || 1024,
      messages: chatMessages,
      tools: [REPLY_TOOL],
      toolChoice: { type: "function", function: { name: "reply_and_score" } },
    });
    const call = result.choices?.[0]?.message?.tool_calls?.[0];
    if (!call) {
      const txt = result.choices?.[0]?.message?.content?.trim();
      if (txt) {
        await sendBotMessage(conversationId, instance.evolution_instance_name, contact.phone, txt);
      }
      return;
    }

    let parsed: {
      reply: string;
      send_group_link?: boolean;
      send_landing_link?: boolean;
      handoff?: boolean;
      temperature: "frio" | "morno" | "quente";
      intent: "curioso" | "interessado" | "pronto_pra_comprar" | "objecao" | "desinteressado";
      score: number;
      next_step: string;
      summary: string;
    };
    try {
      parsed = JSON.parse(call.function.arguments);
    } catch (e) {
      console.error("[bot] failed to parse tool args", e);
      return;
    }

    let reply = (parsed.reply ?? "").trim();
    if (parsed.send_group_link && bot.group_link && !reply.includes(bot.group_link)) {
      reply += `\n\n👉 ${bot.group_link}`;
    }
    if (parsed.send_landing_link && bot.landing_link && !reply.includes(bot.landing_link)) {
      reply += `\n\n🔗 ${bot.landing_link}`;
    }

    if (reply) {
      await sendBotMessage(
        conversationId,
        instance.evolution_instance_name,
        contact.phone,
        reply,
        { intent: parsed.intent, temperature: parsed.temperature, score: parsed.score },
        bot.typing_indicator,
      );
    }

    // Persist intent event + denormalized fields
    await supabaseAdmin.from("lead_intent_events").insert({
      conversation_id: conversationId,
      contact_id: contact.id,
      temperature: parsed.temperature,
      intent: parsed.intent,
      score: Math.max(0, Math.min(100, Math.round(parsed.score ?? 0))),
      suggested_next: parsed.next_step ?? null,
      summary: parsed.summary ?? null,
      model: `${bot.model_provider}:${bot.model_name}`,
    });

    await supabaseAdmin
      .from("conversations")
      .update({ intent_temperature: parsed.temperature })
      .eq("id", conversationId);

    const status = leadStatusFor(parsed.temperature, parsed.intent);
    // Enriquecer CRM com dados extraídos da conversa
    const contactPatch: Record<string, unknown> = {
      lead_status: status,
      last_score_at: new Date().toISOString(),
    };
    if (!contact.name && parsed.contact_name) contactPatch.name = parsed.contact_name.slice(0, 255);
    if (!contact.email && parsed.contact_email) contactPatch.email = parsed.contact_email.slice(0, 255);
    if (!contact.city && parsed.contact_city) contactPatch.city = parsed.contact_city.slice(0, 120);
    if (!contact.state && parsed.contact_state) contactPatch.state = parsed.contact_state.slice(0, 60);
    if (!contact.company && parsed.contact_company) contactPatch.company = parsed.contact_company.slice(0, 255);
    if (parsed.tags?.length) {
      const existing = new Set((contact.tags ?? []).map((t) => t.toLowerCase()));
      const merged = [...(contact.tags ?? [])];
      for (const raw of parsed.tags) {
        const t = String(raw).trim().toLowerCase().slice(0, 60);
        if (t && !existing.has(t)) {
          merged.push(t);
          existing.add(t);
        }
      }
      contactPatch.tags = merged.slice(0, 50);
    }
    await supabaseAdmin.from("contacts").update(contactPatch).eq("id", contact.id);

    if (parsed.handoff) {
      await supabaseAdmin
        .from("conversations")
        .update({ bot_active: false })
        .eq("id", conversationId);
      await notifyHumanHandoff(bot, instance.evolution_instance_name, contact, parsed.summary ?? parsed.next_step ?? "Lead solicitou atendimento humano.");
    }
  } catch (e) {
    console.error("[handleBotReply] error", e);
  }
}

function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, "");
}

async function notifyHumanHandoff(
  bot: BotConfig,
  evolutionInstanceName: string,
  contact: { name: string | null; phone: string },
  reason: string,
) {
  const target = normalizePhone(bot.handoff_phone ?? "");
  if (!target) return;
  const text = [
    "🤝 *Handoff Lívia/Júlia*",
    `Lead: ${contact.name ?? "Sem nome"} (${contact.phone})`,
    `Motivo: ${reason}`,
  ].join("\n");
  try {
    await evolutionFetch(`/message/sendText/${evolutionInstanceName}`, {
      method: "POST",
      json: { number: target, text },
    });
  } catch (e) {
    console.warn("[bot] handoff notify failed", e);
  }
}

async function sendBotMessage(
  conversationId: string,
  evolutionInstanceName: string,
  phone: string,
  text: string,
  metadata?: Record<string, unknown>,
  showTyping: boolean = true,
) {
  if (showTyping) {
    try {
      // Typing indicator (composing) — Evolution v2 endpoint
      const delay = Math.min(4000, 800 + Math.min(text.length, 400) * 25);
      await evolutionFetch(`/chat/sendPresence/${evolutionInstanceName}`, {
        method: "POST",
        json: { number: phone, presence: "composing", delay },
      });
      await new Promise((r) => setTimeout(r, delay));
    } catch (e) {
      console.warn("[bot] typing presence failed", e);
    }
  }
  const res = (await evolutionFetch(`/message/sendText/${evolutionInstanceName}`, {
    method: "POST",
    json: { number: phone, text },
  })) as { key?: { id?: string } };

    await supabaseAdmin.from("messages").insert({
    conversation_id: conversationId,
    direction: "out",
    type: "text",
    content: text,
    status: "sent",
    sent_by: "bot",
    wa_message_id: res?.key?.id ?? null,
    metadata: (metadata as unknown as never) ?? null,
  });

  await supabaseAdmin
    .from("conversations")
    .update({
      last_message_at: new Date().toISOString(),
      last_message_preview: text.slice(0, 120),
    })
    .eq("id", conversationId);
}