import { describe, expect, it } from "vitest";
import { parseDueInput } from "@/lib/due-input";

const TODAY = "2026-09-25"; // 金曜

describe("parseDueInput", () => {
  it("日付と時刻の両方を指定すると、そのまま両方を設定する", () => {
    expect(parseDueInput("明日 18:00", { today: TODAY, currentDate: null })).toEqual({
      due_date: "2026-09-26",
      due_time: "18:00",
    });
    expect(parseDueInput("9/30 7時半", { today: TODAY, currentDate: TODAY })).toEqual({
      due_date: "2026-09-30",
      due_time: "07:30",
    });
  });

  it("日付だけなら時刻は送らない（今の時刻を保つ）", () => {
    expect(parseDueInput("明日", { today: TODAY, currentDate: TODAY })).toEqual({
      due_date: "2026-09-26",
    });
    expect(parseDueInput("月曜", { today: TODAY, currentDate: null })).toEqual({
      due_date: "2026-09-28",
    });
  });

  it("時刻だけなら今の期日のまま時刻を変える", () => {
    expect(parseDueInput("18:00", { today: TODAY, currentDate: "2026-09-30" })).toEqual({
      due_date: "2026-09-30",
      due_time: "18:00",
    });
  });

  it("時刻だけで期日が無ければ今日", () => {
    expect(parseDueInput("21時", { today: TODAY, currentDate: null })).toEqual({
      due_date: TODAY,
      due_time: "21:00",
    });
  });

  it("日付・時刻以外の語が混じったら解釈しない", () => {
    expect(parseDueInput("明日 買い物", { today: TODAY, currentDate: null })).toBeNull();
    expect(parseDueInput("明日 #仕事", { today: TODAY, currentDate: null })).toBeNull();
    expect(parseDueInput("明日 ~30m", { today: TODAY, currentDate: null })).toBeNull();
  });

  it("空・日時が読めない入力は null", () => {
    expect(parseDueInput("", { today: TODAY, currentDate: null })).toBeNull();
    expect(parseDueInput("  ", { today: TODAY, currentDate: null })).toBeNull();
    expect(parseDueInput("そのうち", { today: TODAY, currentDate: null })).toBeNull();
  });
});
