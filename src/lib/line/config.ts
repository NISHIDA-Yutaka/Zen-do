// LINE連携の設定（docs/line-plan.md）。
// 環境変数が揃っていない間は機能ごと無効にする。未設定の環境で中途半端に動かさないため。
import "server-only";

export type LineConfig = { accessToken: string; channelSecret: string };

export function getLineConfig(): LineConfig | null {
  const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const channelSecret = process.env.LINE_CHANNEL_SECRET;
  if (!accessToken || !channelSecret) return null;
  return { accessToken, channelSecret };
}
