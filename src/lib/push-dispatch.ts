// リマインダー配信の判定ロジック（純粋関数）。仕様は docs/design.md 15章。
// DBアクセスとweb-push送信は /api/cron/reminders 側に置き、ここは入力→判定だけを担う。

import { formatDueFull, formatReminderRule } from "@/lib/format";
import type { Item, Reminder } from "@/lib/types";

/** これより古い発火予定は送らずに捨てる（cron停止からの復帰時に大量に鳴るのを防ぐ） */
export const STALE_MS = 24 * 60 * 60 * 1000;

export type DispatchRow = { reminder: Reminder; item: Item | undefined };

export type DispatchDecision = {
  toSend: { reminder: Reminder; item: Item }[];
  /** 送らずに握り潰す分。理由は運用ログ用 */
  toDiscard: { reminder: Reminder; reason: DiscardReason }[];
};

export type DiscardReason = "item_missing" | "item_not_todo" | "stale";

/** 実際に発火すべき時刻。スヌーズされていればそちらが優先される。 */
export function effectiveFireAt(reminder: Reminder): number {
  return new Date(reminder.snoozed_until ?? reminder.remind_at).getTime();
}

/**
 * 発火対象を「送る」「捨てる」に仕分ける。
 * 完了・破棄済みタスクの通知が後から鳴る問題をここで一元的に塞ぐ
 * （complete/drop 側はリマインダーを触らない。docs/design.md 15.4）。
 */
export function classifyReminders(rows: DispatchRow[], now: Date): DispatchDecision {
  const decision: DispatchDecision = { toSend: [], toDiscard: [] };
  for (const { reminder, item } of rows) {
    if (!item) {
      decision.toDiscard.push({ reminder, reason: "item_missing" });
    } else if (item.status !== "todo") {
      decision.toDiscard.push({ reminder, reason: "item_not_todo" });
    } else if (now.getTime() - effectiveFireAt(reminder) > STALE_MS) {
      decision.toDiscard.push({ reminder, reason: "stale" });
    } else {
      decision.toSend.push({ reminder, item });
    }
  }
  return decision;
}

export type PushPayload = {
  title: string;
  body: string;
  /** 同一タスクの通知を上書きして通知欄を溢れさせない */
  tag: string;
  /** これがある通知だけ「完了」ボタンを出す（テスト通知には付かない） */
  itemId?: string;
  url: string;
};

/** 通知の中身。本文は「期日 ・ ルール表記」（例: 7月23日（木） 15:00 ・ 1時間前）。 */
export function buildPushPayload(item: Item, reminder: Reminder, today: string): PushPayload {
  const due = item.due_date ? formatDueFull(item.due_date, item.due_time, today).text : null;
  const rule = formatReminderRule(reminder.rule);
  return {
    title: item.title,
    body: due ? `${due} ・ ${rule}` : rule,
    tag: item.id,
    itemId: item.id,
    url: `/today?item=${item.id}`,
  };
}
