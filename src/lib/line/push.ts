// LINEへのpush送信（docs/line-plan.md 1章・4章）。
// 無料枠は月200通で、課金対象は「サーバーから送るpush」だけ（replyは無料）。
// 送信数を数え漏らすと枠切れに気づけないので、送信は必ずこの経路を通す。
import "server-only";
import type { messagingApi } from "@line/bot-sdk";
import { todayInJst } from "@/lib/date";
import { db } from "@/lib/db";
import { getLineConfig } from "@/lib/line/config";
import { lineClient } from "@/lib/line/client";
import { getActiveRecipients } from "@/lib/line/recipients";

export const MONTHLY_FREE_QUOTA = 200;
/** 枠を使い切る手前で止める。上限ちょうどまで攻めると想定外の1通で溢れるため */
export const MONTHLY_STOP_AT = 190;

/** 当月（JST暦月）の送信数 */
export async function monthlyPushCount(today = todayInJst()): Promise<number> {
  const { data, error } = await db
    .from("line_push_log")
    .select("message_count")
    .gte("sent_on", `${today.slice(0, 7)}-01`);
  if (error) throw new Error(error.message);
  return (data ?? []).reduce((sum, r) => sum + ((r as { message_count: number }).message_count), 0);
}

export type PushResult = { sent: number; skipped: "already_sent" | "no_recipients" | null };

/**
 * 全送信先へpushする。
 * slot を指定すると「その日のその枠は一度だけ」になる（定時配信用）。
 * ログを書けた実行だけが送信を担当するので、cronが多重起動しても二重送信しない。
 */
export async function pushToAll(
  messages: messagingApi.Message[],
  kind: string,
  slot: string | null = null,
): Promise<PushResult> {
  const config = getLineConfig();
  if (!config) throw new Error("LINEの環境変数（LINE_CHANNEL_ACCESS_TOKEN / LINE_CHANNEL_SECRET）が未設定です");

  const recipients = await getActiveRecipients();
  if (recipients.length === 0) return { sent: 0, skipped: "no_recipients" };

  const today = todayInJst();
  const used = await monthlyPushCount(today);
  if (used + recipients.length > MONTHLY_STOP_AT) {
    throw new Error(
      `今月の送信数が上限(${MONTHLY_STOP_AT}通)に達するため送信を止めました（現在${used}通）`,
    );
  }

  // 送信より先に記録する。失敗時は多めに数えることになるが、
  // 数え落として無料枠を超えるよりは安全
  const { error } = await db
    .from("line_push_log")
    .insert({ kind, slot, sent_on: today, message_count: recipients.length });
  if (error) {
    if (error.code === "23505") return { sent: 0, skipped: "already_sent" };
    throw new Error(error.message);
  }

  const client = lineClient(config);
  for (const r of recipients) {
    await client.pushMessage({ to: r.user_id, messages });
  }
  return { sent: recipients.length, skipped: null };
}
