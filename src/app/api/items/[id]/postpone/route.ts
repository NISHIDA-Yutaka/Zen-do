// POST /api/items/[id]/postpone — その回だけを先送りする（docs/database-design.md 4.5）。
// body: { date?: 'YYYY-MM-DD' }（既定は今日JSTの翌日）。postponed_count を+1し、相対リマインダーを再計算する。
// weekly/monthly の繰り返し位相はルール自体が暦に固定されているため不変。
import type { NextRequest } from "next/server";
import { badRequest, handle, json, notFound, parseBody } from "@/lib/api";
import { addDays, todayInJst } from "@/lib/date";
import { db } from "@/lib/db";
import { getItem, getReminders, recalcRelativeReminders } from "@/lib/items";
import type { Item } from "@/lib/types";
import { z } from "zod";

const schema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

type Ctx = { params: Promise<{ id: string }> };

export function POST(req: NextRequest, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { id } = await ctx.params;
    const parsed = await parseBody(req, schema);
    if (!parsed.ok) return parsed.response;

    const item = await getItem(id);
    if (!item) return notFound("item が見つかりません");
    if (item.kind === "inbox") return badRequest("Inbox項目は先送りできません");

    const target = parsed.data.date ?? addDays(todayInJst(), 1);

    const { data, error } = await db
      .from("items")
      .update({ due_date: target, postponed_count: item.postponed_count + 1 })
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    const updated = data as Item;

    await recalcRelativeReminders(updated);
    return json({ item: updated, reminders: await getReminders(id) });
  });
}
