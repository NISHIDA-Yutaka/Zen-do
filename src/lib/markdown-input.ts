// メモ編集欄のMarkdown入力補助（docs/design.md 13.4）。textareaの値と選択位置から「どこを何に置き換えるか」を返す。
// DOM操作は呼び出し側（execCommand で差し込み、取り消し履歴を保つ）。

export type TextEdit = { from: number; to: number; insert: string; cursor: number };

// 字下げ / 箇条書き記号＋空白＋任意のチェックボックス / 番号＋区切り＋空白
const LIST_ITEM = /^([\t ]*)(?:([-*+])( +)(\[[ xX]\] +)?|(\d{1,9})([.)])( +))/;

type ListItem = {
  indent: string;
  /** 行頭から記号の直後（本文の開始位置）までの長さ */
  markerLength: number;
  /** 次の行に引き継ぐ記号（チェックは外し、番号は+1する） */
  nextMarker: string;
  number: number | null;
  delimiter: string | null;
};

function parseListItem(line: string): ListItem | null {
  const m = LIST_ITEM.exec(line);
  if (!m) return null;
  const [whole, indent, bullet, bulletSpace, checkbox, num, delimiter, numSpace] = m;
  if (bullet) {
    return {
      indent,
      markerLength: whole.length,
      nextMarker: `${indent}${bullet}${bulletSpace}${checkbox ? "[ ] " : ""}`,
      number: null,
      delimiter: null,
    };
  }
  const next = Number(num) + 1;
  return {
    indent,
    markerLength: whole.length,
    nextMarker: `${indent}${next}${delimiter}${numSpace}`,
    number: Number(num),
    delimiter,
  };
}

function lineRange(value: string, pos: number): { start: number; end: number } {
  const start = value.lastIndexOf("\n", pos - 1) + 1;
  const nl = value.indexOf("\n", pos);
  return { start, end: nl === -1 ? value.length : nl };
}

// 途中に項目を差し込んだとき、同じ字下げで続く番号を詰め直す。
// より深い字下げの行（入れ子・続きの文）は飛ばし、同じ深さの番号付き以外が来たらそこでリストの終わりとみなす
function renumberFollowing(tail: string, indent: string, delimiter: string, from: number): string {
  const lines = tail.split("\n");
  let expected = from;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith(indent) && /^[\t ]/.test(line.slice(indent.length))) continue;
    const item = parseListItem(line);
    if (!item || item.indent !== indent || item.number === null || item.delimiter !== delimiter) break;
    if (item.number === expected) break; // ここから先は既に連番になっている
    lines[i] = line.replace(/^([\t ]*)\d+/, `$1${expected}`);
    expected += 1;
  }
  return lines.join("\n");
}

/**
 * リストの行で改行したときの編集。リストの行でなければ null（通常の改行に任せる）。
 * 中身が空の項目での改行は、記号を消してリストを抜ける
 */
export function continueList(value: string, selStart: number, selEnd: number): TextEdit | null {
  if (selStart !== selEnd) return null;
  const { start, end } = lineRange(value, selStart);
  const item = parseListItem(value.slice(start, end));
  // 記号の途中や手前での改行は、行ごと下へずらしたいだけなので補助しない
  if (!item || selStart < start + item.markerLength) return null;

  if (value.slice(start + item.markerLength, end).trim() === "") {
    return { from: start, to: end, insert: "", cursor: start };
  }

  const head = `\n${item.nextMarker}`;
  const cursor = selStart + head.length;
  if (item.number === null || item.delimiter === null) {
    return { from: selStart, to: selStart, insert: head, cursor };
  }
  // 番号付きは後続の番号も詰め直すため、行末以降を差し替える
  const tail = value.slice(end);
  const renumbered = renumberFollowing(
    tail.startsWith("\n") ? tail.slice(1) : tail,
    item.indent,
    item.delimiter,
    item.number + 2,
  );
  const rest = tail.startsWith("\n") ? `\n${renumbered}` : renumbered;
  if (rest === tail) return { from: selStart, to: selStart, insert: head, cursor };
  return {
    from: selStart,
    to: value.length,
    insert: head + value.slice(selStart, end) + rest,
    cursor,
  };
}

/**
 * 記号の直後でのBackspace。記号（チェックボックス込み）をまとめて消して普通の行に戻す。
 * 字下げは残す（もう一度Backspaceで1段ずつ戻せる）。該当しなければ null
 */
export function removeListMarker(value: string, selStart: number, selEnd: number): TextEdit | null {
  if (selStart !== selEnd) return null;
  const { start, end } = lineRange(value, selStart);
  const item = parseListItem(value.slice(start, end));
  if (!item || selStart !== start + item.markerLength) return null;
  const from = start + item.indent.length;
  return { from, to: selStart, insert: "", cursor: from };
}

// 1段下げた/上げた番号付き項目の番号。上に同じ深さの番号付き項目があれば続きの番号、なければ1から
function numberAt(before: string, indent: string): number {
  const lines = before.split("\n").slice(0, -1).reverse();
  for (const line of lines) {
    if (line.startsWith(indent) && /^[\t ]/.test(line.slice(indent.length))) continue;
    const item = parseListItem(line);
    return item && item.indent === indent && item.number !== null ? item.number + 1 : 1;
  }
  return 1;
}

/**
 * リストの行でのTab / Shift+Tab。カーソルの位置に関係なく行全体を1段（タブ1つ）下げる/上げる。
 * 記号の後ろにタブが入って入れ子にならないのを防ぐため。リストの行でなければ null
 */
export function shiftListItem(
  value: string,
  selStart: number,
  selEnd: number,
  outdent: boolean,
): TextEdit | null {
  if (selStart !== selEnd) return null;
  const { start, end } = lineRange(value, selStart);
  const line = value.slice(start, end);
  const item = parseListItem(line);
  if (!item) return null;

  const removed = /^(\t| {1,2})/.exec(item.indent);
  if (outdent && !removed) return null;
  const indent = outdent && removed ? item.indent.slice(removed[0].length) : `\t${item.indent}`;
  const body = line.slice(item.indent.length);
  const next =
    indent +
    (item.number === null
      ? body
      : body.replace(/^\d+/, String(numberAt(value.slice(0, start), indent))));
  const cursor = Math.max(start + indent.length, selStart + next.length - line.length);
  return { from: start, to: end, insert: next, cursor };
}

