// Web Push の送信層（server-only）。購読の後始末（期限切れ削除・連続失敗の切り捨て）もここが持つ。
// 仕様: docs/design.md 15章 / docs/database-design.md 6.2
import "server-only";
import webpush from "web-push";
import { db } from "@/lib/db";
import type { PushPayload } from "@/lib/push-dispatch";

/** この回数連続で送信に失敗した購読は削除する（端末を変えた等で復活しない購読の掃除） */
const MAX_FAILED = 5;

export type PushSubscriptionRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  failed_count: number;
};

let vapidConfigured = false;

// VAPID鍵は起動時ではなく送信時に検証する（鍵未設定でもアプリ全体は起動できるようにするため）
function configureVapid(): void {
  if (vapidConfigured) return;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    throw new Error(
      "VAPID鍵が未設定です。npx web-push generate-vapid-keys で生成し、" +
        "NEXT_PUBLIC_VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY を設定してください",
    );
  }
  webpush.setVapidDetails("mailto:zen.store.japan0826@gmail.com", publicKey, privateKey);
  vapidConfigured = true;
}

export async function getSubscriptions(): Promise<PushSubscriptionRow[]> {
  const { data, error } = await db
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth, failed_count");
  if (error) throw new Error(error.message);
  return (data ?? []) as PushSubscriptionRow[];
}

async function onSuccess(sub: PushSubscriptionRow): Promise<PushSubscriptionRow> {
  await db
    .from("push_subscriptions")
    .update({ failed_count: 0, last_success_at: new Date().toISOString() })
    .eq("id", sub.id);
  return { ...sub, failed_count: 0 };
}

// 404/410 は購読が失効した合図なので即削除。それ以外は一時障害の可能性があるので数える。
// 削除した購読は null を返し、呼び出し側の一覧から外す。
async function onFailure(
  sub: PushSubscriptionRow,
  statusCode: number | undefined,
): Promise<PushSubscriptionRow | null> {
  const expired = statusCode === 404 || statusCode === 410;
  const next = sub.failed_count + 1;
  if (expired || next >= MAX_FAILED) {
    await db.from("push_subscriptions").delete().eq("id", sub.id);
    return null;
  }
  await db.from("push_subscriptions").update({ failed_count: next }).eq("id", sub.id);
  return { ...sub, failed_count: next };
}

export type SendResult = {
  delivered: number;
  failed: number;
  /** 更新後の購読一覧（失効分は除外済み）。1回のcronで複数通知を送る際に引き回す */
  subscriptions: PushSubscriptionRow[];
};

/** 登録済みの全端末へ1件の通知を送る。1端末の失敗が他端末を巻き込まないよう allSettled で扱う。 */
export async function sendToAll(
  payload: PushPayload,
  subscriptions: PushSubscriptionRow[],
): Promise<SendResult> {
  if (subscriptions.length === 0) return { delivered: 0, failed: 0, subscriptions };
  configureVapid();

  const body = JSON.stringify(payload);
  const results = await Promise.allSettled(
    subscriptions.map((sub) =>
      webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        body,
      ),
    ),
  );

  let delivered = 0;
  let failed = 0;
  const remaining: PushSubscriptionRow[] = [];
  for (const [i, result] of results.entries()) {
    const sub = subscriptions[i];
    if (result.status === "fulfilled") {
      delivered++;
      remaining.push(await onSuccess(sub));
    } else {
      failed++;
      const status = (result.reason as { statusCode?: number } | undefined)?.statusCode;
      console.error(`[push] 送信失敗 endpoint=${sub.endpoint.slice(0, 40)}… status=${status}`);
      const next = await onFailure(sub, status);
      if (next) remaining.push(next);
    }
  }
  return { delivered, failed, subscriptions: remaining };
}
