// リクエストボディの入力検証（zod）。ルールのJSON語彙は docs/database-design.md 4.1/5.1/6.1 に対応。
import { z } from "zod";

const timeString = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM 形式で指定してください");
const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD 形式で指定してください");
const datetimeString = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), "解釈可能な日時文字列を指定してください");

// --- 繰り返しルール ---
export const recurrenceRuleSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("daily") }),
  z.object({
    type: z.literal("weekly"),
    weekdays: z.array(z.number().int().min(1).max(7)).min(1),
  }),
  z.object({ type: z.literal("monthly_day"), day: z.number().int().min(1).max(31) }),
  z.object({
    type: z.literal("interval_days"),
    n: z.number().int().min(1),
    from: z.enum(["schedule", "completion"]),
  }),
]);

// --- 習慣の頻度ルール（docs/design.md 10.1: 柔軟頻度3種） ---
export const frequencyRuleSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("daily") }),
  z.object({ type: z.literal("every_n_days"), n: z.number().int().min(2).max(365) }),
  z.object({ type: z.literal("times_per_week"), n: z.number().int().min(1).max(7) }),
]);

// --- リマインダールール ---
export const reminderRuleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("at"), at: datetimeString }),
  z.object({ kind: z.literal("on_due_at"), time: timeString }),
  z.object({ kind: z.literal("day_before_at"), time: timeString }),
  z.object({ kind: z.literal("before_due_minutes"), minutes: z.number().int().min(1) }),
]);

// --- Item 作成（statusは常にtodoで生まれるため受け付けない） ---
export const createItemSchema = z.object({
  kind: z.enum(["project", "todo"]).optional(),
  title: z.string().min(1, "タイトルは必須です"),
  notes: z.string().optional(),
  tags: z.array(z.string()).optional(),
  parent_id: z.string().uuid().nullable().optional(),
  due_date: dateString.nullable().optional(),
  due_time: timeString.nullable().optional(),
  recurrence_rule: recurrenceRuleSchema.nullable().optional(),
  reminders: z.array(reminderRuleSchema).optional(),
  captured_raw: z.string().nullable().optional(),
});

// --- Item 更新（全項目任意）。status に 'done' は含めない（完了は /complete 経由） ---
export const updateItemSchema = z.object({
  kind: z.enum(["project", "todo"]).optional(),
  title: z.string().min(1).optional(),
  notes: z.string().optional(),
  tags: z.array(z.string()).optional(),
  status: z.enum(["todo", "dropped"]).optional(),
  parent_id: z.string().uuid().nullable().optional(),
  due_date: dateString.nullable().optional(),
  due_time: timeString.nullable().optional(),
  recurrence_rule: recurrenceRuleSchema.nullable().optional(),
  sort_order: z.number().optional(),
  reminders: z.array(reminderRuleSchema).optional(),
});

// --- Habit 作成 / 更新 ---
export const createHabitSchema = z.object({
  title: z.string().min(1, "タイトルは必須です"),
  notes: z.string().optional(),
  tags: z.array(z.string()).optional(),
  frequency_rule: frequencyRuleSchema,
  default_reminder_rule: reminderRuleSchema.nullable().optional(),
  is_paused: z.boolean().optional(),
  sort_order: z.number().optional(),
});

export const updateHabitSchema = z.object({
  title: z.string().min(1).optional(),
  notes: z.string().optional(),
  tags: z.array(z.string()).optional(),
  frequency_rule: frequencyRuleSchema.optional(),
  default_reminder_rule: reminderRuleSchema.nullable().optional(),
  is_paused: z.boolean().optional(),
  sort_order: z.number().optional(),
});

export const instantiateHabitSchema = z.object({
  date: dateString.optional(),
});

// --- Web Push 購読（docs/design.md 15章） ---
export const pushSubscribeSchema = z.object({
  endpoint: z.string().url("endpoint はURLである必要があります"),
  p256dh: z.string().min(1),
  auth: z.string().min(1),
  user_agent: z.string().nullable().optional(),
});

export const pushUnsubscribeSchema = z.object({
  endpoint: z.string().url(),
});
