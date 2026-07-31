// POST /api/items/[id]/complete — ToDoを完了し、繰り返しがあれば次回を1件だけ生成する。
// セマンティクスと実装は src/lib/complete.ts（MCPと共用）。docs/database-design.md 4.3/4.4/4.5。
import type { NextRequest } from "next/server";
import { handle, json, notFound } from "@/lib/api";
import { completeItem } from "@/lib/complete";
import { getItem } from "@/lib/items";

type Ctx = { params: Promise<{ id: string }> };

export function POST(_req: NextRequest, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { id } = await ctx.params;
    const item = await getItem(id);
    if (!item) return notFound("item が見つかりません");
    return json(await completeItem(item));
  });
}
