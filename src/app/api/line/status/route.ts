// GET /api/line/status — Settings画面のLINE節（docs/line-plan.md 6章フェーズ1）。
// 連携できているか・送り先が居るか・無料枠をどれだけ使ったかを1回で返す。
import { handle, json } from "@/lib/api";
import { getLineConfig } from "@/lib/line/config";
import { MONTHLY_FREE_QUOTA, MONTHLY_STOP_AT, monthlyPushCount } from "@/lib/line/push";
import { getActiveRecipients } from "@/lib/line/recipients";

export function GET(): Promise<Response> {
  return handle(async () => {
    if (!getLineConfig()) {
      return json({ configured: false, recipients: 0, used: 0, quota: MONTHLY_FREE_QUOTA, stopAt: MONTHLY_STOP_AT });
    }
    const [recipients, used] = await Promise.all([getActiveRecipients(), monthlyPushCount()]);
    return json({
      configured: true,
      recipients: recipients.length,
      used,
      quota: MONTHLY_FREE_QUOTA,
      stopAt: MONTHLY_STOP_AT,
    });
  });
}
