import type { Json } from "@/lib/types";

type Table<Row, Insert, Update = Partial<Insert>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export interface Database {
  public: {
    Tables: {
      leads: Table<
        {
          id: string;
          full_name: string | null;
          email: string | null;
          company: string | null;
          channel: "instagram" | "whatsapp" | "email";
          status:
            | "new"
            | "qualifying"
            | "qualified"
            | "follow_up"
            | "meeting_booked"
            | "disqualified";
          assigned_representative_id: string | null;
          qualification_evidence: Json;
          last_activity_at: string | null;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          full_name?: string | null;
          email?: string | null;
          company?: string | null;
          channel: "instagram" | "whatsapp" | "email";
          status?:
            | "new"
            | "qualifying"
            | "qualified"
            | "follow_up"
            | "meeting_booked"
            | "disqualified";
          assigned_representative_id?: string | null;
          qualification_evidence?: Json;
          last_activity_at?: string | null;
          created_at?: string;
          updated_at?: string;
        }
      >;
      messages: Table<
        {
          id: string;
          lead_id: string;
          channel: "instagram" | "whatsapp" | "email";
          direction: "inbound" | "outbound";
          body: string;
          provider_message_id: string | null;
          sent_at: string;
          created_at: string;
        },
        {
          id?: string;
          lead_id: string;
          channel: "instagram" | "whatsapp" | "email";
          direction: "inbound" | "outbound";
          body: string;
          provider_message_id?: string | null;
          sent_at?: string;
          created_at?: string;
        }
      >;
      sales_representatives: Table<
        {
          id: string;
          user_id: string | null;
          display_name: string;
          email: string;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          user_id?: string | null;
          display_name: string;
          email: string;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        }
      >;
      meetings: Table<
        {
          id: string;
          lead_id: string;
          representative_id: string | null;
          status: "pending_confirmation" | "confirmed" | "cancelled";
          starts_at: string;
          ends_at: string;
          customer_confirmed_at: string | null;
          external_event_id: string | null;
          idempotency_key: string;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          lead_id: string;
          representative_id?: string | null;
          status?: "pending_confirmation" | "confirmed" | "cancelled";
          starts_at: string;
          ends_at: string;
          customer_confirmed_at?: string | null;
          external_event_id?: string | null;
          idempotency_key: string;
          created_at?: string;
          updated_at?: string;
        }
      >;
      action_logs: Table<
        {
          id: string;
          lead_id: string | null;
          actor_user_id: string | null;
          action_type: string;
          summary: string;
          metadata: Json;
          created_at: string;
        },
        {
          id?: string;
          lead_id?: string | null;
          actor_user_id?: string | null;
          action_type: string;
          summary: string;
          metadata?: Json;
          created_at?: string;
        }
      >;
      automation_controls: Table<
        {
          id: string;
          lead_id: string | null;
          channel: "instagram" | "whatsapp" | "email" | null;
          is_enabled: boolean;
          updated_by: string | null;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          lead_id?: string | null;
          channel?: "instagram" | "whatsapp" | "email" | null;
          is_enabled?: boolean;
          updated_by?: string | null;
          created_at?: string;
          updated_at?: string;
        }
      >;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
