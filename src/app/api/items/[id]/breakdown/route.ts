// POST /api/items/[id]/breakdown — タスクをベイビーステップに分解して返す（テスト機能）。
// 生成のみ。子ToDo化はクライアントが選んで /api/items に投げる（プレビュー→選んで追加）。
import type { NextRequest } from "next/server";
import { handle, json, notFound } from "@/lib/api";
import { breakdownTask } from "@/lib/gemini";
import { getItem } from "@/lib/items";

// 外部fetch＋APIキー利用のため Node ランタイム
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export function POST(_req: NextRequest, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { id } = await ctx.params;
    const item = await getItem(id);
    if (!item) return notFound("item が見つかりません");
    // 親プロジェクトがあれば名前とメモも文脈に足す
    const parent = item.parent_id ? await getItem(item.parent_id) : null;
    const steps = await breakdownTask({
      title: item.title,
      notes: item.notes,
      projectTitle: parent?.title ?? null,
      projectNotes: parent?.notes ?? null,
      tags: item.tags,
      dueDate: item.due_date,
    });
    return json({ steps });
  });
}
