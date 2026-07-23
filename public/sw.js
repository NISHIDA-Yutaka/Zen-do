// Zendo Service Worker — Web Push の受信専用（docs/design.md 15章）。
// オフラインキャッシュはPWA化タスクの領分なのでここには入れない。

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// インストール可能性のために fetch ハンドラを1つ持たせる。
// respondWith を呼ばず素通しするだけ＝オフラインキャッシュはしない（docs/design.md 16章）。
self.addEventListener("fetch", () => {});

self.addEventListener("push", (event) => {
  if (!event.data) return;
  const data = event.data.json();
  const options = {
    body: data.body,
    icon: "/icons/icon-192.png",
    badge: "/icons/badge-72.png",
    // 同じタスクの通知は上書きする。renotify で再通知時もちゃんと鳴らす
    tag: data.tag,
    renotify: true,
    data: { url: data.url, itemId: data.itemId },
    actions: data.itemId ? [{ action: "complete", title: "完了" }] : [],
  };
  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener("notificationclick", (event) => {
  const { url, itemId } = event.notification.data ?? {};
  event.notification.close();

  // 通知から直接完了する（アプリを開く手間で放置されるのを防ぐ）
  if (event.action === "complete" && itemId) {
    event.waitUntil(
      fetch(`${self.location.origin}/api/items/${itemId}/complete`, { method: "POST" }),
    );
    return;
  }

  const target = new URL(url || "/today", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      // 既に開いているタブがあればそれを使う（タブを増やさない）
      for (const client of clientList) {
        if (client.url.startsWith(self.location.origin) && "focus" in client) {
          return client.navigate ? client.navigate(target).then((c) => c && c.focus()) : client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
