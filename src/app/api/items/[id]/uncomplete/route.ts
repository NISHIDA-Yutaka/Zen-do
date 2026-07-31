// POST /api/items/[id]/uncomplete — 完了を取り消す。
// 実装は src/lib/complete.ts の uncompleteItem（MCPと共用）。docs/database-design.md 4.5。
import type { NextRequest } from "next/server";
import { handle, json, notFound } from "@/lib/api";
import { uncompleteItem } from "@/lib/complete";
import { getItem } from "@/lib/items";

type Ctx = { params: Promise<{ id: string }> };

export function POST(_req: NextRequest, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { id } = await ctx.params;
    const item = await getItem(id);
    if (!item) return notFound("item が見つかりません");
    return json(await uncompleteItem(item));
  });
}
