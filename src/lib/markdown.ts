// Markdownの装飾記号を落として素のテキストにする（一覧の1行プレビュー用・docs/design.md 13.4）。
// 本文のレンダリングは react-markdown に任せ、ここは「記号が混ざらない読める1行」を作るだけ。

// それ自体に中身がない行はプレビューに出さない。
// コード柵は ```bash のように言語名が付くため行頭一致で判定する。
const FENCE_LINE = /^(```|~~~)/;
const NO_CONTENT_LINE = /^(-{3,}|\*{3,}|_{3,}|\|?[\s:|-]+\|[\s:|-]*)$/;

export function stripMarkdown(line: string): string {
  let s = line.trim();
  // 表の行はセル区切りを空白に均す
  if (s.startsWith("|")) s = s.replace(/^\||\|$/g, "").replace(/\s*\|\s*/g, " ");
  return s
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1") // 画像 → alt
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // リンク → テキスト
    .replace(/`([^`]*)`/g, "$1") // インラインコード
    .replace(/^\s{0,3}>+\s?/, "") // 引用
    .replace(/^\s{0,3}#{1,6}\s+/, "") // 見出し
    .replace(/^\s*[-*+]\s+\[[ xX]\]\s*/, "") // チェックリスト
    .replace(/^\s*[-*+]\s+/, "") // 箇条書き
    .replace(/^\s*\d+[.)]\s+/, "") // 番号リスト
    .replace(/(\*\*|__)(.+?)\1/g, "$2") // 太字
    .replace(/\*(.+?)\*/g, "$1") // 斜体（_ は snake_case を壊すので対象外）
    .replace(/~~(.+?)~~/g, "$1") // 打ち消し
    .trim();
}

/** メモ本文から、行プレビューに出す最初の意味のある1行を作る。 */
export function notesPreview(notes: string): string {
  for (const raw of notes.split("\n")) {
    const line = raw.trim();
    if (!line || FENCE_LINE.test(line) || NO_CONTENT_LINE.test(line)) continue;
    const text = stripMarkdown(line);
    if (text) return text;
  }
  return "";
}

// 行頭のタブによるインデントを、Markdownとして意図どおりに解釈させる（docs/design.md 13.4）。
// Markdownでは行頭タブ＝スペース4つ＝コードブロックの深さで、かつコードブロックは段落を
// 中断できないため、素のままだと「タブ＋箇条書き」が前の段落に吸収されリストにならない。
// タブ1つを1段として、箇条書きは実スペース（入れ子リストとして解釈させる）、
// それ以外の行は解析時に捨てられない空白（NBSP）に変換して見た目のインデントを残す。
const LIST_MARKER = /^([-*+]|\d+[.)])\s/;
const INDENT_UNIT = "  ";
const VISUAL_INDENT_UNIT = "\u00A0\u00A0";

export function normalizeIndent(md: string): string {
  let inFence = false;
  return md
    .split("\n")
    .map((line) => {
      if (FENCE_LINE.test(line.trim())) {
        inFence = !inFence;
        return line;
      }
      if (inFence) return line; // コードブロックの中身は原文のまま
      const m = /^(\t+)(.*)$/.exec(line);
      if (!m) return line;
      const [, tabs, rest] = m;
      const unit = LIST_MARKER.test(rest) ? INDENT_UNIT : VISUAL_INDENT_UNIT;
      return unit.repeat(tabs.length) + rest;
    })
    .join("\n");
}
