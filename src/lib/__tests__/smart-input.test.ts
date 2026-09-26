import { describe, expect, it } from "vitest";
import { parseSmartInput } from "@/lib/smart-input";

// 基準日 2026-07-17（金）
const TODAY = "2026-07-17";
const PROJECTS = [
  { id: "p1", title: "自分メンテ" },
  { id: "p2", title: "時短めし研究" },
];
const parse = (text: string, cancelled?: string[]) =>
  parseSmartInput(text, { today: TODAY, projects: PROJECTS, cancelled });

describe("相対日付", () => {
  it("今日/明日/明後日", () => {
    expect(parse("歯医者 今日").dueDate).toBe("2026-07-17");
    expect(parse("歯医者 明日").dueDate).toBe("2026-07-18");
    expect(parse("歯医者 明後日").dueDate).toBe("2026-07-19");
  });
  it("来週は登録日から1週間後（+7日）", () => {
    // 2026-07-17（金）+7日
    expect(parse("資料作成 来週").dueDate).toBe("2026-07-24");
    expect(parse("資料作成 来週").title).toBe("資料作成");
  });
  it("解釈部分はタイトルから除かれる", () => {
    expect(parse("歯医者の予約 明日").title).toBe("歯医者の予約");
  });
});

describe("絶対日付", () => {
  it("M/D", () => {
    expect(parse("資料提出 8/16").dueDate).toBe("2026-08-16");
  });
  it("M月D日", () => {
    expect(parse("資料提出 8月16日").dueDate).toBe("2026-08-16");
  });
  it("過去日は翌年に繰り上げ", () => {
    expect(parse("初詣 1/5").dueDate).toBe("2027-01-05");
  });
  it("今日と同じ日付は今年のまま", () => {
    expect(parse("これ 7/17").dueDate).toBe("2026-07-17");
  });
  it("存在しない日付は解釈しない", () => {
    const r = parse("メモ 2/30");
    expect(r.dueDate).toBeNull();
    expect(r.title).toContain("2/30");
  });
});

describe("曜日は必ず未来（今日を含まない）", () => {
  it("今日と同じ曜日は翌週", () => {
    // 2026-07-17は金曜 → 「金曜日」は翌週07-24
    expect(parse("ゴミ出し 金曜日").dueDate).toBe("2026-07-24");
  });
  it("先の曜日は直近", () => {
    // 金(5) → 月(1) は3日後
    expect(parse("会議 月曜").dueDate).toBe("2026-07-20");
  });
});

describe("時刻", () => {
  it("HH:MM", () => {
    const r = parse("薬 12:00");
    expect(r.dueTime).toBe("12:00");
  });
  it("日付指定がなければ当日とみなす", () => {
    expect(parse("薬 12:00").dueDate).toBe(TODAY);
  });
  it("H時 / H時半", () => {
    expect(parse("退勤 18時").dueTime).toBe("18:00");
    expect(parse("退勤 18時半").dueTime).toBe("18:30");
  });
  it("「n時間」は時刻として解釈しない", () => {
    const r = parse("勉強 2時間");
    expect(r.dueTime).toBeNull();
  });
  it("日付＋時刻の併用", () => {
    const r = parse("面談 明日 15:00");
    expect(r.dueDate).toBe("2026-07-18");
    expect(r.dueTime).toBe("15:00");
    expect(r.title).toBe("面談");
  });
});

describe("日付・時刻は最初の1つだけ", () => {
  it("2つ目の日付は文字のまま残る", () => {
    const r = parse("明日 8/16の準備");
    expect(r.dueDate).toBe("2026-07-18");
    expect(r.title).toBe("8/16の準備");
  });
});

describe("タグ", () => {
  it("複数タグ", () => {
    const r = parse("通院 #健康 #病院");
    expect(r.tags).toEqual(["健康", "病院"]);
    expect(r.title).toBe("通院");
  });
});

describe("@プロジェクト", () => {
  it("一意に部分一致すれば紐付け", () => {
    const r = parse("牛乳を買う @自分");
    expect(r.projectId).toBe("p1");
    expect(r.title).toBe("牛乳を買う");
  });
  it("一致なしは文字のまま残す（暗黙作成しない）", () => {
    const r = parse("何か @存在しない");
    expect(r.projectId).toBeNull();
    expect(r.title).toContain("@存在しない");
  });
  it("末尾入力中はサジェスト用クエリを返す", () => {
    const r = parse("牛乳 @じ");
    expect(r.projectQuery?.query).toBe("じ");
  });
  it("語の途中の@（メールアドレス等）はプロジェクト指定にしない", () => {
    const r = parse("a@自分 に返信");
    expect(r.projectId).toBeNull();
    expect(r.projectQuery).toBeNull();
    expect(r.title).toBe("a@自分 に返信");
  });
  it("旧接頭辞の ! ではプロジェクトを指定しない", () => {
    const r = parse("牛乳を買う !自分");
    expect(r.projectId).toBeNull();
  });
});

describe("!重要度", () => {
  it("!1〜!4 を重要度として読み、タイトルから外す", () => {
    expect(parse("企画書 !1").priority).toBe(1);
    expect(parse("!4 棚の掃除").priority).toBe(4);
    const r = parse("企画書 !2 明日");
    expect(r.priority).toBe(2);
    expect(r.title).toBe("企画書");
    expect(r.tokens.find((t) => t.kind === "priority")?.label).toBe("重要度2");
  });
  it("範囲外・語の途中・数字が続くものは読まない", () => {
    expect(parse("企画書 !5").priority).toBeNull();
    expect(parse("やった!1").priority).toBeNull();
    expect(parse("企画書 !12").priority).toBeNull();
    expect(parse("企画書 !12").title).toBe("企画書 !12");
  });
  it("指定が無ければ null", () => {
    expect(parse("企画書").priority).toBeNull();
  });
});

describe("チップの取り消し", () => {
  it("取り消したトークンは解釈されずタイトルに残る", () => {
    const r1 = parse("歯医者 明日");
    const dateToken = r1.tokens.find((t) => t.kind === "date");
    const key = `date:${dateToken!.start}:${dateToken!.raw}`;
    const r2 = parse("歯医者 明日", [key]);
    expect(r2.dueDate).toBeNull();
    expect(r2.title).toBe("歯医者 明日");
  });
});

describe("複合", () => {
  it("全語彙の同時解釈", () => {
    const r = parse("歯医者の予約 明日 15:00 #健康 !2 @自分メンテ");
    expect(r.dueDate).toBe("2026-07-18");
    expect(r.dueTime).toBe("15:00");
    expect(r.tags).toEqual(["健康"]);
    expect(r.priority).toBe(2);
    expect(r.projectId).toBe("p1");
    expect(r.title).toBe("歯医者の予約");
  });
});

describe("所要時間（~）", () => {
  const today = "2026-09-16";
  const parse = (text: string) => parseSmartInput(text, { today });

  it("~90m を所要時間として取り、タイトルから外す", () => {
    const r = parse("資料を作る ~90m");
    expect(r.durationMin).toBe(90);
    expect(r.title).toBe("資料を作る");
  });

  it("時刻と所要時間は取り違えない（15時=時刻 / ~1h=所要時間）", () => {
    const r = parse("打ち合わせ 15時 ~1h");
    expect(r.dueTime).toBe("15:00");
    expect(r.durationMin).toBe(60);
    expect(r.title).toBe("打ち合わせ");
  });

  it("時分の組み合わせ", () => {
    expect(parse("通院 ~1h20m").durationMin).toBe(80);
    expect(parse("散歩 ~1.5h").durationMin).toBe(90);
  });

  it("~ が無ければ所要時間にしない", () => {
    const r = parse("90m 走る");
    expect(r.durationMin).toBeNull();
    expect(r.title).toBe("90m 走る");
  });

  it("解釈できない ~ はタイトルに残す", () => {
    const r = parse("波~の音を聞く");
    expect(r.durationMin).toBeNull();
    expect(r.title).toBe("波~の音を聞く");
  });

  it("チップには読みやすい形で出す", () => {
    const token = parse("休憩 ~90m").tokens.find((t) => t.kind === "duration");
    expect(token?.label).toBe("1時間30分");
    expect(token?.raw).toBe("~90m");
  });
});
