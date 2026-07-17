// JST（Asia/Tokyo, UTC+9, DSTなし）固定の日付ユーティリティ。
// 日付は 'YYYY-MM-DD' 文字列で扱う（Postgres date 型と対応。辞書順＝時系列順）。
// docs/database-design.md 1章「タイムゾーンはJST固定」に対応。

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

/** 与えられた瞬間（既定: 現在）のJSTでの暦日を 'YYYY-MM-DD' で返す。 */
export function todayInJst(now: Date = new Date()): string {
  // UTCに+9hしてからUTC日付部を読むと、JSTの壁時計上の日付になる
  const jst = new Date(now.getTime() + JST_OFFSET_MS);
  return `${jst.getUTCFullYear()}-${pad2(jst.getUTCMonth() + 1)}-${pad2(jst.getUTCDate())}`;
}

function parseYmd(ymd: string): [number, number, number] {
  const [y, m, d] = ymd.split("-").map(Number);
  return [y, m, d];
}

function formatYmd(y: number, m: number, d: number): string {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/** 'YYYY-MM-DD' にn日加算（負も可）した 'YYYY-MM-DD' を返す。 */
export function addDays(ymd: string, n: number): string {
  const [y, m, d] = parseYmd(ymd);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return formatYmd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/** ISO曜日（1=月 … 7=日）を返す。 */
export function isoWeekday(ymd: string): number {
  const [y, m, d] = parseYmd(ymd);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=日 … 6=土
  return dow === 0 ? 7 : dow;
}

/** その年月の日数（m は1-12）。 */
export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** 指定日を月末にクランプ（例: 2月に31を渡すと28/29）。 */
export function clampDayToMonth(y: number, m: number, day: number): number {
  return Math.min(day, daysInMonth(y, m));
}

/** 'YYYY-MM-DD' の大小比較（辞書順で正しい）。a<b:-1, a=b:0, a>b:1 */
export function compareYmd(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 2つの 'YYYY-MM-DD' のうち遅い方を返す。 */
export function maxYmd(a: string, b: string): string {
  return a >= b ? a : b;
}

/** その日を含む週の月曜日（週n回習慣・カレンダーと同じ月曜はじまり）。 */
export function weekStartMonday(ymd: string): string {
  return addDays(ymd, -(isoWeekday(ymd) - 1));
}

/**
 * JSTの壁時計時刻（date='YYYY-MM-DD', time='HH:MM' or 'HH:MM:SS'）を
 * 絶対時刻（UTCのISO文字列）に変換する。remind_at の算出に使う。
 */
export function jstWallClockToIso(date: string, time: string): string {
  const hhmmss = time.length === 5 ? `${time}:00` : time;
  return new Date(`${date}T${hhmmss}+09:00`).toISOString();
}
