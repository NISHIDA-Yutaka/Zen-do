import { describe, expect, it } from "vitest";
import {
  buildPushPayload,
  classifyReminders,
  effectiveFireAt,
  type DispatchRow,
} from "@/lib/push-dispatch";
import type { Item, Reminder, ReminderRule } from "@/lib/types";

const NOW = new Date("2026-07-22T06:00:00.000Z"); // JST 15:00

function item(over: Partial<Item> = {}): Item {
  return {
    id: "item-1",
    kind: "todo",
    title: "歯医者に行く",
    notes: "",
    tags: [],
    status: "todo",
    parent_id: null,
    habit_id: null,
    due_date: "2026-07-22",
    due_time: "16:00",
    recurrence_rule: null,
    generated_from: null,
    postponed_count: 0,
    sort_order: 0,
    done_at: null,
    captured_raw: null,
    created_at: "2026-07-20T00:00:00.000Z",
    updated_at: "2026-07-20T00:00:00.000Z",
    ...over,
  };
}

function reminder(over: Partial<Reminder> = {}): Reminder {
  const rule: ReminderRule = { kind: "before_due_minutes", minutes: 60 };
  return {
    id: "rem-1",
    item_id: "item-1",
    rule,
    remind_at: "2026-07-22T05:59:00.000Z",
    snoozed_until: null,
    sent_at: null,
    created_at: "2026-07-20T00:00:00.000Z",
    updated_at: "2026-07-20T00:00:00.000Z",
    ...over,
  };
}

describe("effectiveFireAt", () => {
  it("スヌーズされていればそちらを使う", () => {
    const r = reminder({ snoozed_until: "2026-07-22T07:00:00.000Z" });
    expect(effectiveFireAt(r)).toBe(new Date("2026-07-22T07:00:00.000Z").getTime());
  });
  it("スヌーズなしなら remind_at", () => {
    expect(effectiveFireAt(reminder())).toBe(new Date("2026-07-22T05:59:00.000Z").getTime());
  });
});

describe("classifyReminders", () => {
  function classify(rows: DispatchRow[]) {
    return classifyReminders(rows, NOW);
  }

  it("未完了・発火時刻が直近なら送る", () => {
    const d = classify([{ reminder: reminder(), item: item() }]);
    expect(d.toSend).toHaveLength(1);
    expect(d.toDiscard).toHaveLength(0);
  });

  it("完了済みタスクの通知は送らない（完了後に鳴る問題を塞ぐ）", () => {
    const d = classify([{ reminder: reminder(), item: item({ status: "done" }) }]);
    expect(d.toSend).toHaveLength(0);
    expect(d.toDiscard[0].reason).toBe("item_not_todo");
  });

  it("破棄済みタスクの通知も送らない", () => {
    const d = classify([{ reminder: reminder(), item: item({ status: "dropped" }) }]);
    expect(d.toDiscard[0].reason).toBe("item_not_todo");
  });

  it("親アイテムが見つからなければ捨てる", () => {
    const d = classify([{ reminder: reminder(), item: undefined }]);
    expect(d.toDiscard[0].reason).toBe("item_missing");
  });

  it("24時間より古い発火予定は捨てる（cron停止からの復帰時）", () => {
    const stale = reminder({ remind_at: "2026-07-21T05:00:00.000Z" }); // 25時間前
    expect(classify([{ reminder: stale, item: item() }]).toDiscard[0].reason).toBe("stale");
  });

  it("ちょうど24時間以内なら送る", () => {
    const edge = reminder({ remind_at: "2026-07-21T06:00:00.000Z" }); // 24時間ちょうど
    expect(classify([{ reminder: edge, item: item() }]).toSend).toHaveLength(1);
  });

  it("古い remind_at でもスヌーズが直近なら送る", () => {
    const snoozed = reminder({
      remind_at: "2026-07-20T00:00:00.000Z",
      snoozed_until: "2026-07-22T05:30:00.000Z",
    });
    expect(classify([{ reminder: snoozed, item: item() }]).toSend).toHaveLength(1);
  });
});

describe("buildPushPayload", () => {
  it("タイトル＝タスク名、本文＝期日とルール", () => {
    const p = buildPushPayload(item(), reminder(), "2026-07-22");
    expect(p.title).toBe("歯医者に行く");
    expect(p.body).toBe("7月22日（水） 16:00 ・ 1時間前");
    expect(p.url).toBe("/today?item=item-1");
  });

  it("tag は item.id（同一タスクの通知を上書きする）", () => {
    expect(buildPushPayload(item(), reminder(), "2026-07-22").tag).toBe("item-1");
  });

  it("期日なしならルール表記だけ", () => {
    const rule: ReminderRule = { kind: "at", at: "2026-07-22T15:00:00+09:00" };
    const p = buildPushPayload(item({ due_date: null, due_time: null }), reminder({ rule }), "2026-07-22");
    expect(p.body).toBe("7/22 15:00");
  });
});
