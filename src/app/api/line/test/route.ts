// POST /api/line/test — Settings画面の「LINEにテスト送信」。
// 疎通確認用。定時配信と同じ経路を通るので、送信数もきちんと数えられる。
import { badRequest, handle, json } from "@/lib/api";
import { pushToAll } from "@/lib/line/push";

export function POST(): Promise<Response> {
  return handle(async () => {
    const result = await pushToAll(
      [{ type: "text", text: "Zendoからのテスト送信です。これが見えていれば連携できています。" }],
      "test",
    );
    if (result.skipped === "no_recipients") {
      return badRequest("送信先がいません。LINEで公式アカウントを友だち追加してください");
    }
    return json({ sent: result.sent });
  });
}
