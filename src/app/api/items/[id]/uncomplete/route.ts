// POST /api/items/[id]/uncomplete — 完了を取り消す。
// 繰り返しで生成された次回が「未着手・未編集」なら削除して巻き戻す（docs/database-design.md 4.5）。
// ユーザーが既に着手(status変更)・編集(updated_at変化)していれば残す。
import type { NextRequest } from "next/server";
import { handle, json, notFound } from "@/lib/api";
import { db } from "@/lib/db";
import { getItem } from "@/lib/items";
import type { Item } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

export function POST(_req: NextRequest, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { id } = await ctx.params;
    const item = await getItem(id);
    if (!item) return notFound("item が見つかりません");

    // 完了していなければ何もしない（UIの二重クリックに寛容に）
    if (item.status !== "done") return json({ item, rolledBack: false });

    // 生成された次回を巻き戻せるか判定
    let rolledBack = false;
    const { data: child, error } = await db
      .from("items")
      .select("*")
      .eq("generated_from", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const next = child as Item | null;
    if (next && next.status === "todo" && next.created_at === next.updated_at) {
      const { error: delErr } = await db.from("items").delete().eq("id", next.id);
      if (delErr) throw new Error(delErr.message);
      rolledBack = true;
    }

    const { data: reopened, error: upErr } = await db
      .from("items")
      .update({ status: "todo", done_at: null })
      .eq("id", id)
      .select("*")
      .single();
    if (upErr) throw new Error(upErr.message);

    return json({ item: reopened as Item, rolledBack });
  });
}
