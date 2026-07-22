// POST /api/push/unsubscribe — この端末の購読を解除する（docs/design.md 15章）。
import type { NextRequest } from "next/server";
import { handle, json, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { pushUnsubscribeSchema } from "@/lib/validation";

export function POST(req: NextRequest): Promise<Response> {
  return handle(async () => {
    const parsed = await parseBody(req, pushUnsubscribeSchema);
    if (!parsed.ok) return parsed.response;

    const { error } = await db
      .from("push_subscriptions")
      .delete()
      .eq("endpoint", parsed.data.endpoint);
    if (error) throw new Error(error.message);
    return json({ ok: true });
  });
}
