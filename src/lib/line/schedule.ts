// 定時配信の枠（docs/line-plan.md 1章）。
// 平日は職場でアプリを見るので夕・深夜だけ、休日は朝から4回。
// 時刻はここの定数が正。変えたくなったらここだけ触る。
import { isHoliday } from "japanese-holidays";
import { isoWeekday } from "@/lib/date";

export type Slot = "morning" | "noon" | "evening" | "night";

export const SLOT_TIME: Record<Slot, string> = {
  morning: "09:00",
  noon: "13:00",
  evening: "19:00",
  night: "23:00",
};

export const ALL_SLOTS: Slot[] = ["morning", "noon", "evening", "night"];

const WEEKDAY_SLOTS: Slot[] = ["evening", "night"];
const REST_DAY_SLOTS: Slot[] = ["morning", "noon", "evening", "night"];

/**
 * 枠の時刻からこれ以上過ぎたら送らない（分）。
 * cronが止まっていた時に、朝の分が夜に届くのを防ぐ（リマインダーの24時間ルールと同じ狙い）。
 */
export const LATE_LIMIT_MIN = 120;

/** 土日または祝日（振替休日・国民の休日を含む） */
export function isRestDay(ymd: string): boolean {
  if (isoWeekday(ymd) >= 6) return true;
  const [y, m, d] = ymd.split("-").map(Number);
  // ローカル時刻でDateを組み、同じ暦日として読ませる（サーバーのTZに依存しない）
  return isHoliday(new Date(y, m - 1, d)) !== undefined;
}

export function slotsFor(restDay: boolean): Slot[] {
  return restDay ? REST_DAY_SLOTS : WEEKDAY_SLOTS;
}

function toMinutes(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
}

/**
 * 今まさに送るべき枠。時刻を過ぎていて、かつ過ぎすぎていないもの。
 * 枠同士は4時間以上離れているので、実際に複数返ることはない。
 * 深夜枠だけは日付が変わると翌日扱いになるため、実質 23:00〜23:59 の間に送られる。
 */
export function dueSlots(nowHm: string, restDay: boolean): Slot[] {
  const now = toMinutes(nowHm);
  return slotsFor(restDay).filter((slot) => {
    const elapsed = now - toMinutes(SLOT_TIME[slot]);
    return elapsed >= 0 && elapsed <= LATE_LIMIT_MIN;
  });
}
