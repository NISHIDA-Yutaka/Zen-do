// ブラウザ側のWeb Push購読操作（docs/design.md 15.5）。
// 通知の許可はユーザーが明示的に押したときだけ求める（起動時プロンプトはしない）。
import { postJson } from "@/lib/client";

export type PushState =
  | "unsupported" // ブラウザがWeb Pushに対応していない
  | "default" // まだ許可を求めていない
  | "denied" // ブラウザ設定でブロックされている（アプリからは戻せない）
  | "granted" // 許可済みだがこの端末の購読が未登録
  | "subscribed"; // 許可済み＋購読登録済み＝通知が届く状態

const SW_PATH = "/sw.js";

function isSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

// VAPID公開鍵（base64url）をpushManagerが要求するUint8Arrayへ変換する。
// applicationServerKey は ArrayBuffer 実体を要求するため、bufferを明示して確保する。
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.register(SW_PATH, { scope: "/", updateViaCache: "none" });
}

export async function getPushState(): Promise<PushState> {
  if (!isSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission === "default") return "default";
  const reg = await navigator.serviceWorker.getRegistration(SW_PATH);
  const sub = await reg?.pushManager.getSubscription();
  return sub ? "subscribed" : "granted";
}

function subscriptionPayload(sub: PushSubscription) {
  const json = sub.toJSON();
  const keys = json.keys ?? {};
  if (!keys.p256dh || !keys.auth) throw new Error("購読キーを取得できませんでした");
  return {
    endpoint: sub.endpoint,
    p256dh: keys.p256dh,
    auth: keys.auth,
    user_agent: navigator.userAgent,
  };
}

/** SW登録 → 許可要求 → 購読 → サーバーへ登録。成功すると "subscribed" を返す。 */
export async function enablePush(): Promise<PushState> {
  if (!isSupported()) return "unsupported";

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "default";

  const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!vapidKey) throw new Error("VAPID公開鍵が未設定です（NEXT_PUBLIC_VAPID_PUBLIC_KEY）");

  await registration();
  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  const sub =
    existing ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey),
    }));

  await postJson("/api/push/subscribe", subscriptionPayload(sub));
  return "subscribed";
}

/** この端末の購読を解除する。ブラウザ側の許可設定はそのまま。 */
export async function disablePush(): Promise<PushState> {
  if (!isSupported()) return "unsupported";
  const reg = await navigator.serviceWorker.getRegistration(SW_PATH);
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await postJson("/api/push/unsubscribe", { endpoint: sub.endpoint });
    await sub.unsubscribe();
  }
  return Notification.permission === "granted" ? "granted" : "default";
}
