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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      active_positions: {
        Row: {
          breakeven_timestamp: string | null
          created_at: string
          current_stop_loss: number
          direction: string
          entry_price: number
          entry_timestamp: string
          exit_price: number | null
          exit_timestamp: string | null
          fee_rate_percent: number | null
          id: string
          indicator_name: string
          original_stop_loss: number
          status: string
          symbol: string
          take_profit: number
          timeframe: string
          trade_id: string
          updated_at: string
        }
        Insert: {
          breakeven_timestamp?: string | null
          created_at?: string
          current_stop_loss: number
          direction: string
          entry_price: number
          entry_timestamp: string
          exit_price?: number | null
          exit_timestamp?: string | null
          fee_rate_percent?: number | null
          id?: string
          indicator_name: string
          original_stop_loss: number
          status?: string
          symbol: string
          take_profit: number
          timeframe: string
          trade_id: string
          updated_at?: string
        }
        Update: {
          breakeven_timestamp?: string | null
          created_at?: string
          current_stop_loss?: number
          direction?: string
          entry_price?: number
          entry_timestamp?: string
          exit_price?: number | null
          exit_timestamp?: string | null
          fee_rate_percent?: number | null
          id?: string
          indicator_name?: string
          original_stop_loss?: number
          status?: string
          symbol?: string
          take_profit?: number
          timeframe?: string
          trade_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          default_fee_rate_percent: number
          display_timezone: string
          id: number
          long_breakeven_enabled: boolean
          short_breakeven_enabled: boolean
          telegram_enabled: boolean
          updated_at: string
        }
        Insert: {
          default_fee_rate_percent?: number
          display_timezone?: string
          id?: number
          long_breakeven_enabled?: boolean
          short_breakeven_enabled?: boolean
          telegram_enabled?: boolean
          updated_at?: string
        }
        Update: {
          default_fee_rate_percent?: number
          display_timezone?: string
          id?: number
          long_breakeven_enabled?: boolean
          short_breakeven_enabled?: boolean
          telegram_enabled?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      signal_events: {
        Row: {
          created_at: string
          direction: string
          entry_price: number | null
          event_id: string
          event_type: string
          exit_price: number | null
          fee_rate_percent: number | null
          id: string
          indicator_name: string
          processed_status: string
          processing_note: string | null
          stop_loss: number | null
          symbol: string
          take_profit: number | null
          timeframe: string
          timestamp: string
          trade_id: string
        }
        Insert: {
          created_at?: string
          direction: string
          entry_price?: number | null
          event_id: string
          event_type: string
          exit_price?: number | null
          fee_rate_percent?: number | null
          id?: string
          indicator_name: string
          processed_status: string
          processing_note?: string | null
          stop_loss?: number | null
          symbol: string
          take_profit?: number | null
          timeframe: string
          timestamp: string
          trade_id: string
        }
        Update: {
          created_at?: string
          direction?: string
          entry_price?: number | null
          event_id?: string
          event_type?: string
          exit_price?: number | null
          fee_rate_percent?: number | null
          id?: string
          indicator_name?: string
          processed_status?: string
          processing_note?: string | null
          stop_loss?: number | null
          symbol?: string
          take_profit?: number | null
          timeframe?: string
          timestamp?: string
          trade_id?: string
        }
        Relationships: []
      }
      telegram_logs: {
        Row: {
          created_at: string
          delivery_status: string
          direction: string | null
          error_message: string | null
          event_id: string
          id: string
          is_test: boolean
          message: string
          retry_count: number
          symbol: string | null
          telegram_message_id: number | null
          trade_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          delivery_status?: string
          direction?: string | null
          error_message?: string | null
          event_id: string
          id?: string
          is_test?: boolean
          message: string
          retry_count?: number
          symbol?: string | null
          telegram_message_id?: number | null
          trade_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          delivery_status?: string
          direction?: string | null
          error_message?: string | null
          event_id?: string
          id?: string
          is_test?: boolean
          message?: string
          retry_count?: number
          symbol?: string | null
          telegram_message_id?: number | null
          trade_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      webhook_receipts: {
        Row: {
          accepted: boolean
          event_id: string | null
          id: string
          raw_payload: Json | null
          reason: string | null
          received_at: string
        }
        Insert: {
          accepted: boolean
          event_id?: string | null
          id?: string
          raw_payload?: Json | null
          reason?: string | null
          received_at?: string
        }
        Update: {
          accepted?: boolean
          event_id?: string | null
          id?: string
          raw_payload?: Json | null
          reason?: string | null
          received_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      process_signal_event: {
        Args: { p: Json; tg_message: string }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
