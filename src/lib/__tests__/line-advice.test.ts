import { describe, expect, it } from "vitest";
import {
  type AdviceCandidate,
  type AdviceContext,
  buildAdvicePrompt,
  CANDIDATE_LIMIT,
  NOTE_LIMIT,
  resolveAdvice,
} from "@/lib/line/advice";
import type { Item } from "@/lib/types";

const TODAY = "2026-09-26";

function task(over: Partial<Item> = {}): Item {
  return {
    id: crypto.randomUUID(),
    kind: "todo",
    title: "タスク",
    notes: "",
    tags: [],
    status: "todo",
    parent_id: null,
    habit_id: null,
    due_date: null,
    due_time: null,
    duration_min: null,
    priority: null,
    recurrence_rule: null,
    generated_from: null,
    postponed_count: 0,
    sort_order: 0,
    done_at: null,
    captured_raw: null,
    created_at: "2026-09-16T00:00:00Z",
    updated_at: "2026-09-16T00:00:00Z",
    ...over,
  };
}

function cand(item: Item, over: Partial<AdviceCandidate> = {}): AdviceCandidate {
  return { item, place: "inbox", openChildren: 0, recentlyPicked: false, ...over };
}

function ctx(over: Partial<AdviceContext> = {}): AdviceContext {
  return {
    slot: "evening",
    restDay: true,
    today: TODAY,
    nowHm: "19:00",
    candidates: [],
    todos: [],
    done: [],
    habitAlerts: [],
    ...over,
  };
}

describe("buildAdvicePrompt", () => {
  it("候補を t1, t2… の参照名で渡し、参照名から実タスクを引ける", () => {
    const a = task({ title: "眼科に予約する" });
    const b = task({ title: "包丁を研ぐ" });
    const { prompt, refs } = buildAdvicePrompt(ctx({ candidates: [cand(a), cand(b)] }));
    expect(prompt).toContain("[t1] 眼科に予約する");
    expect(prompt).toContain("[t2] 包丁を研ぐ");
    expect(refs.get("t2")).toBe(b);
    expect(prompt).not.toContain(a.id);
  });

  it("判断材料（重要度・放置日数・先送り・子の数・場所）を載せる", () => {
    const item = task({
      title: "確定申告",
      priority: 1,
      postponed_count: 3,
      due_date: "2026-09-25",
      due_time: "10:30:00",
    });
    const { prompt } = buildAdvicePrompt(
      ctx({ candidates: [cand(item, { place: "today", openChildren: 2 })] }),
    );
    expect(prompt).toContain("重要度: 1（緊急かつ重要）");
    expect(prompt).toContain("先送り: 3回 / 放置: 10日 / 未完了の子タスク: 2件");
    expect(prompt).toContain("Today（9/25 10:30（期限切れ））");
  });

  it("メモは上限で切り、空なら（なし）と書く", () => {
    const long = task({ title: "長い", notes: "あ".repeat(NOTE_LIMIT + 50) });
    const empty = task({ title: "空" });
    const { prompt } = buildAdvicePrompt(ctx({ candidates: [cand(long), cand(empty)] }));
    expect(prompt).toContain(`${"あ".repeat(NOTE_LIMIT)}…（以下略）`);
    expect(prompt).not.toContain("あ".repeat(NOTE_LIMIT + 1));
    expect(prompt).toContain("メモ: （なし）");
  });

  it("直近に選んだ候補には印を付ける", () => {
    const { prompt } = buildAdvicePrompt(
      ctx({ candidates: [cand(task({ title: "前回の" }), { recentlyPicked: true })] }),
    );
    expect(prompt).toContain("[t1] 前回の（直近に選んだ）");
  });

  it("候補は上限までしか渡さない", () => {
    const many = Array.from({ length: CANDIDATE_LIMIT + 5 }, (_, i) => cand(task({ title: `x${i}` })));
    const { refs } = buildAdvicePrompt(ctx({ candidates: many }));
    expect(refs.size).toBe(CANDIDATE_LIMIT);
  });

  it("今日完了したものを件数とタイトルで渡す（称賛の材料）", () => {
    const { prompt } = buildAdvicePrompt(
      ctx({ done: [task({ title: "洗濯" }), task({ title: "請求書" })] }),
    );
    expect(prompt).toContain("今日完了したもの: 2件");
    expect(prompt).toContain("・洗濯");
  });
});

describe("残りの重さの材料", () => {
  it("未完了・期限切れの件数、見積もりの合計、24時までの残り時間を渡す", () => {
    const todos = [
      task({ title: "眼科", due_date: TODAY, due_time: "18:00:00", duration_min: 30 }),
      task({ title: "洗濯", due_date: TODAY, duration_min: 15 }),
      task({ title: "昨日の", due_date: "2026-09-25" }),
    ];
    const { prompt } = buildAdvicePrompt(ctx({ nowHm: "19:00", todos }));
    expect(prompt).toContain("今日の未完了: 3件（うち期限切れ・時刻を過ぎたもの 2件）");
    expect(prompt).toContain("・眼科（18:00）");
    expect(prompt).toContain("2件で合計45分（見積もりのない1件は含まない）");
    expect(prompt).toContain("今日の残り時間（24時まで）: 5時間");
  });
});

describe("resolveAdvice", () => {
  const item = task({ title: "眼科に予約する" });
  const refs = new Map([["t1", item]]);

  it("参照名を実タスクに引き直す", () => {
    const advice = resolveAdvice(
      { greeting: "おつかれ！✨", focus: { ref: "t1", reason: "ずっと気になってたよね", next: "hearing" } },
      refs,
    );
    expect(advice?.greeting).toBe("おつかれ！✨");
    expect(advice?.focus?.item).toBe(item);
    expect(advice?.focus?.next).toBe("hearing");
  });

  it("存在しない参照名・形の崩れた focus は捨てて、声かけだけ活かす", () => {
    for (const focus of [
      { ref: "t9", reason: "理由", next: "hearing" },
      { ref: "t1", reason: "", next: "hearing" },
      { ref: "t1", reason: "理由", next: "delete" },
      "t1",
    ]) {
      const advice = resolveAdvice({ greeting: "やっほー", focus }, refs);
      expect(advice?.greeting).toBe("やっほー");
      expect(advice?.focus).toBeNull();
    }
  });

  it("focus が null なら注目タスクなし", () => {
    expect(resolveAdvice({ greeting: "順調！", focus: null }, refs)?.focus).toBeNull();
  });

  it("声かけが無い・空・形が違うなら全体を失敗にする（テンプレだけで送る）", () => {
    expect(resolveAdvice({ greeting: "  " }, refs)).toBeNull();
    expect(resolveAdvice({ focus: null }, refs)).toBeNull();
    expect(resolveAdvice("おつかれ", refs)).toBeNull();
    expect(resolveAdvice(null, refs)).toBeNull();
  });

  it("長すぎる声かけは切る（Flex・通知欄を溢れさせない）", () => {
    const advice = resolveAdvice({ greeting: "あ".repeat(1000) }, refs);
    expect(advice?.greeting.length).toBeLessThanOrEqual(300);
  });
});
