// POST /api/items/[id]/drop — 破棄。子孫ごと再帰的に status='dropped' にする（docs/design.md 9章）。
// 繰り返しの連鎖終了を兼ねる（droppedは完了しないため次回が生成されない）。
import type { NextRequest } from "next/server";
import { handle, json, notFound } from "@/lib/api";
import { db } from "@/lib/db";
import { getItem } from "@/lib/items";
import type { Item } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

async function collectDescendantIds(rootId: string): Promise<string[]> {
  const ids: string[] = [];
  let frontier = [rootId];
  // 幅優先で子孫を収集（個人アプリの階層規模では十分）
  while (frontier.length > 0) {
    const { data, error } = await db.from("items").select("id").in("parent_id", frontier);
    if (error) throw new Error(error.message);
    const children = (data ?? []).map((r) => (r as { id: string }).id);
    ids.push(...children);
    frontier = children;
  }
  return ids;
}

export function POST(_req: NextRequest, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { id } = await ctx.params;
    const item = await getItem(id);
    if (!item) return notFound("item が見つかりません");

    const targets = [id, ...(await collectDescendantIds(id))];
    const { data, error } = await db
      .from("items")
      .update({ status: "dropped" })
      .in("id", targets)
      .select("*");
    if (error) throw new Error(error.message);

    const dropped = (data ?? []) as Item[];
    return json({ item: dropped.find((i) => i.id === id) ?? item, droppedCount: dropped.length });
  });
}
