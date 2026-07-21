// Smart Input パーサ（純粋関数）。docs/design.md 11章。
// 入力文から 期日/時刻/タグ/プロジェクト を解釈し、残りをタイトルにする。
// 解釈は「プレビュー→確定」のためトークン単位で返し、UI側で個別に取り消せる。
import { addDays, daysInMonth, isoWeekday } from "@/lib/date";

export type TokenKind = "date" | "time" | "tag" | "project";

export type SmartToken = {
  kind: TokenKind;
  raw: string; // 入力文中の該当文字列（取り消し時にタイトルへ戻す）
  start: number;
  end: number;
  label: string; // チップ表示用
  value: string; // date='YYYY-MM-DD' / time='HH:MM' / tag=タグ名 / project=プロジェクトid
};

export type SmartParseResult = {
  title: string;
  dueDate: string | null;
  dueTime: string | null;
  tags: string[];
  projectId: string | null;
  tokens: SmartToken[];
  /** `!` の直後を入力中の場合のサジェスト用クエリ（nullなら非表示） */
  projectQuery: { query: string; start: number; end: number } | null;
};

export type ProjectRef = { id: string; title: string };

const WEEKDAY_WORDS: Record<string, number> = {
  月: 1, 火: 2, 水: 3, 木: 4, 金: 5, 土: 6, 日: 7,
};

function ymd(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** M/D・M月D日 を解決。過去日なら翌年に繰り上げる（docs/design.md 11.2）。 */
function resolveMonthDay(month: number, day: number, today: string): string | null {
  if (month < 1 || month > 12) return null;
  const year = Number(today.slice(0, 4));
  if (day < 1 || day > daysInMonth(year, month)) return null;
  const candidate = ymd(year, month, day);
  if (candidate >= today) return candidate;
  const next = year + 1;
  if (day > daysInMonth(next, month)) return null;
  return ymd(next, month, day);
}

/** 必ず未来の直近のその曜日（今日は含まない）。 */
function resolveWeekday(weekday: number, today: string): string {
  const current = isoWeekday(today);
  const delta = ((weekday - current + 7) % 7) || 7;
  return addDays(today, delta);
}

type Matcher = {
  re: RegExp;
  build: (m: RegExpExecArray, today: string) => Omit<SmartToken, "raw" | "start" | "end"> | null;
};

// 日付マッチャ（先に来たものを1つだけ採用）
const DATE_MATCHERS: Matcher[] = [
  {
    re: /明後日/g,
    build: (_m, today) => {
      const v = addDays(today, 2);
      return { kind: "date", label: `明後日 ${labelOf(v)}`, value: v };
    },
  },
  {
    re: /明日/g,
    build: (_m, today) => {
      const v = addDays(today, 1);
      return { kind: "date", label: `明日 ${labelOf(v)}`, value: v };
    },
  },
  {
    re: /今日/g,
    build: (_m, today) => ({ kind: "date", label: `今日 ${labelOf(today)}`, value: today }),
  },
  {
    re: /(\d{1,2})月(\d{1,2})日?/g,
    build: (m, today) => {
      const v = resolveMonthDay(Number(m[1]), Number(m[2]), today);
      return v ? { kind: "date", label: labelOf(v), value: v } : null;
    },
  },
  {
    // 12:00 のような時刻と衝突しないよう / 区切りのみ
    re: /(?<![\d/])(\d{1,2})\/(\d{1,2})(?![\d/])/g,
    build: (m, today) => {
      const v = resolveMonthDay(Number(m[1]), Number(m[2]), today);
      return v ? { kind: "date", label: labelOf(v), value: v } : null;
    },
  },
  {
    re: /([月火水木金土日])曜日?/g,
    build: (m, today) => {
      const v = resolveWeekday(WEEKDAY_WORDS[m[1]], today);
      return { kind: "date", label: `${m[1]}曜 ${labelOf(v)}`, value: v };
    },
  },
];

// 時刻マッチャ
const TIME_MATCHERS: Matcher[] = [
  {
    re: /(\d{1,2}):([0-5]\d)/g,
    build: (m) => {
      const h = Number(m[1]);
      if (h > 23) return null;
      const v = `${pad2(h)}:${m[2]}`;
      return { kind: "time", label: v, value: v };
    },
  },
  {
    re: /(\d{1,2})時半/g,
    build: (m) => {
      const h = Number(m[1]);
      if (h > 23) return null;
      const v = `${pad2(h)}:30`;
      return { kind: "time", label: v, value: v };
    },
  },
  {
    re: /(\d{1,2})時(?!間)/g,
    build: (m) => {
      const h = Number(m[1]);
      if (h > 23) return null;
      const v = `${pad2(h)}:00`;
      return { kind: "time", label: v, value: v };
    },
  },
];

function labelOf(ymdStr: string): string {
  return `${Number(ymdStr.slice(5, 7))}/${Number(ymdStr.slice(8))}`;
}

/** マッチャ群から最初に出現する1件だけを取る（docs/design.md 11.2: 日付・時刻は最初の1つだけ）。 */
function firstMatch(text: string, matchers: Matcher[], today: string): SmartToken | null {
  let best: SmartToken | null = null;
  for (const { re, build } of matchers) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const built = build(m, today);
      if (!built) continue;
      const token: SmartToken = { ...built, raw: m[0], start: m.index, end: m.index + m[0].length };
      if (best === null || token.start < best.start) best = token;
      break;
    }
  }
  return best;
}

export function parseSmartInput(
  text: string,
  opts: { today: string; projects?: ProjectRef[]; cancelled?: string[] },
): SmartParseResult {
  const projects = opts.projects ?? [];
  const cancelled = new Set(opts.cancelled ?? []);
  const tokens: SmartToken[] = [];

  const dateToken = firstMatch(text, DATE_MATCHERS, opts.today);
  const timeToken = firstMatch(text, TIME_MATCHERS, opts.today);

  // 日付と時刻の範囲が重なる場合は日付を優先（例: 8/16 が時刻に誤マッチしないための保険）
  const overlaps =
    dateToken && timeToken && timeToken.start < dateToken.end && dateToken.start < timeToken.end;

  if (dateToken && !cancelled.has(tokenKey(dateToken))) tokens.push(dateToken);
  if (timeToken && !overlaps && !cancelled.has(tokenKey(timeToken))) tokens.push(timeToken);

  // タグ（複数可）
  const tagRe = /#([^\s#!]+)/g;
  let tm: RegExpExecArray | null;
  while ((tm = tagRe.exec(text)) !== null) {
    const t: SmartToken = {
      kind: "tag",
      raw: tm[0],
      start: tm.index,
      end: tm.index + tm[0].length,
      label: `#${tm[1]}`,
      value: tm[1],
    };
    if (!cancelled.has(tokenKey(t))) tokens.push(t);
  }

  // !プロジェクト（一意に部分一致したときだけ解釈）
  let projectQuery: SmartParseResult["projectQuery"] = null;
  const projRe = /!([^\s#!]*)/g;
  let pm: RegExpExecArray | null;
  while ((pm = projRe.exec(text)) !== null) {
    const q = pm[1];
    const start = pm.index;
    const end = pm.index + pm[0].length;
    // 入力末尾に接している場合はサジェスト対象
    if (end === text.length) projectQuery = { query: q, start, end };
    if (q === "") continue;
    const hits = projects.filter((p) => p.title.includes(q));
    if (hits.length === 1) {
      const t: SmartToken = {
        kind: "project",
        raw: pm[0],
        start,
        end,
        label: `!${hits[0].title}`,
        value: hits[0].id,
      };
      if (!cancelled.has(tokenKey(t))) tokens.push(t);
    }
  }

  // タイトル = 採用トークンを除いた残り
  const active = [...tokens].sort((a, b) => a.start - b.start);
  let title = "";
  let cursor = 0;
  for (const t of active) {
    if (t.start < cursor) continue; // 重なりは無視
    title += text.slice(cursor, t.start);
    cursor = t.end;
  }
  title += text.slice(cursor);
  title = title.replace(/\s+/g, " ").trim();

  const date = active.find((t) => t.kind === "date");
  const time = active.find((t) => t.kind === "time");
  const project = active.find((t) => t.kind === "project");

  return {
    title,
    // 時刻だけの指定は当日とみなす（docs/design.md 11.2）
    dueDate: date?.value ?? (time ? opts.today : null),
    dueTime: time?.value ?? null,
    tags: active.filter((t) => t.kind === "tag").map((t) => t.value),
    projectId: project?.value ?? null,
    tokens: active,
    projectQuery,
  };
}

/** 取り消し済み判定用のキー（同じ文字列・位置なら同一トークン）。 */
export function tokenKey(t: SmartToken): string {
  return `${t.kind}:${t.start}:${t.raw}`;
}
