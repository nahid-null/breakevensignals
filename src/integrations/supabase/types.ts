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
          net_result_r: number | null
          original_stop_loss: number
          source: string
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
          net_result_r?: number | null
          original_stop_loss: number
          source?: string
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
          net_result_r?: number | null
          original_stop_loss?: number
          source?: string
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
          long_entry_enabled: boolean
          long_notifications_enabled: boolean
          long_stop_loss_enabled: boolean
          long_take_profit_enabled: boolean
          short_breakeven_enabled: boolean
          short_entry_enabled: boolean
          short_notifications_enabled: boolean
          short_stop_loss_enabled: boolean
          short_take_profit_enabled: boolean
          telegram_enabled: boolean
          updated_at: string
        }
        Insert: {
          default_fee_rate_percent?: number
          display_timezone?: string
          id?: number
          long_breakeven_enabled?: boolean
          long_entry_enabled?: boolean
          long_notifications_enabled?: boolean
          long_stop_loss_enabled?: boolean
          long_take_profit_enabled?: boolean
          short_breakeven_enabled?: boolean
          short_entry_enabled?: boolean
          short_notifications_enabled?: boolean
          short_stop_loss_enabled?: boolean
          short_take_profit_enabled?: boolean
          telegram_enabled?: boolean
          updated_at?: string
        }
        Update: {
          default_fee_rate_percent?: number
          display_timezone?: string
          id?: number
          long_breakeven_enabled?: boolean
          long_entry_enabled?: boolean
          long_notifications_enabled?: boolean
          long_stop_loss_enabled?: boolean
          long_take_profit_enabled?: boolean
          short_breakeven_enabled?: boolean
          short_entry_enabled?: boolean
          short_notifications_enabled?: boolean
          short_stop_loss_enabled?: boolean
          short_take_profit_enabled?: boolean
          telegram_enabled?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      engine_checkpoints: {
        Row: {
          last_candle_time: number | null
          revision: number
          state: Json
          symbol: string
          updated_at: string
        }
        Insert: {
          last_candle_time?: number | null
          revision?: number
          state: Json
          symbol: string
          updated_at?: string
        }
        Update: {
          last_candle_time?: number | null
          revision?: number
          state?: Json
          symbol?: string
          updated_at?: string
        }
        Relationships: []
      }
      engine_control: {
        Row: {
          id: number
          instance_id: string
          lease_until: string
        }
        Insert: {
          id: number
          instance_id: string
          lease_until: string
        }
        Update: {
          id?: number
          instance_id?: string
          lease_until?: string
        }
        Relationships: []
      }
      engine_health: {
        Row: {
          available_symbols: number
          binance_connected: boolean
          error: string | null
          feed_health: Json | null
          host_kind: string
          id: number
          instance_id: string
          last_heartbeat_at: string
          last_scan_at: string | null
          runtime_mode: string
          scanned_symbols: number
          started_at: string | null
          status: string
          uptime_seconds: number
          websocket_connected: boolean
        }
        Insert: {
          available_symbols?: number
          binance_connected?: boolean
          error?: string | null
          feed_health?: Json | null
          host_kind?: string
          id: number
          instance_id: string
          last_heartbeat_at?: string
          last_scan_at?: string | null
          runtime_mode?: string
          scanned_symbols?: number
          started_at?: string | null
          status: string
          uptime_seconds?: number
          websocket_connected?: boolean
        }
        Update: {
          available_symbols?: number
          binance_connected?: boolean
          error?: string | null
          feed_health?: Json | null
          host_kind?: string
          id?: number
          instance_id?: string
          last_heartbeat_at?: string
          last_scan_at?: string | null
          runtime_mode?: string
          scanned_symbols?: number
          started_at?: string | null
          status?: string
          uptime_seconds?: number
          websocket_connected?: boolean
        }
        Relationships: []
      }
      market_state: {
        Row: {
          error: string | null
          last_candle_at: string | null
          long_score: number
          price: number | null
          short_score: number
          status: string
          successful_scans: number
          symbol: string
          trend: string
          updated_at: string
        }
        Insert: {
          error?: string | null
          last_candle_at?: string | null
          long_score?: number
          price?: number | null
          short_score?: number
          status?: string
          successful_scans?: number
          symbol: string
          trend?: string
          updated_at?: string
        }
        Update: {
          error?: string | null
          last_candle_at?: string | null
          long_score?: number
          price?: number | null
          short_score?: number
          status?: string
          successful_scans?: number
          symbol?: string
          trend?: string
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
          source: string
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
          source?: string
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
          source?: string
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
          claimed_at: string | null
          created_at: string
          delivery_claim: string | null
          delivery_status: string
          delivery_uncertain: boolean
          direction: string | null
          error_message: string | null
          event_id: string
          id: string
          is_test: boolean
          message: string
          next_retry_at: string | null
          retry_count: number
          symbol: string | null
          telegram_message_id: number | null
          trade_id: string | null
          updated_at: string
        }
        Insert: {
          claimed_at?: string | null
          created_at?: string
          delivery_claim?: string | null
          delivery_status?: string
          delivery_uncertain?: boolean
          direction?: string | null
          error_message?: string | null
          event_id: string
          id?: string
          is_test?: boolean
          message: string
          next_retry_at?: string | null
          retry_count?: number
          symbol?: string | null
          telegram_message_id?: number | null
          trade_id?: string | null
          updated_at?: string
        }
        Update: {
          claimed_at?: string | null
          created_at?: string
          delivery_claim?: string | null
          delivery_status?: string
          delivery_uncertain?: boolean
          direction?: string | null
          error_message?: string | null
          event_id?: string
          id?: string
          is_test?: boolean
          message?: string
          next_retry_at?: string | null
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
      claim_telegram_delivery: {
        Args: { claim_id: string; log_id: string }
        Returns: {
          claimed_at: string | null
          created_at: string
          delivery_claim: string | null
          delivery_status: string
          delivery_uncertain: boolean
          direction: string | null
          error_message: string | null
          event_id: string
          id: string
          is_test: boolean
          message: string
          next_retry_at: string | null
          retry_count: number
          symbol: string | null
          telegram_message_id: number | null
          trade_id: string | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "telegram_logs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      commit_engine_candle: { Args: { p: Json }; Returns: Json }
      engine_heartbeat: { Args: { p: Json }; Returns: boolean }
      process_signal_event: {
        Args: { p: Json; tg_message: string }
        Returns: Json
      }
      stop_engine: { Args: { p_instance: string }; Returns: boolean }
      terminal_statistics: { Args: never; Returns: Json }
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
