import { describe, expect, it } from "vitest";
import { parseLooseTime } from "@/lib/loose-time";

describe("parseLooseTime", () => {
  it("HH:MM をそのまま受理", () => {
    expect(parseLooseTime("17:00")).toBe("17:00");
    expect(parseLooseTime("09:30")).toBe("09:30");
  });

  it("1〜2桁の時・分をゼロ埋めする", () => {
    expect(parseLooseTime("9:5")).toBe("09:05");
    expect(parseLooseTime("7:0")).toBe("07:00");
  });

  it("コロンなし4桁を HH:MM に解釈", () => {
    expect(parseLooseTime("1700")).toBe("17:00");
    expect(parseLooseTime("0930")).toBe("09:30");
  });

  it("コロンなし3桁を H:MM に解釈", () => {
    expect(parseLooseTime("930")).toBe("09:30");
  });

  it("時のみ（1〜2桁）は00分にする", () => {
    expect(parseLooseTime("17")).toBe("17:00");
    expect(parseLooseTime("7")).toBe("07:00");
  });

  it("日本語表記を受理", () => {
    expect(parseLooseTime("17時30分")).toBe("17:30");
    expect(parseLooseTime("17時")).toBe("17:00");
    expect(parseLooseTime("9時5分")).toBe("09:05");
  });

  it("全角数字・全角コロンを正規化", () => {
    expect(parseLooseTime("０９：３０")).toBe("09:30");
    expect(parseLooseTime("１７")).toBe("17:00");
  });

  it("前後の空白を無視", () => {
    expect(parseLooseTime(" 7:00 ")).toBe("07:00");
  });

  it("範囲外・不正入力は null", () => {
    expect(parseLooseTime("25:00")).toBeNull();
    expect(parseLooseTime("12:60")).toBeNull();
    expect(parseLooseTime("abc")).toBeNull();
    expect(parseLooseTime("")).toBeNull();
    expect(parseLooseTime("   ")).toBeNull();
  });
});
