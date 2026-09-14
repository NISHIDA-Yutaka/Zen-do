// LINEの送信先（docs/line-plan.md 4章）。友だち追加/ブロックのイベントで増減する。
import "server-only";
import { db } from "@/lib/db";

export type LineRecipient = {
  user_id: string;
  display_name: string | null;
  created_at: string;
  unfollowed_at: string | null;
};

/** 友だち追加。ブロック後の再追加もあるので unfollowed_at は必ず消す */
export async function addRecipient(userId: string, displayName: string | null): Promise<void> {
  const { error } = await db
    .from("line_recipients")
    .upsert(
      { user_id: userId, display_name: displayName, unfollowed_at: null },
      { onConflict: "user_id" },
    );
  if (error) throw new Error(error.message);
}

/** ブロック。行は消さずに印を付ける（再追加で戻せるように） */
export async function removeRecipient(userId: string): Promise<void> {
  const { error } = await db
    .from("line_recipients")
    .update({ unfollowed_at: new Date().toISOString() })
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
}

export async function getActiveRecipients(): Promise<LineRecipient[]> {
  const { data, error } = await db
    .from("line_recipients")
    .select("*")
    .is("unfollowed_at", null)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as LineRecipient[];
}
