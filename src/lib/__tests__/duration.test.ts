import { describe, expect, it } from "vitest";
import { MAX_DURATION_MIN, parseDuration } from "@/lib/duration";

describe("parseDuration", () => {
  it("分だけ", () => {
    expect(parseDuration("5m")).toBe(5);
    expect(parseDuration("90m")).toBe(90);
  });

  it("時だけ", () => {
    expect(parseDuration("1h")).toBe(60);
    expect(parseDuration("2h")).toBe(120);
  });

  it("時の小数（1.5h=90分）", () => {
    expect(parseDuration("1.5h")).toBe(90);
    expect(parseDuration("0.5h")).toBe(30);
  });

  it("時と分の組み合わせ", () => {
    expect(parseDuration("1h20m")).toBe(80);
    expect(parseDuration("2h30m")).toBe(150);
  });

  it("~ は付いていても付いていなくてもよい（Smart Inputと自由入力欄で同じ書式を使う）", () => {
    expect(parseDuration("~30m")).toBe(30);
    expect(parseDuration("30m")).toBe(30);
  });

  it("大文字と前後の空白を許す", () => {
    expect(parseDuration(" ~1H20M ")).toBe(80);
  });

  it("単位が無いものは受け付けない（数字混じりのタイトルを誤解釈しないため）", () => {
    expect(parseDuration("~")).toBeNull();
    expect(parseDuration("30")).toBeNull();
    expect(parseDuration("")).toBeNull();
  });

  it("解釈できない表記", () => {
    expect(parseDuration("あとで")).toBeNull();
    expect(parseDuration("1時間")).toBeNull();
    expect(parseDuration("m30")).toBeNull();
    expect(parseDuration("1h20")).toBeNull();
  });

  it("DBの範囲（1〜1440分）を外れたら受け付けない", () => {
    expect(parseDuration("0m")).toBeNull();
    expect(parseDuration(`${MAX_DURATION_MIN}m`)).toBe(MAX_DURATION_MIN);
    expect(parseDuration(`${MAX_DURATION_MIN + 1}m`)).toBeNull();
    expect(parseDuration("25h")).toBeNull();
  });
});
