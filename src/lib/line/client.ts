// LINE Messaging API クライアント。SDKへの依存をここだけに閉じる。
import "server-only";
import { messagingApi } from "@line/bot-sdk";
import type { LineConfig } from "@/lib/line/config";

export function lineClient(config: LineConfig): messagingApi.MessagingApiClient {
  return new messagingApi.MessagingApiClient({ channelAccessToken: config.accessToken });
}
