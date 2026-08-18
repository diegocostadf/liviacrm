import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listContacts from "./tools/list-contacts";
import getContact from "./tools/get-contact";
import upsertContact from "./tools/upsert-contact";
import listConversations from "./tools/list-conversations";
import listMessages from "./tools/list-messages";
import sendWhatsappMessage from "./tools/send-whatsapp-message";
import setConversationBot from "./tools/toggle-bot";
import addInternalNote from "./tools/add-internal-note";
import listCampaigns from "./tools/list-campaigns";
import getCampaign from "./tools/get-campaign";
import createCampaign from "./tools/create-campaign";
import addCampaignTargets from "./tools/add-campaign-targets";
import setCampaignStatus from "./tools/set-campaign-status";
import runCampaignBatch from "./tools/run-campaign-batch";
import listTemplates from "./tools/list-templates";
import listChannels from "./tools/list-instances";
import searchKnowledge from "./tools/search-knowledge";
import crmOverview from "./tools/crm-overview";

// O issuer OAuth precisa ser o host direto do Supabase; só o project ref
// sobrevive ao publish sem reescrita.
const projectRef = import.meta.env['VITE_SUPABASE_PROJECT_ID'] ?? "project-ref-unset";

export default defineMcp({
  name: "livia-crm",
  title: "Livia CRM",
  version: "1.0.0",
  instructions:
    "Ferramentas do Lívia CRM (WhatsApp). Use crm_overview para o panorama, list_contacts/get_contact para leads, list_conversations/list_messages para o inbox e send_whatsapp_message para responder. Campanhas: create_campaign → add_campaign_targets → set_campaign_status('running') → run_campaign_batch. Templates aprovados vêm de list_whatsapp_templates e o canal ativo de list_channels. search_knowledge consulta a base de conhecimento. Toda ação acontece como o usuário autenticado, respeitando as permissões do CRM.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [
    crmOverview,
    listContacts,
    getContact,
    upsertContact,
    listConversations,
    listMessages,
    sendWhatsappMessage,
    setConversationBot,
    addInternalNote,
    listCampaigns,
    getCampaign,
    createCampaign,
    addCampaignTargets,
    setCampaignStatus,
    runCampaignBatch,
    listTemplates,
    listChannels,
    searchKnowledge,
  ],
});