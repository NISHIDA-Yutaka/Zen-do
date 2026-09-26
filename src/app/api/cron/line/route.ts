// GET /api/cron/line — LINE定時配信のディスパッチャ（docs/line-plan.md 5章）。
// 外部cron（cron-job.org 等）から5分間隔で Authorization: Bearer CRON_SECRET で叩かれる。
// 枠の時刻ちょうどに当たらなくてよいよう、過ぎていれば発火する方式にしている。
import type { NextRequest } from "next/server";
import { handle, json } from "@/lib/api";
import { nowHmInJst, todayInJst } from "@/lib/date";
import { db } from "@/lib/db";
import type { Advice } from "@/lib/line/advice";
import { adviceCandidates, fetchAdvice, loadAdviceExtras } from "@/lib/line/advice-source";
import { getLineConfig } from "@/lib/line/config";
import { buildDigestMessage } from "@/lib/line/flex";
import { buildDigest, type DigestInput, digestActions } from "@/lib/line/messages";
import { pushToAll, sentSlots } from "@/lib/line/push";
import { ALL_SLOTS, dueSlots, isRestDay } from "@/lib/line/schedule";
import { loadTodayData } from "@/lib/today-data";

// Gemini の声かけを待つ（1回25秒まで・混雑時は1度だけやり直す。docs/gemini-digest-plan.md）
export const maxDuration = 60;

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
    const restDay = isRestDay(today);

    // ?preview=1 は送らずに文面だけ返す（無料枠を使わずに中身を確かめるため）。
    // 時刻に関係なく全部の枠を出す
    const params = new URL(req.url).searchParams;
    const preview = params.get("preview") === "1";
    // プレビューだけ ?at=19:00 で時刻を差し替えられる（夕方・深夜の声かけを昼間に確かめるため）
    const at = params.get("at");
    const nowHm = preview && at && /^([01]\d|2[0-3]):[0-5]\d$/.test(at) ? at : nowHmInJst(now);
    // 枠は時刻を過ぎてから2時間「期限内」として5分おきに当たり続ける。送り終えた枠を先に外し、
    // 毎回 Gemini を呼んだりデータを読んだりしない（二重送信の防止自体は pushToAll が担う）
    const sent = preview ? new Set<string>() : await sentSlots("digest", today);
    const slots = (preview ? ALL_SLOTS : dueSlots(nowHm, restDay)).filter((s) => !sent.has(s));
    if (slots.length === 0) return json({ today, nowHm, restDay, slots: [], sent: 0 });

    const [data, inbox] = await Promise.all([loadTodayData(now), inboxCount()]);
    const extras = await loadAdviceExtras(data.todos, today, now);

    const results: {
      slot: string;
      result: string;
      text?: string | null;
      advice?: Advice | null;
      message?: unknown;
    }[] = [];
    const baseInputs = slots.map(
      (slot): DigestInput => ({
        slot,
        today,
        nowHm,
        todos: data.todos,
        done: data.done,
        habitCandidates: data.habitCandidates,
        habitAlerts: data.habitAlerts,
        inboxCount: inbox,
      }),
    );
    // 言うことが無い枠は送らない（無料枠を空振りで消費しない）。Gemini もその時は呼ばない
    const speaking = baseInputs.filter((b) => buildDigest(b) !== null);
    // 枠ごとに独立なので並べて待つ（プレビューの4枠を順に待つと関数の時間上限を越えうる）
    const advices = new Map(
      await Promise.all(
        speaking.map(async (b) => {
          const advice = extras
            ? await fetchAdvice(
                {
                  slot: b.slot,
                  restDay,
                  today,
                  nowHm,
                  candidates: adviceCandidates(data.todos, extras),
                  todos: data.todos,
                  done: data.done,
                  habitAlerts: data.habitAlerts,
                },
                preview,
              )
            : null;
          return [b.slot, advice] as const;
        }),
      ),
    );

    for (const baseInput of baseInputs) {
      const { slot } = baseInput;
      if (!advices.has(slot)) {
        results.push({ slot, result: "nothing_to_say" });
        continue;
      }
      const advice = advices.get(slot) ?? null;
      // 注目タスクを出す便は、引っかかっているタスクの4択をそちらに統合する
      const digestInput = advice?.focus ? { ...baseInput, noStuck: true } : baseInput;
      const text = buildDigest(digestInput) ?? "";

      if (preview) {
        const { tasks, global, habits, stuck } = digestActions(digestInput);
        results.push({
          slot,
          result: "would_send",
          text,
          advice,
          message: buildDigestMessage(text, tasks, global, habits, stuck, advice),
        });
        continue;
      }
      // 1枠の失敗（枠切れ・LINE側の障害）で全体を500にしない。
      // cronサービスのログに理由が残るよう、結果として返す
      try {
        const { tasks, global, habits, stuck } = digestActions(digestInput);
        const push = await pushToAll(
          [buildDigestMessage(text, tasks, global, habits, stuck, advice)],
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
