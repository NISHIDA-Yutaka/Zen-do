// GET /api/cron/line — LINE定時配信のディスパッチャ（docs/line-plan.md 5章）。
// 外部cron（cron-job.org 等）から5分間隔で Authorization: Bearer CRON_SECRET で叩かれる。
// 枠の時刻ちょうどに当たらなくてよいよう、過ぎていれば発火する方式にしている。
import type { NextRequest } from "next/server";
import { handle, json } from "@/lib/api";
import { nowHmInJst, todayInJst } from "@/lib/date";
import { db } from "@/lib/db";
import { getLineConfig } from "@/lib/line/config";
import { buildDigestMessage } from "@/lib/line/flex";
import { buildDigest, digestActions } from "@/lib/line/messages";
import { pushToAll } from "@/lib/line/push";
import { ALL_SLOTS, dueSlots, isRestDay } from "@/lib/line/schedule";
import { loadTodayData } from "@/lib/today-data";

// クライアント側の定数（src/lib/client.ts）はswrを引き込むのでサーバーからは参照しない。
// src/lib/mcp/queries.ts と同じくここで持つ
const MEMO_TAG = "memo";

/** Inboxの未仕分け件数（docs/design.md 8章と同じ条件） */
async function inboxCount(): Promise<number> {
  const { count, error } = await db
    .from("items")
    .select("id", { count: "exact", head: true })
    .eq("kind", "todo")
    .eq("status", "todo")
    .is("parent_id", null)
    .is("due_date", null)
    .not("tags", "cs", `{${MEMO_TAG}}`);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export function GET(req: NextRequest): Promise<Response> {
  return handle(async () => {
    const secret = process.env.CRON_SECRET;
    if (!secret) return json({ error: "CRON_SECRET が未設定です" }, 500);
    if (req.headers.get("authorization") !== `Bearer ${secret}`) {
      return json({ error: "認証が必要です" }, 401);
    }
    if (!getLineConfig()) return json({ skipped: "line_not_configured" });

    const now = new Date();
    const today = todayInJst(now);
    const nowHm = nowHmInJst(now);
    const restDay = isRestDay(today);

    // ?preview=1 は送らずに文面だけ返す（無料枠を使わずに中身を確かめるため）。
    // 時刻に関係なく全部の枠を出す
    const preview = new URL(req.url).searchParams.get("preview") === "1";
    const slots = preview ? ALL_SLOTS : dueSlots(nowHm, restDay);
    if (slots.length === 0) return json({ today, nowHm, restDay, slots: [], sent: 0 });

    const [data, inbox] = await Promise.all([loadTodayData(now), inboxCount()]);

    const results: {
      slot: string;
      result: string;
      text?: string | null;
      message?: unknown;
    }[] = [];
    for (const slot of slots) {
      const digestInput = {
        slot,
        today,
        nowHm,
        todos: data.todos,
        done: data.done,
        habitCandidates: data.habitCandidates,
        habitAlerts: data.habitAlerts,
        inboxCount: inbox,
      };
      const text = buildDigest(digestInput);
      if (preview) {
        const { tasks, global, habits } = digestActions(digestInput);
        results.push({
          slot,
          result: text ? "would_send" : "nothing_to_say",
          text,
          message: text ? buildDigestMessage(text, tasks, global, habits) : null,
        });
        continue;
      }
      // 言うことが無い枠は送らない（無料枠を空振りで消費しない）
      if (!text) {
        results.push({ slot, result: "nothing_to_say" });
        continue;
      }
      // 1枠の失敗（枠切れ・LINE側の障害）で全体を500にしない。
      // cronサービスのログに理由が残るよう、結果として返す
      try {
        const { tasks, global, habits } = digestActions(digestInput);
        const push = await pushToAll(
          [buildDigestMessage(text, tasks, global, habits)],
          "digest",
          slot,
        );
        results.push({ slot, result: push.skipped ?? `sent:${push.sent}` });
      } catch (err) {
        console.error(`[line] ${slot}の配信に失敗:`, err);
        results.push({ slot, result: `failed: ${(err as Error).message}` });
      }
    }

    return json({ today, nowHm, restDay, preview, results });
  });
}
