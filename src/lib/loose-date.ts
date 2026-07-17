// 期日ピッカーの「ゆるい日付パース」（docs/design.md 7.3）。
// `7/19` `2026/07/19` `0719` 等を受理して 'YYYY-MM-DD' に解決する。解決できなければ null。
// カレンダーは過去日も選択可のため、ここでは年の繰り上げはしない（年省略時は基準日の年）。
import { daysInMonth } from "@/lib/date";

function build(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12) return null;
  if (d < 1 || d > daysInMonth(y, m)) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function parseLooseDate(input: string, baseYmd: string): string | null {
  const s = input.trim().replace(/[０-９／－．]/g, (c) =>
    c === "／" ? "/" : c === "－" ? "-" : c === "．" ? "." : String.fromCharCode(c.charCodeAt(0) - 0xfee0),
  );
  if (s === "") return null;
  const baseYear = Number(baseYmd.slice(0, 4));

  // 2026/07/19, 2026-7-19, 2026.7.19
  let m = s.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/);
  if (m) return build(Number(m[1]), Number(m[2]), Number(m[3]));

  // 7/19, 07-19, 7.19
  m = s.match(/^(\d{1,2})[/\-.](\d{1,2})$/);
  if (m) return build(baseYear, Number(m[1]), Number(m[2]));

  // 20260719
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) {
    const asFull = build(Number(m[1]), Number(m[2]), Number(m[3]));
    if (asFull) return asFull;
  }

  // 0719（月2桁+日2桁）
  m = s.match(/^(\d{2})(\d{2})$/);
  if (m) return build(baseYear, Number(m[1]), Number(m[2]));

  // 7月19日
  m = s.match(/^(\d{1,2})月(\d{1,2})日?$/);
  if (m) return build(baseYear, Number(m[1]), Number(m[2]));

  return null;
}
