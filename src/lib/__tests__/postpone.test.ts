import { describe, expect, it } from "vitest";
import { shouldCountPostpone } from "@/lib/postpone";

describe("shouldCountPostpone", () => {
  it("後ろへ動かしたら数える", () => {
    expect(shouldCountPostpone("2026-09-15", "2026-09-16")).toBe(true);
    expect(shouldCountPostpone("2026-09-15", "2026-10-01")).toBe(true);
  });

  it("繰り越しを今日へ動かすのも数える（期日を過ぎて日をまたいだ時点で1回すべっている）", () => {
    expect(shouldCountPostpone("2026-09-13", "2026-09-15")).toBe(true);
  });

  it("前倒しは数えない（累積記録なので減らしも増やしもしない）", () => {
    expect(shouldCountPostpone("2026-09-20", "2026-09-16")).toBe(false);
  });

  it("同じ日なら数えない（カレンダーで時刻だけ動かした時に誤検出しないため）", () => {
    expect(shouldCountPostpone("2026-09-15", "2026-09-15")).toBe(false);
  });

  it("期日なし→設定は数えない（Inboxからの仕分けであって先送りではない）", () => {
    expect(shouldCountPostpone(null, "2026-09-16")).toBe(false);
  });

  it("期日を外すのは数えない（Inboxへ戻して再スケジュールを促す操作）", () => {
    expect(shouldCountPostpone("2026-09-15", null)).toBe(false);
    expect(shouldCountPostpone(null, null)).toBe(false);
  });

  it("月・年をまたいでも日付順で判定できる（辞書順＝時系列順）", () => {
    expect(shouldCountPostpone("2026-09-30", "2026-10-01")).toBe(true);
    expect(shouldCountPostpone("2026-12-31", "2027-01-01")).toBe(true);
    expect(shouldCountPostpone("2027-01-01", "2026-12-31")).toBe(false);
    expect(shouldCountPostpone("2026-10-01", "2026-09-30")).toBe(false);
  });
});
