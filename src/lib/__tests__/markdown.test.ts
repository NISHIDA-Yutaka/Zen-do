import { describe, expect, it } from "vitest";
import { normalizeIndent, notesPreview, stripMarkdown } from "@/lib/markdown";

describe("stripMarkdown", () => {
  it("見出し記号を落とす", () => {
    expect(stripMarkdown("# 引っ越しメモ")).toBe("引っ越しメモ");
    expect(stripMarkdown("### 小見出し")).toBe("小見出し");
  });
  it("強調・打ち消しを落とす", () => {
    expect(stripMarkdown("**重要**な連絡")).toBe("重要な連絡");
    expect(stripMarkdown("__太字__です")).toBe("太字です");
    expect(stripMarkdown("*斜体*です")).toBe("斜体です");
    expect(stripMarkdown("~~取り消し~~済み")).toBe("取り消し済み");
  });
  it("snake_case は壊さない", () => {
    expect(stripMarkdown("due_date を確認する")).toBe("due_date を確認する");
  });
  it("リンクはテキスト、画像はaltにする", () => {
    expect(stripMarkdown("[公式サイト](https://example.com) を見る")).toBe("公式サイト を見る");
    expect(stripMarkdown("![図の説明](/a.png)")).toBe("図の説明");
  });
  it("インラインコードの記号を落とす", () => {
    expect(stripMarkdown("`HR-2026` で申請")).toBe("HR-2026 で申請");
  });
  it("引用・箇条書き・番号・チェックリストの行頭記号を落とす", () => {
    expect(stripMarkdown("> 引用文")).toBe("引用文");
    expect(stripMarkdown("- 牛乳を買う")).toBe("牛乳を買う");
    expect(stripMarkdown("1. 最初の手順")).toBe("最初の手順");
    expect(stripMarkdown("- [ ] 未完了")).toBe("未完了");
    expect(stripMarkdown("- [x] 完了済み")).toBe("完了済み");
  });
  it("表の行はセル区切りを空白に均す", () => {
    expect(stripMarkdown("| 転出届 | 3/25 |")).toBe("転出届 3/25");
  });
});

describe("notesPreview", () => {
  it("最初の意味のある1行を返す", () => {
    expect(notesPreview("# 買い物リスト\n\n- 牛乳")).toBe("買い物リスト");
  });
  it("空行を飛ばす", () => {
    expect(notesPreview("\n\n  \n本文はここから")).toBe("本文はここから");
  });
  it("水平線・コード柵・表の区切りは中身がないので飛ばす", () => {
    expect(notesPreview("---\n\n## **買い物** リスト")).toBe("買い物 リスト");
    expect(notesPreview("```bash\necho hi\n```")).toBe("echo hi");
    expect(notesPreview("| 項目 | 締切 |\n|---|---|\n| 転出届 | 3/25 |")).toBe("項目 締切");
  });
  it("メモが空なら空文字", () => {
    expect(notesPreview("")).toBe("");
    expect(notesPreview("\n---\n")).toBe("");
  });
});

describe("normalizeIndent", () => {
  const NB = "\u00A0\u00A0";

  it("タブ付きの箇条書きは実スペースにして入れ子リストとして解釈させる", () => {
    expect(normalizeIndent("- 親\n\t- 子")).toBe("- 親\n  - 子");
    expect(normalizeIndent("\t\t- 孫")).toBe("    - 孫");
    expect(normalizeIndent("\t1. 番号")).toBe("  1. 番号");
  });

  it("箇条書き以外のタブ行は見た目のインデントを保つ空白にする", () => {
    expect(normalizeIndent("弓：魂系の弓\n\t【必須】")).toBe(`弓：魂系の弓\n${NB}【必須】`);
    expect(normalizeIndent("\t\t深い注記")).toBe(`${NB}${NB}深い注記`);
  });

  it("インデントのない行はそのまま", () => {
    expect(normalizeIndent("胴：ウィザー\n- 複製の書")).toBe("胴：ウィザー\n- 複製の書");
  });

  it("コードブロックの中身は原文のまま（タブを変換しない）", () => {
    const md = "```js\n\tconst a = 1;\n```\n\t- 外の箇条書き";
    expect(normalizeIndent(md)).toBe("```js\n\tconst a = 1;\n```\n  - 外の箇条書き");
  });

  it("報告のあったメモ（タブ＋箇条書き）がリストとして解釈される形になる", () => {
    const src = "弓：魂系の弓\n\t【必須】\n\t- 虚無\n\t- 流れ込む魂";
    expect(normalizeIndent(src)).toBe(`弓：魂系の弓\n${NB}【必須】\n  - 虚無\n  - 流れ込む魂`);
  });
});
