// POST /api/line/webhook — LINEからのイベント受け口（docs/line-plan.md 3章）。
// 公開エンドポイントなので、署名検証を通らない要求は本文を読まずに弾く。
import { validateSignature, type webhook } from "@line/bot-sdk";
import { after } from "next/server";
import { handle, json } from "@/lib/api";
import { getLineConfig } from "@/lib/line/config";
import { handleLineEvent } from "@/lib/line/webhook";

export function POST(req: Request): Promise<Response> {
  return handle(async () => {
    const config = getLineConfig();
    if (!config) return json({ error: "LINEの環境変数が未設定です" }, 503);

    const signature = req.headers.get("x-line-signature");
    const body = await req.text();
    // 検証に落ちた要求は本文をログにも残さない（誰でも叩けるため）
    if (!signature || !validateSignature(body, config.channelSecret, signature)) {
      return json({ error: "署名が不正です" }, 401);
    }

    let parsed: webhook.CallbackRequest;
    try {
      parsed = JSON.parse(body) as webhook.CallbackRequest;
    } catch {
      return json({ error: "本文を解釈できませんでした" }, 400);
    }

    // LINEは応答が遅いと再送してくるので、200を返してから処理する。
    // replyトークンは1分有効なので after の中でも間に合う
    after(async () => {
      for (const event of parsed.events ?? []) {
        try {
          await handleLineEvent(config, event);
        } catch (err) {
          console.error(`[line] イベント処理に失敗 type=${event.type}:`, err);
        }
      }
    });

    return json({ ok: true });
  });
}
