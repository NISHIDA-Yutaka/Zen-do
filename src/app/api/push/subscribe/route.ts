// POST /api/push/subscribe — この端末のWeb Push購読を登録する（docs/design.md 15章）。
// 同じ端末から複数回呼ばれても endpoint で1行に収束させる。
import type { NextRequest } from "next/server";
import { handle, json, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { pushSubscribeSchema } from "@/lib/validation";

export function POST(req: NextRequest): Promise<Response> {
  return handle(async () => {
    const parsed = await parseBody(req, pushSubscribeSchema);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    const { data, error } = await db
      .from("push_subscriptions")
      .upsert(
        {
          endpoint: body.endpoint,
          p256dh: body.p256dh,
          auth: body.auth,
          user_agent: body.user_agent ?? null,
          failed_count: 0,
        },
        { onConflict: "endpoint" },
      )
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return json({ id: (data as { id: string }).id }, 201);
  });
}
