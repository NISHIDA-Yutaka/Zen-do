// LINE webhook のイベント処理（docs/line-plan.md 3章）。
// 応答は必ず reply（無料）で返す。push（課金対象）はここでは使わない。
import "server-only";
import type { webhook } from "@line/bot-sdk";
import { db } from "@/lib/db";
import { lineClient } from "@/lib/line/client";
import type { LineConfig } from "@/lib/line/config";
import { addRecipient, removeRecipient } from "@/lib/line/recipients";

/**
 * このイベントを処理してよいか。
 * LINEは応答が遅いと同じイベントを再送するので、先に記録できた時だけ処理する。
 */
async function claimEvent(eventId: string): Promise<boolean> {
  const { error } = await db.from("line_events").insert({ event_id: eventId });
  if (!error) return true;
  if (error.code === "23505") return false; // 処理済み
  throw new Error(error.message);
}

function userIdOf(event: webhook.Event): string | null {
  const source = event.source;
  return source && "userId" in source ? (source.userId ?? null) : null;
}

async function reply(config: LineConfig, replyToken: string, text: string): Promise<void> {
  await lineClient(config).replyMessage({ replyToken, messages: [{ type: "text", text }] });
}

/**
 * 送信先として登録する。follow イベントだけに頼らないのは、
 * デプロイ前や停止中に友だち追加されると follow を取りこぼすため。
 * 発言が届いている＝ブロックされていないので、どのイベントで登録しても辻褄は合う。
 */
async function ensureRecipient(config: LineConfig, userId: string): Promise<void> {
  // 表示名は取れなくても登録は続ける（プロフィール非公開でも送信はできる）
  let displayName: string | null = null;
  try {
    displayName = (await lineClient(config).getProfile(userId)).displayName;
  } catch (err) {
    console.warn("[line] プロフィールを取得できませんでした:", err);
  }
  await addRecipient(userId, displayName);
}

async function handleFollow(config: LineConfig, event: webhook.FollowEvent): Promise<void> {
  await reply(
    config,
    event.replyToken,
    "Zendoとつながりました。\nこれから、やることの声かけをここに送ります。",
  );
}

async function handleMessage(config: LineConfig, event: webhook.MessageEvent): Promise<void> {
  // 返信できない種類のイベント（replyTokenなし）は黙って捨てる
  if (event.message.type !== "text" || !event.replyToken) return;
  // フェーズ3でSmart Inputに繋いでタスク登録にする。今は疎通確認の返事だけ
  await reply(config, event.replyToken, "受け取りました。ここからタスクを登録できるようにするのは次の段階です。");
}

export async function handleLineEvent(config: LineConfig, event: webhook.Event): Promise<void> {
  if (!(await claimEvent(event.webhookEventId))) return;

  const userId = userIdOf(event);
  if (userId && event.type !== "unfollow") await ensureRecipient(config, userId);

  switch (event.type) {
    case "follow":
      await handleFollow(config, event as webhook.FollowEvent);
      break;
    case "unfollow":
      if (userId) await removeRecipient(userId);
      break;
    case "message":
      await handleMessage(config, event as webhook.MessageEvent);
      break;
    default:
      // postback はフェーズ3で扱う
      break;
  }
}
