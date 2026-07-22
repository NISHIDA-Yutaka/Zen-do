// GET /api/cron/reminders — リマインダー配信ディスパッチャ（docs/design.md 15章）。
// 外部cron（cron-job.org 等）から毎分 Authorization: Bearer CRON_SECRET で叩かれる。
// Vercel Hobbyのcronは分単位で回せないため外部サービスを使う（docs/database-design.md 6.2）。
import type { NextRequest } from "next/server";
import { handle, json } from "@/lib/api";
import { todayInJst } from "@/lib/date";
import { db } from "@/lib/db";
import { buildPushPayload, classifyReminders, type DispatchRow } from "@/lib/push-dispatch";
import { getSubscriptions, sendToAll, type PushSubscriptionRow } from "@/lib/push-send";
import type { Item, Reminder } from "@/lib/types";

function unauthorized(): Response {
  return Response.json({ error: "認証が必要です" }, { status: 401 });
}

export function GET(req: NextRequest): Promise<Response> {
  return handle(async () => {
    const secret = process.env.CRON_SECRET;
    if (!secret) {
      return Response.json(
        { error: "CRON_SECRET が未設定です。配信を無効にしています" },
        { status: 500 },
      );
    }
    if (req.headers.get("authorization") !== `Bearer ${secret}`) return unauthorized();

    const now = new Date();
    const nowIso = now.toISOString();

    // 発火対象: 未送信 かつ (スヌーズ先 or 予定時刻) が現在以前
    const { data: dueData, error: dueErr } = await db
      .from("reminders")
      .select("*")
      .is("sent_at", null)
      .or(`and(snoozed_until.is.null,remind_at.lte.${nowIso}),snoozed_until.lte.${nowIso}`);
    if (dueErr) throw new Error(dueErr.message);
    const candidates = (dueData ?? []) as Reminder[];
    if (candidates.length === 0) return json({ checked: 0, sent: 0, discarded: 0 });

    // 送信前に sent_at をマークして所有権を取る（at-most-once）。
    // .is("sent_at", null) を付けているので、多重起動しても取れた行だけが自分の担当になる。
    const { data: claimedData, error: claimErr } = await db
      .from("reminders")
      .update({ sent_at: nowIso })
      .in(
        "id",
        candidates.map((r) => r.id),
      )
      .is("sent_at", null)
      .select("*");
    if (claimErr) throw new Error(claimErr.message);
    const claimed = (claimedData ?? []) as Reminder[];
    if (claimed.length === 0) return json({ checked: candidates.length, sent: 0, discarded: 0 });

    const { data: itemData, error: itemErr } = await db
      .from("items")
      .select("*")
      .in(
        "id",
        claimed.map((r) => r.item_id),
      );
    if (itemErr) throw new Error(itemErr.message);
    const itemsById = new Map((itemData ?? []).map((i) => [(i as Item).id, i as Item]));

    const rows: DispatchRow[] = claimed.map((reminder) => ({
      reminder,
      item: itemsById.get(reminder.item_id),
    }));
    const { toSend, toDiscard } = classifyReminders(rows, now);
    for (const d of toDiscard) {
      console.warn(`[cron] 配信をスキップ reminder=${d.reminder.id} reason=${d.reason}`);
    }

    const today = todayInJst(now);
    let subscriptions: PushSubscriptionRow[] = await getSubscriptions();
    let delivered = 0;
    for (const { reminder, item } of toSend) {
      const result = await sendToAll(buildPushPayload(item, reminder, today), subscriptions);
      delivered += result.delivered;
      subscriptions = result.subscriptions;
    }

    return json({
      checked: claimed.length,
      sent: toSend.length,
      discarded: toDiscard.length,
      delivered,
      subscriptions: subscriptions.length,
    });
  });
}
