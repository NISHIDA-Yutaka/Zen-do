import type { RecurrenceRule, ReminderRule } from "@/lib/types";

// 期限表記ルール（docs/design.md 2章）:
// 当日 = 時刻のみ（時刻指定がなければ表示しない）/ 過去・未来 = 「M月D日」＋時刻あれば併記 / 超過は紅
export function formatDueLabel(
  dueDate: string | null,
  dueTime: string | null,
  today: string,
): { text: string; late: boolean } | null {
  if (!dueDate) return null;
  const time = dueTime ? dueTime.slice(0, 5) : null;
  if (dueDate === today) {
    return time ? { text: time, late: false } : null;
  }
  const [, m, d] = dueDate.split("-").map(Number);
  return {
    text: `${m}月${d}日${time ? ` ${time}` : ""}`,
    late: dueDate < today,
  };
}

// 詳細モーダル用のフル表記「7月19日（日） 15:00」
export function formatDueFull(
  dueDate: string,
  dueTime: string | null,
  today: string,
): { text: string; late: boolean } {
  const [y, m, d] = dueDate.split("-").map(Number);
  const youbi = "日月火水木金土"[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const time = dueTime ? ` ${dueTime.slice(0, 5)}` : "";
  return { text: `${m}月${d}日（${youbi}）${time}`, late: dueDate < today };
}

export function formatReminderRule(rule: ReminderRule): string {
  switch (rule.kind) {
    case "at": {
      const d = new Date(rule.at);
      // JSTで表示
      const j = new Date(d.getTime() + 9 * 3600_000);
      return `${j.getUTCMonth() + 1}/${j.getUTCDate()} ${String(j.getUTCHours()).padStart(2, "0")}:${String(j.getUTCMinutes()).padStart(2, "0")}`;
    }
    case "on_due_at":
      return `当日 ${rule.time}`;
    case "day_before_at":
      return `前日 ${rule.time}`;
    case "before_due_minutes":
      return rule.minutes % 60 === 0 ? `${rule.minutes / 60}時間前` : `${rule.minutes}分前`;
  }
}

const WEEKDAY_LABELS = ["", "月", "火", "水", "木", "金", "土", "日"];

export function formatRecurrenceRule(rule: RecurrenceRule): string {
  switch (rule.type) {
    case "daily":
      return "毎日";
    case "weekly":
      return `毎週 ${rule.weekdays.map((w) => WEEKDAY_LABELS[w]).join("・")}`;
    case "monthly_day":
      return `毎月 ${rule.day}日`;
    case "interval_days":
      return `${rule.n}日おき（${rule.from === "schedule" ? "期日基準" : "完了日基準"}）`;
  }
}
