import { describe, expect, it } from "vitest";
import { encodeAction, type LineAction, parseAction } from "@/lib/line/postback";

const ID = "024876f0-909b-43aa-8d15-7b8872da1880";

describe("encodeAction / parseAction", () => {
  const cases: LineAction[] = [
    { kind: "done", id: ID },
    { kind: "tmr", id: ID },
    { kind: "big", id: ID },
    { kind: "stuck", id: ID },
    { kind: "drop", id: ID },
    { kind: "hab_add", id: ID },
    { kind: "hab_done", id: ID },
    { kind: "alltmr" },
    { kind: "habits" },
  ];

  it("符号化して読み戻すと同じ操作になる", () => {
    for (const action of cases) {
      expect(parseAction(encodeAction(action))).toEqual(action);
    }
  });

  it("LINEの上限300文字に収まる", () => {
    for (const action of cases) {
      expect(encodeAction(action).length).toBeLessThanOrEqual(300);
    }
  });

  it("全体操作にはidを載せない", () => {
    expect(encodeAction({ kind: "alltmr" })).toBe("a=alltmr");
  });
});

describe("parseAction が受け付けないもの", () => {
  it("知らない操作", () => {
    expect(parseAction("a=nonsense")).toBeNull();
    expect(parseAction(`a=delete&id=${ID}`)).toBeNull();
  });

  it("対象idの無い個別操作（誤爆を防ぐ）", () => {
    expect(parseAction("a=done")).toBeNull();
    expect(parseAction("a=tmr&id=")).toBeNull();
    expect(parseAction("a=hab_add")).toBeNull();
    expect(parseAction("a=big")).toBeNull();
    expect(parseAction("a=drop&id=")).toBeNull();
    expect(parseAction("a=hab_done&id=")).toBeNull();
  });

  it("空文字やゴミ", () => {
    expect(parseAction("")).toBeNull();
    expect(parseAction("これはデータではない")).toBeNull();
  });
});
