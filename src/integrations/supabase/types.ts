export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ai_bot_configs: {
        Row: {
          business_hours: Json
          created_at: string
          enabled: boolean
          goal: string
          group_link: string | null
          handoff_keywords: string[]
          handoff_phone: string | null
          id: string
          instance_id: string
          landing_link: string | null
          language: string
          max_tokens: number
          model_name: string
          model_provider: string
          out_of_hours_message: string | null
          persona: string
          rules: Json
          system_extra: string | null
          system_prompt_md: string | null
          temperature: number
          tone: string
          typing_indicator: boolean
          updated_at: string
        }
        Insert: {
          business_hours?: Json
          created_at?: string
          enabled?: boolean
          goal?: string
          group_link?: string | null
          handoff_keywords?: string[]
          handoff_phone?: string | null
          id?: string
          instance_id: string
          landing_link?: string | null
          language?: string
          max_tokens?: number
          model_name?: string
          model_provider?: string
          out_of_hours_message?: string | null
          persona?: string
          rules?: Json
          system_extra?: string | null
          system_prompt_md?: string | null
          temperature?: number
          tone?: string
          typing_indicator?: boolean
          updated_at?: string
        }
        Update: {
          business_hours?: Json
          created_at?: string
          enabled?: boolean
          goal?: string
          group_link?: string | null
          handoff_keywords?: string[]
          handoff_phone?: string | null
          id?: string
          instance_id?: string
          landing_link?: string | null
          language?: string
          max_tokens?: number
          model_name?: string
          model_provider?: string
          out_of_hours_message?: string | null
          persona?: string
          rules?: Json
          system_extra?: string | null
          system_prompt_md?: string | null
          temperature?: number
          tone?: string
          typing_indicator?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_bot_configs_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: true
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      app_settings: {
        Row: {
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Update: {
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      campaign_targets: {
        Row: {
          attempts: number
          campaign_id: string
          contact_id: string | null
          created_at: string
          custom_fields: Json
          error: string | null
          id: string
          locked_until: string | null
          name: string | null
          phone: string
          rendered_message: string | null
          sent_at: string | null
          status: Database["public"]["Enums"]["campaign_target_status"]
          updated_at: string
          wa_message_id: string | null
        }
        Insert: {
          attempts?: number
          campaign_id: string
          contact_id?: string | null
          created_at?: string
          custom_fields?: Json
          error?: string | null
          id?: string
          locked_until?: string | null
          name?: string | null
          phone: string
          rendered_message?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["campaign_target_status"]
          updated_at?: string
          wa_message_id?: string | null
        }
        Update: {
          attempts?: number
          campaign_id?: string
          contact_id?: string | null
          created_at?: string
          custom_fields?: Json
          error?: string | null
          id?: string
          locked_until?: string | null
          name?: string | null
          phone?: string
          rendered_message?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["campaign_target_status"]
          updated_at?: string
          wa_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_targets_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_targets_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          ai_personalize: boolean
          completed_at: string | null
          created_at: string
          created_by: string | null
          failed_count: number
          id: string
          instance_id: string
          name: string
          replied_count: number
          scheduled_at: string | null
          sent_count: number
          started_at: string | null
          status: Database["public"]["Enums"]["campaign_status"]
          template: string
          throttle_max_seconds: number
          throttle_min_seconds: number
          total_count: number
          updated_at: string
          window_end_hour: number
          window_start_hour: number
        }
        Insert: {
          ai_personalize?: boolean
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          failed_count?: number
          id?: string
          instance_id: string
          name: string
          replied_count?: number
          scheduled_at?: string | null
          sent_count?: number
          started_at?: string | null
          status?: Database["public"]["Enums"]["campaign_status"]
          template: string
          throttle_max_seconds?: number
          throttle_min_seconds?: number
          total_count?: number
          updated_at?: string
          window_end_hour?: number
          window_start_hour?: number
        }
        Update: {
          ai_personalize?: boolean
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          failed_count?: number
          id?: string
          instance_id?: string
          name?: string
          replied_count?: number
          scheduled_at?: string | null
          sent_count?: number
          started_at?: string | null
          status?: Database["public"]["Enums"]["campaign_status"]
          template?: string
          throttle_max_seconds?: number
          throttle_min_seconds?: number
          total_count?: number
          updated_at?: string
          window_end_hour?: number
          window_start_hour?: number
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          assigned_to: string | null
          city: string | null
          company: string | null
          created_at: string
          email: string | null
          history: string | null
          id: string
          job_title: string | null
          journey_completed: boolean
          journey_completed_at: string | null
          landing_link_sent_at: string | null
          landing_link_sent_count: number
          last_score_at: string | null
          lead_status: Database["public"]["Enums"]["lead_status"]
          name: string | null
          phone: string
          profile_pic_url: string | null
          source: string | null
          state: string | null
          tags: string[]
          updated_at: string
          utm_content: string | null
        }
        Insert: {
          assigned_to?: string | null
          city?: string | null
          company?: string | null
          created_at?: string
          email?: string | null
          history?: string | null
          id?: string
          job_title?: string | null
          journey_completed?: boolean
          journey_completed_at?: string | null
          landing_link_sent_at?: string | null
          landing_link_sent_count?: number
          last_score_at?: string | null
          lead_status?: Database["public"]["Enums"]["lead_status"]
          name?: string | null
          phone: string
          profile_pic_url?: string | null
          source?: string | null
          state?: string | null
          tags?: string[]
          updated_at?: string
          utm_content?: string | null
        }
        Update: {
          assigned_to?: string | null
          city?: string | null
          company?: string | null
          created_at?: string
          email?: string | null
          history?: string | null
          id?: string
          job_title?: string | null
          journey_completed?: boolean
          journey_completed_at?: string | null
          landing_link_sent_at?: string | null
          landing_link_sent_count?: number
          last_score_at?: string | null
          lead_status?: Database["public"]["Enums"]["lead_status"]
          name?: string | null
          phone?: string
          profile_pic_url?: string | null
          source?: string | null
          state?: string | null
          tags?: string[]
          updated_at?: string
          utm_content?: string | null
        }
        Relationships: []
      }
      conversations: {
        Row: {
          assigned_to: string | null
          bot_active: boolean
          bot_context_reset_at: string | null
          contact_id: string
          created_at: string
          id: string
          instance_id: string
          intent_temperature:
            | Database["public"]["Enums"]["intent_temperature"]
            | null
          is_favorite: boolean
          last_message_at: string | null
          last_message_preview: string | null
          status: Database["public"]["Enums"]["conversation_status"]
          unread_count: number
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          bot_active?: boolean
          bot_context_reset_at?: string | null
          contact_id: string
          created_at?: string
          id?: string
          instance_id: string
          intent_temperature?:
            | Database["public"]["Enums"]["intent_temperature"]
            | null
          is_favorite?: boolean
          last_message_at?: string | null
          last_message_preview?: string | null
          status?: Database["public"]["Enums"]["conversation_status"]
          unread_count?: number
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          bot_active?: boolean
          bot_context_reset_at?: string | null
          contact_id?: string
          created_at?: string
          id?: string
          instance_id?: string
          intent_temperature?:
            | Database["public"]["Enums"]["intent_temperature"]
            | null
          is_favorite?: boolean
          last_message_at?: string | null
          last_message_preview?: string | null
          status?: Database["public"]["Enums"]["conversation_status"]
          unread_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      internal_notes: {
        Row: {
          author_id: string
          content: string
          conversation_id: string
          created_at: string
          id: string
        }
        Insert: {
          author_id: string
          content: string
          conversation_id: string
          created_at?: string
          id?: string
        }
        Update: {
          author_id?: string
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "internal_notes_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_chunks: {
        Row: {
          content: string
          created_at: string
          document_id: string
          embedding: string | null
          id: string
          ord: number
          token_count: number | null
        }
        Insert: {
          content: string
          created_at?: string
          document_id: string
          embedding?: string | null
          id?: string
          ord: number
          token_count?: number | null
        }
        Update: {
          content?: string
          created_at?: string
          document_id?: string
          embedding?: string | null
          id?: string
          ord?: number
          token_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_chunks_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "knowledge_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_documents: {
        Row: {
          created_at: string
          error: string | null
          id: string
          mime: string | null
          name: string
          size_bytes: number | null
          source_text: string | null
          status: Database["public"]["Enums"]["kb_doc_status"]
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          error?: string | null
          id?: string
          mime?: string | null
          name: string
          size_bytes?: number | null
          source_text?: string | null
          status?: Database["public"]["Enums"]["kb_doc_status"]
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          error?: string | null
          id?: string
          mime?: string | null
          name?: string
          size_bytes?: number | null
          source_text?: string | null
          status?: Database["public"]["Enums"]["kb_doc_status"]
          updated_at?: string
          uploaded_by?: string | null
        }
        Relationships: []
      }
      lead_intent_events: {
        Row: {
          contact_id: string
          conversation_id: string
          created_at: string
          id: string
          intent: Database["public"]["Enums"]["intent_label"]
          model: string | null
          score: number
          suggested_next: string | null
          summary: string | null
          temperature: Database["public"]["Enums"]["intent_temperature"]
        }
        Insert: {
          contact_id: string
          conversation_id: string
          created_at?: string
          id?: string
          intent: Database["public"]["Enums"]["intent_label"]
          model?: string | null
          score?: number
          suggested_next?: string | null
          summary?: string | null
          temperature: Database["public"]["Enums"]["intent_temperature"]
        }
        Update: {
          contact_id?: string
          conversation_id?: string
          created_at?: string
          id?: string
          intent?: Database["public"]["Enums"]["intent_label"]
          model?: string | null
          score?: number
          suggested_next?: string | null
          summary?: string | null
          temperature?: Database["public"]["Enums"]["intent_temperature"]
        }
        Relationships: [
          {
            foreignKeyName: "lead_intent_events_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_intent_events_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          content: string | null
          conversation_id: string
          created_at: string
          direction: Database["public"]["Enums"]["message_direction"]
          id: string
          media_mime: string | null
          media_url: string | null
          metadata: Json | null
          sender_id: string | null
          sent_by: Database["public"]["Enums"]["message_sender"] | null
          status: Database["public"]["Enums"]["message_status"]
          type: Database["public"]["Enums"]["message_type"]
          wa_message_id: string | null
        }
        Insert: {
          content?: string | null
          conversation_id: string
          created_at?: string
          direction: Database["public"]["Enums"]["message_direction"]
          id?: string
          media_mime?: string | null
          media_url?: string | null
          metadata?: Json | null
          sender_id?: string | null
          sent_by?: Database["public"]["Enums"]["message_sender"] | null
          status?: Database["public"]["Enums"]["message_status"]
          type?: Database["public"]["Enums"]["message_type"]
          wa_message_id?: string | null
        }
        Update: {
          content?: string | null
          conversation_id?: string
          created_at?: string
          direction?: Database["public"]["Enums"]["message_direction"]
          id?: string
          media_mime?: string | null
          media_url?: string | null
          metadata?: Json | null
          sender_id?: string | null
          sent_by?: Database["public"]["Enums"]["message_sender"] | null
          status?: Database["public"]["Enums"]["message_status"]
          type?: Database["public"]["Enums"]["message_type"]
          wa_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      quick_replies: {
        Row: {
          content: string
          created_at: string
          id: string
          is_shared: boolean
          owner_id: string
          shortcut: string
          updated_at: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          is_shared?: boolean
          owner_id: string
          shortcut: string
          updated_at?: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          is_shared?: boolean
          owner_id?: string
          shortcut?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      webhook_deliveries: {
        Row: {
          attempt: number
          created_at: string
          endpoint_id: string
          event: string
          id: string
          payload: Json
          response_body: string | null
          response_status: number | null
          succeeded: boolean
        }
        Insert: {
          attempt?: number
          created_at?: string
          endpoint_id: string
          event: string
          id?: string
          payload: Json
          response_body?: string | null
          response_status?: number | null
          succeeded?: boolean
        }
        Update: {
          attempt?: number
          created_at?: string
          endpoint_id?: string
          event?: string
          id?: string
          payload?: Json
          response_body?: string | null
          response_status?: number | null
          succeeded?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "webhook_deliveries_endpoint_id_fkey"
            columns: ["endpoint_id"]
            isOneToOne: false
            referencedRelation: "webhook_endpoints"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_endpoints: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          events: string[]
          id: string
          last_called_at: string | null
          last_status: number | null
          name: string
          secret: string | null
          updated_at: string
          url: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          events?: string[]
          id?: string
          last_called_at?: string | null
          last_status?: number | null
          name: string
          secret?: string | null
          updated_at?: string
          url: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          events?: string[]
          id?: string
          last_called_at?: string | null
          last_status?: number | null
          name?: string
          secret?: string | null
          updated_at?: string
          url?: string
        }
        Relationships: []
      }
      whatsapp_instances: {
        Row: {
          created_at: string
          evolution_instance_name: string
          id: string
          last_sync_at: string | null
          name: string
          owner_id: string | null
          phone_number: string | null
          profile_name: string | null
          profile_pic_url: string | null
          status: Database["public"]["Enums"]["instance_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          evolution_instance_name: string
          id?: string
          last_sync_at?: string | null
          name: string
          owner_id?: string | null
          phone_number?: string | null
          profile_name?: string | null
          profile_pic_url?: string | null
          status?: Database["public"]["Enums"]["instance_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          evolution_instance_name?: string
          id?: string
          last_sync_at?: string | null
          name?: string
          owner_id?: string | null
          phone_number?: string | null
          profile_name?: string | null
          profile_pic_url?: string | null
          status?: Database["public"]["Enums"]["instance_status"]
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      match_knowledge_chunks: {
        Args: { match_count?: number; query_embedding: string }
        Returns: {
          content: string
          document_id: string
          id: string
          similarity: number
        }[]
      }
    }
    Enums: {
      app_role: "admin" | "gestor" | "vendedor" | "atendimento"
      campaign_status:
        | "draft"
        | "scheduled"
        | "running"
        | "paused"
        | "completed"
        | "failed"
      campaign_target_status:
        | "pending"
        | "sent"
        | "failed"
        | "replied"
        | "opt_out"
      conversation_status: "open" | "archived"
      instance_status: "disconnected" | "connecting" | "connected" | "error"
      intent_label:
        | "curioso"
        | "interessado"
        | "pronto_pra_comprar"
        | "objecao"
        | "desinteressado"
        | "inscrito"
        | "sem_interesse"
        | "silencio"
        | "fora_escopo"
        | "lead_quente"
      intent_temperature: "frio" | "morno" | "quente"
      kb_doc_status: "processing" | "ready" | "error"
      lead_status: "novo" | "engajado" | "inscrito" | "perdido"
      message_direction: "in" | "out"
      message_sender: "human" | "bot" | "system"
      message_status: "pending" | "sent" | "delivered" | "read" | "failed"
      message_type:
        | "text"
        | "image"
        | "audio"
        | "video"
        | "document"
        | "location"
        | "contact"
        | "sticker"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "gestor", "vendedor", "atendimento"],
      campaign_status: [
        "draft",
        "scheduled",
        "running",
        "paused",
        "completed",
        "failed",
      ],
      campaign_target_status: [
        "pending",
        "sent",
        "failed",
        "replied",
        "opt_out",
      ],
      conversation_status: ["open", "archived"],
      instance_status: ["disconnected", "connecting", "connected", "error"],
      intent_label: [
        "curioso",
        "interessado",
        "pronto_pra_comprar",
        "objecao",
        "desinteressado",
        "inscrito",
        "sem_interesse",
        "silencio",
        "fora_escopo",
        "lead_quente",
      ],
      intent_temperature: ["frio", "morno", "quente"],
      kb_doc_status: ["processing", "ready", "error"],
      lead_status: ["novo", "engajado", "inscrito", "perdido"],
      message_direction: ["in", "out"],
      message_sender: ["human", "bot", "system"],
      message_status: ["pending", "sent", "delivered", "read", "failed"],
      message_type: [
        "text",
        "image",
        "audio",
        "video",
        "document",
        "location",
        "contact",
        "sticker",
      ],
    },
  },
} as const
