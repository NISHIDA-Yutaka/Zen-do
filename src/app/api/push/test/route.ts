// POST /api/push/test — Settings画面の「テスト通知を送る」（docs/design.md 15.5）。
// 登録済みの全端末へ1件送り、届いたかどうかを画面で確認できるようにする。
import { badRequest, handle, json } from "@/lib/api";
import { getSubscriptions, sendToAll } from "@/lib/push-send";

export function POST(): Promise<Response> {
  return handle(async () => {
    const subscriptions = await getSubscriptions();
    if (subscriptions.length === 0) {
      return badRequest("通知先の端末が登録されていません。先に通知を許可してください");
    }

    const result = await sendToAll(
      {
        title: "Zendo",
        body: "テスト通知です。これが見えていれば設定は完了しています",
        tag: "zendo-test",
        url: "/today",
      },
      subscriptions,
    );
    return json({ delivered: result.delivered, failed: result.failed });
  });
}
