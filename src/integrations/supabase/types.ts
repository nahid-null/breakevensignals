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
          mtf_trend: Json | null
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
          mtf_trend?: Json | null
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
          mtf_trend?: Json | null
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
      robot_account: {
        Row: {
          balance: number
          id: number
          start_balance: number
          total_deposited: number
          updated_at: string
        }
        Insert: {
          balance?: number
          id: number
          start_balance?: number
          total_deposited?: number
          updated_at?: string
        }
        Update: {
          balance?: number
          id?: number
          start_balance?: number
          total_deposited?: number
          updated_at?: string
        }
        Relationships: []
      }
      robot_account_events: {
        Row: {
          amount: number
          balance_after: number
          created_at: string
          id: string
          kind: string
        }
        Insert: {
          amount: number
          balance_after: number
          created_at?: string
          id?: string
          kind: string
        }
        Update: {
          amount?: number
          balance_after?: number
          created_at?: string
          id?: string
          kind?: string
        }
        Relationships: []
      }
      robot_backtests: {
        Row: {
          created_at: string
          id: string
          notes: string | null
          period_end: string
          period_start: string
          summary: Json
          symbols: string[]
        }
        Insert: {
          created_at?: string
          id?: string
          notes?: string | null
          period_end: string
          period_start: string
          summary: Json
          symbols: string[]
        }
        Update: {
          created_at?: string
          id?: string
          notes?: string | null
          period_end?: string
          period_start?: string
          summary?: Json
          symbols?: string[]
        }
        Relationships: []
      }
      robot_capital_adjustments: {
        Row: {
          amount: number
          balance_after: number
          balance_before: number
          created_at: string
          id: string
          new_start_balance: number
          previous_start_balance: number
          reason: string
        }
        Insert: {
          amount: number
          balance_after: number
          balance_before: number
          created_at?: string
          id?: string
          new_start_balance: number
          previous_start_balance: number
          reason: string
        }
        Update: {
          amount?: number
          balance_after?: number
          balance_before?: number
          created_at?: string
          id?: string
          new_start_balance?: number
          previous_start_balance?: number
          reason?: string
        }
        Relationships: []
      }
      robot_decisions: {
        Row: {
          candle_time: string
          decision: string
          direction: string
          event_id: string
          evidence: Json | null
          phase: string
          reason: string
          received_at: string
          score: number | null
          source_hash: string
          strategy: string
          symbol: string
        }
        Insert: {
          candle_time: string
          decision: string
          direction: string
          event_id: string
          evidence?: Json | null
          phase: string
          reason: string
          received_at?: string
          score?: number | null
          source_hash: string
          strategy: string
          symbol: string
        }
        Update: {
          candle_time?: string
          decision?: string
          direction?: string
          event_id?: string
          evidence?: Json | null
          phase?: string
          reason?: string
          received_at?: string
          score?: number | null
          source_hash?: string
          strategy?: string
          symbol?: string
        }
        Relationships: []
      }
      robot_market: {
        Row: {
          best_direction: string | null
          best_score: number | null
          depth_usd: number | null
          imbalance: number | null
          last_candle_at: string | null
          liquidity: string | null
          note: string | null
          note_long: string | null
          note_short: string | null
          price: number | null
          quote_volume_24h: number | null
          score_long: number | null
          score_short: number | null
          spread_bps: number | null
          status: string
          symbol: string
          trend_15m: number | null
          trend_1h: number | null
          updated_at: string
        }
        Insert: {
          best_direction?: string | null
          best_score?: number | null
          depth_usd?: number | null
          imbalance?: number | null
          last_candle_at?: string | null
          liquidity?: string | null
          note?: string | null
          note_long?: string | null
          note_short?: string | null
          price?: number | null
          quote_volume_24h?: number | null
          score_long?: number | null
          score_short?: number | null
          spread_bps?: number | null
          status?: string
          symbol: string
          trend_15m?: number | null
          trend_1h?: number | null
          updated_at?: string
        }
        Update: {
          best_direction?: string | null
          best_score?: number | null
          depth_usd?: number | null
          imbalance?: number | null
          last_candle_at?: string | null
          liquidity?: string | null
          note?: string | null
          note_long?: string | null
          note_short?: string | null
          price?: number | null
          quote_volume_24h?: number | null
          score_long?: number | null
          score_short?: number | null
          spread_bps?: number | null
          status?: string
          symbol?: string
          trend_15m?: number | null
          trend_1h?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      robot_positions: {
        Row: {
          band: string
          closed_at: string | null
          direction: string
          entry_audit: Json | null
          entry_fee: number
          entry_price: number
          exit_price: number | null
          exit_reason: string | null
          fees: number
          fill_status: string
          funding: number
          funding_applied_at: number
          id: string
          initial_stop: number
          last_candle_time: number
          last_price: number | null
          leverage: number
          liquidation_price: number
          liquidity: string | null
          mae_roi_pct: number | null
          margin: number
          mfe_roi_pct: number | null
          mode: string
          net_roi_pct: number | null
          notional: number
          opened_at: string
          quantity: number
          quantity_open: number
          realized_pnl: number
          requested_quantity: number | null
          risk_usdt: number
          score: number
          setup: string
          status: string
          stop_loss: number
          symbol: string
          target_roi_pct: number | null
          tick_size: number | null
          tp1: number
          tp1_done: boolean
          tp2: number
          unrealized_pnl: number
          updated_at: string
          version: number
        }
        Insert: {
          band: string
          closed_at?: string | null
          direction: string
          entry_audit?: Json | null
          entry_fee?: number
          entry_price: number
          exit_price?: number | null
          exit_reason?: string | null
          fees?: number
          fill_status?: string
          funding?: number
          funding_applied_at?: number
          id: string
          initial_stop: number
          last_candle_time: number
          last_price?: number | null
          leverage: number
          liquidation_price: number
          liquidity?: string | null
          mae_roi_pct?: number | null
          margin: number
          mfe_roi_pct?: number | null
          mode?: string
          net_roi_pct?: number | null
          notional: number
          opened_at: string
          quantity: number
          quantity_open: number
          realized_pnl?: number
          requested_quantity?: number | null
          risk_usdt: number
          score: number
          setup: string
          status?: string
          stop_loss: number
          symbol: string
          target_roi_pct?: number | null
          tick_size?: number | null
          tp1: number
          tp1_done?: boolean
          tp2: number
          unrealized_pnl?: number
          updated_at?: string
          version?: number
        }
        Update: {
          band?: string
          closed_at?: string | null
          direction?: string
          entry_audit?: Json | null
          entry_fee?: number
          entry_price?: number
          exit_price?: number | null
          exit_reason?: string | null
          fees?: number
          fill_status?: string
          funding?: number
          funding_applied_at?: number
          id?: string
          initial_stop?: number
          last_candle_time?: number
          last_price?: number | null
          leverage?: number
          liquidation_price?: number
          liquidity?: string | null
          mae_roi_pct?: number | null
          margin?: number
          mfe_roi_pct?: number | null
          mode?: string
          net_roi_pct?: number | null
          notional?: number
          opened_at?: string
          quantity?: number
          quantity_open?: number
          realized_pnl?: number
          requested_quantity?: number | null
          risk_usdt?: number
          score?: number
          setup?: string
          status?: string
          stop_loss?: number
          symbol?: string
          target_roi_pct?: number | null
          tick_size?: number | null
          tp1?: number
          tp1_done?: boolean
          tp2?: number
          unrealized_pnl?: number
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      robot_runtime: {
        Row: {
          git_commit: string | null
          host_kind: string
          id: number
          instance_id: string
          reported_at: string
          runtime_mode: string
          source_hash: string
          started_at: string
          strategy: string
        }
        Insert: {
          git_commit?: string | null
          host_kind: string
          id: number
          instance_id: string
          reported_at?: string
          runtime_mode: string
          source_hash: string
          started_at: string
          strategy: string
        }
        Update: {
          git_commit?: string | null
          host_kind?: string
          id?: number
          instance_id?: string
          reported_at?: string
          runtime_mode?: string
          source_hash?: string
          started_at?: string
          strategy?: string
        }
        Relationships: []
      }
      robot_scanner: {
        Row: {
          counting_since: string
          evaluated: number
          exec_failures: Json
          id: number
          last_candle_at: string | null
          live_feeds: number
          long_candidates: number
          monitored: number
          orders_filled: number
          orders_partial: number
          orders_rejected: number
          orders_submitted: number
          qualified: number
          queue: Json
          reasons: Json
          rejected: number
          setups: Json
          short_candidates: number
          updated_at: string
        }
        Insert: {
          counting_since?: string
          evaluated?: number
          exec_failures?: Json
          id: number
          last_candle_at?: string | null
          live_feeds?: number
          long_candidates?: number
          monitored?: number
          orders_filled?: number
          orders_partial?: number
          orders_rejected?: number
          orders_submitted?: number
          qualified?: number
          queue?: Json
          reasons?: Json
          rejected?: number
          setups?: Json
          short_candidates?: number
          updated_at?: string
        }
        Update: {
          counting_since?: string
          evaluated?: number
          exec_failures?: Json
          id?: number
          last_candle_at?: string | null
          live_feeds?: number
          long_candidates?: number
          monitored?: number
          orders_filled?: number
          orders_partial?: number
          orders_rejected?: number
          orders_submitted?: number
          qualified?: number
          queue?: Json
          reasons?: Json
          rejected?: number
          setups?: Json
          short_candidates?: number
          updated_at?: string
        }
        Relationships: []
      }
      robot_settings: {
        Row: {
          breakeven_trigger_roi_pct: number
          cooldown_minutes: number
          daily_loss_limit_enabled: boolean
          daily_loss_limit_pct: number
          emergency_stop: boolean
          enabled: boolean
          entry_max_age_ms: number
          fee_pct: number
          high_score: number
          id: number
          loss_streak_cooldown: number
          loss_streak_enabled: boolean
          maker_fee_pct: number
          max_allocation_pct: number
          max_candle_atr: number
          max_concurrent: number
          max_entry_drift_atr: number
          max_hold_minutes: number
          max_leverage: number
          max_same_direction: number
          max_spread_bps: number
          max_sweep_atr: number
          min_quote_volume_musd: number
          min_rejection_wick: number
          min_reward_risk: number
          min_score: number
          min_sweep_atr: number
          min_volume_ratio: number
          ote_max: number
          ote_min: number
          quote_max_age_ms: number
          risk_per_trade_pct: number
          slippage_bps: number
          sweep_max_age_minutes: number
          symbols: string[] | null
          updated_at: string
        }
        Insert: {
          breakeven_trigger_roi_pct?: number
          cooldown_minutes?: number
          daily_loss_limit_enabled?: boolean
          daily_loss_limit_pct?: number
          emergency_stop?: boolean
          enabled?: boolean
          entry_max_age_ms?: number
          fee_pct?: number
          high_score?: number
          id: number
          loss_streak_cooldown?: number
          loss_streak_enabled?: boolean
          maker_fee_pct?: number
          max_allocation_pct?: number
          max_candle_atr?: number
          max_concurrent?: number
          max_entry_drift_atr?: number
          max_hold_minutes?: number
          max_leverage?: number
          max_same_direction?: number
          max_spread_bps?: number
          max_sweep_atr?: number
          min_quote_volume_musd?: number
          min_rejection_wick?: number
          min_reward_risk?: number
          min_score?: number
          min_sweep_atr?: number
          min_volume_ratio?: number
          ote_max?: number
          ote_min?: number
          quote_max_age_ms?: number
          risk_per_trade_pct?: number
          slippage_bps?: number
          sweep_max_age_minutes?: number
          symbols?: string[] | null
          updated_at?: string
        }
        Update: {
          breakeven_trigger_roi_pct?: number
          cooldown_minutes?: number
          daily_loss_limit_enabled?: boolean
          daily_loss_limit_pct?: number
          emergency_stop?: boolean
          enabled?: boolean
          entry_max_age_ms?: number
          fee_pct?: number
          high_score?: number
          id?: number
          loss_streak_cooldown?: number
          loss_streak_enabled?: boolean
          maker_fee_pct?: number
          max_allocation_pct?: number
          max_candle_atr?: number
          max_concurrent?: number
          max_entry_drift_atr?: number
          max_hold_minutes?: number
          max_leverage?: number
          max_same_direction?: number
          max_spread_bps?: number
          max_sweep_atr?: number
          min_quote_volume_musd?: number
          min_rejection_wick?: number
          min_reward_risk?: number
          min_score?: number
          min_sweep_atr?: number
          min_volume_ratio?: number
          ote_max?: number
          ote_min?: number
          quote_max_age_ms?: number
          risk_per_trade_pct?: number
          slippage_bps?: number
          sweep_max_age_minutes?: number
          symbols?: string[] | null
          updated_at?: string
        }
        Relationships: []
      }
      robot_signals: {
        Row: {
          candle_time: string
          created_at: string
          decision: string
          direction: string
          entry_price: number
          id: string
          liquidity: string | null
          parts: Json
          reason: string | null
          score: number
          setup: string
          stop_loss: number
          symbol: string
          tp1: number
          tp2: number
        }
        Insert: {
          candle_time: string
          created_at?: string
          decision: string
          direction: string
          entry_price: number
          id?: string
          liquidity?: string | null
          parts: Json
          reason?: string | null
          score: number
          setup: string
          stop_loss: number
          symbol: string
          tp1: number
          tp2: number
        }
        Update: {
          candle_time?: string
          created_at?: string
          decision?: string
          direction?: string
          entry_price?: number
          id?: string
          liquidity?: string | null
          parts?: Json
          reason?: string | null
          score?: number
          setup?: string
          stop_loss?: number
          symbol?: string
          tp1?: number
          tp2?: number
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
      sim_account: {
        Row: {
          balance: number
          enabled: boolean
          id: number
          session_started_at: string
          total_deposited: number
          updated_at: string
        }
        Insert: {
          balance?: number
          enabled?: boolean
          id: number
          session_started_at?: string
          total_deposited?: number
          updated_at?: string
        }
        Update: {
          balance?: number
          enabled?: boolean
          id?: number
          session_started_at?: string
          total_deposited?: number
          updated_at?: string
        }
        Relationships: []
      }
      sim_balance_events: {
        Row: {
          balance_after: number
          balance_before: number
          created_at: string
          id: string
          kind: string
        }
        Insert: {
          balance_after: number
          balance_before: number
          created_at?: string
          id?: string
          kind: string
        }
        Update: {
          balance_after?: number
          balance_before?: number
          created_at?: string
          id?: string
          kind?: string
        }
        Relationships: []
      }
      sim_breakeven_confirmations: {
        Row: {
          breakeven_candle_time: number
          breakeven_stop: number
          confirm_close: number | null
          confirm_open: number | null
          created_at: string
          decided_at: string | null
          direction: string
          entry_price: number | null
          mtf_trend: Json | null
          reason: string | null
          reference_price: number
          rule_version: string | null
          signal_score: number | null
          status: string
          symbol: string
          take_profit: number | null
          trade_id: string
        }
        Insert: {
          breakeven_candle_time: number
          breakeven_stop: number
          confirm_close?: number | null
          confirm_open?: number | null
          created_at?: string
          decided_at?: string | null
          direction: string
          entry_price?: number | null
          mtf_trend?: Json | null
          reason?: string | null
          reference_price: number
          rule_version?: string | null
          signal_score?: number | null
          status?: string
          symbol: string
          take_profit?: number | null
          trade_id: string
        }
        Update: {
          breakeven_candle_time?: number
          breakeven_stop?: number
          confirm_close?: number | null
          confirm_open?: number | null
          created_at?: string
          decided_at?: string | null
          direction?: string
          entry_price?: number | null
          mtf_trend?: Json | null
          reason?: string | null
          reference_price?: number
          rule_version?: string | null
          signal_score?: number | null
          status?: string
          symbol?: string
          take_profit?: number | null
          trade_id?: string
        }
        Relationships: []
      }
      sim_deposits: {
        Row: {
          amount: number
          balance_after: number
          created_at: string
          id: string
        }
        Insert: {
          amount: number
          balance_after: number
          created_at?: string
          id?: string
        }
        Update: {
          amount?: number
          balance_after?: number
          created_at?: string
          id?: string
        }
        Relationships: []
      }
      sim_trades: {
        Row: {
          balance_after: number | null
          balance_before: number
          breakeven: boolean
          closed_at: string | null
          created_at: string
          direction: string
          entry_candle_time: number
          entry_fee: number
          entry_price: number
          exit_fee: number
          exit_price: number | null
          exit_reason: string | null
          gross_pnl: number | null
          id: string
          leverage: number
          liquidation_price: number
          margin: number
          notional: number
          opened_at: string
          pnl: number | null
          quantity: number
          rule_version: string
          slippage_price: number
          status: string
          stop_loss: number
          strength: string
          symbol: string
          take_profit: number
          target_net_roi_pct: number | null
          trade_id: string
        }
        Insert: {
          balance_after?: number | null
          balance_before: number
          breakeven?: boolean
          closed_at?: string | null
          created_at?: string
          direction: string
          entry_candle_time: number
          entry_fee: number
          entry_price: number
          exit_fee?: number
          exit_price?: number | null
          exit_reason?: string | null
          gross_pnl?: number | null
          id?: string
          leverage: number
          liquidation_price: number
          margin: number
          notional: number
          opened_at: string
          pnl?: number | null
          quantity: number
          rule_version?: string
          slippage_price?: number
          status?: string
          stop_loss: number
          strength: string
          symbol: string
          take_profit: number
          target_net_roi_pct?: number | null
          trade_id: string
        }
        Update: {
          balance_after?: number | null
          balance_before?: number
          breakeven?: boolean
          closed_at?: string | null
          created_at?: string
          direction?: string
          entry_candle_time?: number
          entry_fee?: number
          entry_price?: number
          exit_fee?: number
          exit_price?: number | null
          exit_reason?: string | null
          gross_pnl?: number | null
          id?: string
          leverage?: number
          liquidation_price?: number
          margin?: number
          notional?: number
          opened_at?: string
          pnl?: number | null
          quantity?: number
          rule_version?: string
          slippage_price?: number
          status?: string
          stop_loss?: number
          strength?: string
          symbol?: string
          take_profit?: number
          target_net_roi_pct?: number | null
          trade_id?: string
        }
        Relationships: []
      }
      sim2_account: {
        Row: {
          available_after_time: number
          balance: number
          enabled: boolean
          id: number
          pending_direction: string | null
          pending_session: string | null
          pending_symbol: string | null
          pending_time: number | null
          session_id: string
          session_started_at: string
          updated_at: string
        }
        Insert: {
          available_after_time?: number
          balance?: number
          enabled?: boolean
          id: number
          pending_direction?: string | null
          pending_session?: string | null
          pending_symbol?: string | null
          pending_time?: number | null
          session_id?: string
          session_started_at?: string
          updated_at?: string
        }
        Update: {
          available_after_time?: number
          balance?: number
          enabled?: boolean
          id?: number
          pending_direction?: string | null
          pending_session?: string | null
          pending_symbol?: string | null
          pending_time?: number | null
          session_id?: string
          session_started_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      sim2_balance_events: {
        Row: {
          balance_after: number
          balance_before: number
          created_at: string
          id: string
          next_session: string
          previous_session: string
        }
        Insert: {
          balance_after?: number
          balance_before: number
          created_at?: string
          id?: string
          next_session: string
          previous_session: string
        }
        Update: {
          balance_after?: number
          balance_before?: number
          created_at?: string
          id?: string
          next_session?: string
          previous_session?: string
        }
        Relationships: []
      }
      sim2_trades: {
        Row: {
          balance_after: number
          balance_before: number
          closed_at: string
          direction: string
          entry_fee: number
          entry_price: number
          exit_fee: number
          exit_price: number
          exit_reason: string
          id: string
          leverage: number
          liquidation_price: number
          margin: number
          opened_at: string
          pnl: number
          quantity: number
          session_id: string
          signal_time: number
          slippage_cost: number
          source: string
          stop_loss: number
          symbol: string
          take_profit: number
        }
        Insert: {
          balance_after: number
          balance_before: number
          closed_at: string
          direction: string
          entry_fee: number
          entry_price: number
          exit_fee: number
          exit_price: number
          exit_reason: string
          id?: string
          leverage?: number
          liquidation_price: number
          margin: number
          opened_at: string
          pnl: number
          quantity: number
          session_id: string
          signal_time: number
          slippage_cost: number
          source?: string
          stop_loss: number
          symbol: string
          take_profit: number
        }
        Update: {
          balance_after?: number
          balance_before?: number
          closed_at?: string
          direction?: string
          entry_fee?: number
          entry_price?: number
          exit_fee?: number
          exit_price?: number
          exit_reason?: string
          id?: string
          leverage?: number
          liquidation_price?: number
          margin?: number
          opened_at?: string
          pnl?: number
          quantity?: number
          session_id?: string
          signal_time?: number
          slippage_cost?: number
          source?: string
          stop_loss?: number
          symbol?: string
          take_profit?: number
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
      robot_add_counts: { Args: { a: Json; b: Json }; Returns: Json }
      robot_commit: { Args: { p: Json }; Returns: Json }
      robot_commit_audited: { Args: { p: Json }; Returns: Json }
      robot_commit_verified: { Args: { p: Json }; Returns: Json }
      robot_correct_initial_balance: {
        Args: { p_start: number }
        Returns: number
      }
      robot_deposit: { Args: { amount: number }; Returns: number }
      robot_emergency_stop: { Args: never; Returns: number }
      robot_queue_telegram: {
        Args: {
          p_direction: string
          p_event: string
          p_message: string
          p_symbol: string
          p_trade: string
        }
        Returns: undefined
      }
      robot_resume: { Args: never; Returns: undefined }
      sim_change_balance: {
        Args: { new_balance: number; restart: boolean }
        Returns: Json
      }
      sim_deposit: { Args: { amount: number }; Returns: Json }
      sim_finish_trade: {
        Args: {
          notify_result: boolean
          px: number
          reason: string
          trade_uuid: string
          ts: string
        }
        Returns: undefined
      }
      sim_manual_close: { Args: { trade_uuid: string }; Returns: Json }
      sim_set_enabled: { Args: { on_off: boolean }; Returns: undefined }
      simulate_engine_candle: { Args: { p: Json }; Returns: undefined }
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
