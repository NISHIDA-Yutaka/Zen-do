// 期日ピッカーのPC向け「ゆるい時刻パース」。
// `17:00` `1700` `17` `9:5` `17時30分` 等を受理して 'HH:MM' に解決する。解決できなければ null。
export function parseLooseTime(input: string): string | null {
  const s = input
    .trim()
    .replace(/[０-９：]/g, (c) =>
      c === "：" ? ":" : String.fromCharCode(c.charCodeAt(0) - 0xfee0),
    );
  if (s === "") return null;

  let h: number;
  let mn: number;
  let m: RegExpMatchArray | null;

  if ((m = s.match(/^(\d{1,2}):(\d{1,2})$/))) {
    h = Number(m[1]);
    mn = Number(m[2]);
  } else if ((m = s.match(/^(\d{1,2})時(\d{1,2})分?$/))) {
    h = Number(m[1]);
    mn = Number(m[2]);
  } else if ((m = s.match(/^(\d{1,2})時$/))) {
    h = Number(m[1]);
    mn = 0;
  } else if ((m = s.match(/^(\d{4})$/))) {
    h = Number(m[1].slice(0, 2));
    mn = Number(m[1].slice(2));
  } else if ((m = s.match(/^(\d{3})$/))) {
    h = Number(m[1].slice(0, 1));
    mn = Number(m[1].slice(1));
  } else if ((m = s.match(/^(\d{1,2})$/))) {
    h = Number(m[1]);
    mn = 0;
  } else {
    return null;
  }

  if (h > 23 || mn > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(mn).padStart(2, "0")}`;
}
