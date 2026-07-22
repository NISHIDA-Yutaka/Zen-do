// Zendo ドメイン型。DBスキーマ（supabase/migrations）とセマンティクス（docs/database-design.md）に対応。
// 日付は 'YYYY-MM-DD'（JSTの暦日）、時刻は 'HH:MM' または 'HH:MM:SS' の文字列で扱う。

// kind は task(todo)/project の2種（docs/design.md 8章: Inboxは状態ではなくビュー）
export type ItemKind = "project" | "todo";
// 「着手中(doing)」は2026-07-16に廃止（docs/design.md 7.5）
export type ItemStatus = "todo" | "done" | "dropped";

// 繰り返しルール（docs/database-design.md 4.1）
export type RecurrenceRule =
  | { type: "daily" }
  | { type: "weekly"; weekdays: number[] } // ISO: 1=月 … 7=日
  | { type: "monthly_day"; day: number } // 1-31（短い月は月末クランプ）
  | { type: "interval_days"; n: number; from: "schedule" | "completion" };

// 習慣の頻度ルール（docs/design.md 10.1: 柔軟頻度3種。曜日固定は繰り返しタスクで表現する）
export type FrequencyRule =
  | { type: "daily" }
  | { type: "every_n_days"; n: number }
  | { type: "times_per_week"; n: number };

// リマインダールール（docs/database-design.md 6.1）
export type ReminderRule =
  | { kind: "at"; at: string } // 絶対時刻（ISO8601、繰り返しには複製されない）
  | { kind: "on_due_at"; time: string } // 当日の指定時刻 "HH:MM"
  | { kind: "day_before_at"; time: string } // 前日の指定時刻 "HH:MM"
  | { kind: "before_due_minutes"; minutes: number }; // 期限のn分前（due_time必須）

export interface Item {
  id: string;
  kind: ItemKind;
  title: string;
  notes: string;
  // メモは #memo タグ付きタスクとして表現する（docs/design.md 13.1。旧 is_memo 列は廃止）
  tags: string[];
  status: ItemStatus;
  parent_id: string | null;
  habit_id: string | null;
  due_date: string | null;
  due_time: string | null;
  recurrence_rule: RecurrenceRule | null;
  generated_from: string | null;
  postponed_count: number;
  sort_order: number;
  done_at: string | null;
  captured_raw: string | null;
  created_at: string;
  updated_at: string;
}

export interface Habit {
  id: string;
  title: string;
  notes: string;
  tags: string[];
  frequency_rule: FrequencyRule;
  default_reminder_rule: ReminderRule | null;
  is_paused: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface Reminder {
  id: string;
  item_id: string;
  rule: ReminderRule;
  remind_at: string;
  snoozed_until: string | null;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
}
