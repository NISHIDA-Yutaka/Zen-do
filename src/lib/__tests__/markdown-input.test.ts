import { describe, expect, it } from "vitest";
import {
  continueList,
  removeListMarker,
  shiftListItem,
  type TextEdit,
} from "@/lib/markdown-input";

// "|" の位置をカーソルとして、編集を適用した結果（カーソル位置も "|" で示す）を返す
function apply(fn: (v: string, s: number, e: number) => TextEdit | null, withCursor: string) {
  const pos = withCursor.indexOf("|");
  const value = withCursor.replace("|", "");
  const edit = fn(value, pos, pos);
  if (!edit) return null;
  const next = value.slice(0, edit.from) + edit.insert + value.slice(edit.to);
  return next.slice(0, edit.cursor) + "|" + next.slice(edit.cursor);
}

const enter = (s: string) => apply(continueList, s);
const backspace = (s: string) => apply(removeListMarker, s);
const tab = (s: string) => apply((v, a, b) => shiftListItem(v, a, b, false), s);
const shiftTab = (s: string) => apply((v, a, b) => shiftListItem(v, a, b, true), s);

describe("continueList", () => {
  it("箇条書きの記号を次の行に引き継ぐ", () => {
    expect(enter("- 牛乳|")).toBe("- 牛乳\n- |");
    expect(enter("* a|")).toBe("* a\n* |");
    expect(enter("+ a|")).toBe("+ a\n+ |");
  });

  it("字下げ（タブ・スペース）を引き継ぐ", () => {
    expect(enter("- 親\n\t- 子|")).toBe("- 親\n\t- 子\n\t- |");
    expect(enter("  - 子|")).toBe("  - 子\n  - |");
  });

  it("チェックボックスは未チェックで引き継ぐ", () => {
    expect(enter("- [x] 済み|")).toBe("- [x] 済み\n- [ ] |");
    expect(enter("- [ ] 未|")).toBe("- [ ] 未\n- [ ] |");
  });

  it("番号付きは+1して引き継ぐ（区切りの . と ) を保つ）", () => {
    expect(enter("1. a|")).toBe("1. a\n2. |");
    expect(enter("9) a|")).toBe("9) a\n10) |");
    expect(enter("\t3. a|")).toBe("\t3. a\n\t4. |");
  });

  it("途中に差し込むと、同じ深さで続く番号を詰め直す", () => {
    expect(enter("1. a|\n2. b\n3. c")).toBe("1. a\n2. |\n3. b\n4. c");
  });

  it("詰め直しは入れ子の行を飛ばし、リストの外には及ばない", () => {
    expect(enter("1. a|\n2. b\n\t1. 子\n3. c\n\n1. 別")).toBe(
      "1. a\n2. |\n3. b\n\t1. 子\n4. c\n\n1. 別",
    );
  });

  it("後ろが既に連番なら詰め直さない", () => {
    expect(enter("1. a\n2. b|\n4. c")).toBe("1. a\n2. b\n3. |\n4. c");
  });

  it("行の途中で改行すると、カーソル以降が新しい項目に移る", () => {
    expect(enter("- 牛乳|と卵")).toBe("- 牛乳\n- |と卵");
    expect(enter("1. a|b\n2. c")).toBe("1. a\n2. |b\n3. c");
  });

  it("中身が空の項目で改行すると、記号を消してリストを抜ける", () => {
    expect(enter("- a\n- |")).toBe("- a\n|");
    expect(enter("- a\n\t- |")).toBe("- a\n|");
    expect(enter("1. a\n2. |")).toBe("1. a\n|");
  });

  it("リストでない行・記号の手前・範囲選択は補助しない", () => {
    expect(enter("ふつうの文|")).toBeNull();
    expect(enter("-ハイフン始まり|")).toBeNull();
    expect(enter("|- a")).toBeNull();
    expect(continueList("- a", 0, 3)).toBeNull();
  });
});

describe("removeListMarker", () => {
  it("記号の直後なら記号をまとめて消す", () => {
    expect(backspace("- a\n- |")).toBe("- a\n|");
    expect(backspace("- [ ] |")).toBe("|");
    expect(backspace("12. |")).toBe("|");
  });

  it("字下げは残す（もう一度Backspaceで戻せる）", () => {
    expect(backspace("\t- |")).toBe("\t|");
  });

  it("本文の途中や記号の外では通常のBackspaceに任せる", () => {
    expect(backspace("- a|")).toBeNull();
    expect(backspace("-| a")).toBeNull();
    expect(backspace("ふつう|")).toBeNull();
  });
});

describe("shiftListItem", () => {
  it("Tabは記号の後ろではなく行頭に字下げを入れる", () => {
    expect(tab("- a\n- |")).toBe("- a\n\t- |");
    expect(tab("- a\n- b|c")).toBe("- a\n\t- b|c");
  });

  it("入れ子にした番号は、上に同じ深さの番号付きがなければ1から", () => {
    expect(tab("1. a\n2. b\n3. |")).toBe("1. a\n2. b\n\t1. |");
  });

  it("上に同じ深さの番号付きがあれば続きの番号", () => {
    expect(tab("1. a\n\t1. x\n\t2. y\n2. |")).toBe("1. a\n\t1. x\n\t2. y\n\t3. |");
  });

  it("Shift+Tabは1段戻し、番号は戻った先の続きにする", () => {
    expect(shiftTab("1. a\n2. b\n\t1. |")).toBe("1. a\n2. b\n3. |");
    expect(shiftTab("\t\t- |")).toBe("\t- |");
    expect(shiftTab("  - |")).toBe("- |");
  });

  it("字下げのない行のShift+Tab・リストでない行・範囲選択は対象外", () => {
    expect(shiftTab("- |")).toBeNull();
    expect(tab("ふつう|")).toBeNull();
    expect(shiftListItem("- a", 0, 3, false)).toBeNull();
  });
});
