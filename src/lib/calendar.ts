// カレンダー表示用の変換（docs/calendar-plan.md 4章）。
// FullCalendarに渡す形へItemを写すだけの純関数群。DOM・ライブラリに依存させないことでテスト可能にする。
import { addDays } from "@/lib/date";
import type { Item } from "@/lib/types";

// 未見積り（duration_min=null）の時間ブロックはこの長さで仮描画する
export const DEFAULT_BLOCK_MIN = 30;

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end?: string;
  allDay: boolean;
  editable: boolean;
  // 終日欄のイベントは横に伸ばせてしまうが、日をまたぐ長さは表現できないので禁じる
  durationEditable: boolean;
  classNames: string[];
  // 所要時間が未設定＝仮の長さで描いていることを行側で示すためのフラグ
  extendedProps: { estimated: boolean; status: Item["status"] };
}

// "14:00:00" / "14:00" → "14:00"
function hm(time: string): string {
  return time.slice(0, 5);
}

/** 開始日時にn分足した日時を返す。日跨ぎは暦日を繰り上げる（"YYYY-MM-DD", "HH:MM" → 同形式） */
export function addMinutes(
  date: string,
  time: string,
  minutes: number,
): { date: string; time: string } {
  const [h, m] = hm(time).split(":").map(Number);
  const total = h * 60 + m + minutes;
  const dayShift = Math.floor(total / 1440);
  const rest = ((total % 1440) + 1440) % 1440;
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: dayShift === 0 ? date : addDays(date, dayShift),
    time: `${pad(Math.floor(rest / 60))}:${pad(rest % 60)}`,
  };
}

// 習慣・完了・期限超過を色分けする（配色は globals.css の --fc-* とクラスで指定）
function classesFor(item: Item, today: string): string[] {
  if (item.status === "done") return ["zd-ev", "zd-ev-done"];
  if (item.habit_id) return ["zd-ev", "zd-ev-habit"];
  if (item.due_date && item.due_date < today) return ["zd-ev", "zd-ev-overdue"];
  return ["zd-ev"];
}

/** Item 1件をFullCalendarのイベントへ。due_dateが無いものは描けないのでnull */
export function toEvent(item: Item, today: string): CalendarEvent | null {
  if (!item.due_date) return null;
  const done = item.status === "done";
  const base = {
    id: item.id,
    title: item.title,
    // 完了済みは動かせない（履歴なので docs/calendar-plan.md 5章）
    editable: !done,
    classNames: classesFor(item, today),
  };

  // 時刻なし＝終日欄。時間ブロックにはしない
  if (!item.due_time) {
    return {
      ...base,
      start: item.due_date,
      allDay: true,
      durationEditable: false,
      extendedProps: { estimated: false, status: item.status },
    };
  }

  const start = hm(item.due_time);
  const estimated = item.duration_min == null;
  const end = addMinutes(item.due_date, start, item.duration_min ?? DEFAULT_BLOCK_MIN);
  return {
    ...base,
    start: `${item.due_date}T${start}:00`,
    end: `${end.date}T${end.time}:00`,
    allDay: false,
    durationEditable: !done,
    extendedProps: { estimated, status: item.status },
  };
}

export function toEvents(items: Item[], today: string): CalendarEvent[] {
  return items.flatMap((i) => toEvent(i, today) ?? []);
}

/** 表示範囲のitems取得キー。完了分も描くので statuses を明示する（docs/calendar-plan.md 2章） */
export function rangeQuery(from: string, to: string): string {
  return `/api/items?kind=todo&statuses=todo,done&due_from=${from}&due_to=${to}`;
}

/** リサイズ後の長さ（分）。DBのCHECK制約（1〜1440）に収まるよう丸める */
export function durationFromRange(start: Date, end: Date): number {
  const minutes = Math.round((end.getTime() - start.getTime()) / 60_000);
  return Math.min(1440, Math.max(1, minutes));
}
