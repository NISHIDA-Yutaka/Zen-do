// API Route 共通ヘルパー（レスポンス整形・入力パース・エラーハンドリング）。
import "server-only";
import type { ZodType } from "zod";

export function json(data: unknown, status = 200): Response {
  return Response.json(data as object, { status });
}

export function badRequest(message: string, details?: unknown): Response {
  return Response.json({ error: message, details }, { status: 400 });
}

export function notFound(message = "Not found"): Response {
  return Response.json({ error: message }, { status: 404 });
}

/**
 * リクエストボディを JSON パース → zod 検証する。
 * 成功: { ok: true, data }、失敗: { ok: false, response }（呼び出し側でそのまま return）。
 */
export async function parseBody<T>(
  req: Request,
  schema: ZodType<T>,
): Promise<{ ok: true; data: T } | { ok: false; response: Response }> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return { ok: false, response: badRequest("リクエストボディが不正なJSONです") };
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    return { ok: false, response: badRequest("入力検証エラー", result.error.issues) };
  }
  return { ok: true, data: result.data };
}

/** ルートハンドラを包み、未捕捉エラーを500に変換する。 */
export function handle(fn: () => Promise<Response>): Promise<Response> {
  return fn().catch((err) => {
    console.error("[api] unhandled error:", err);
    return Response.json({ error: "サーバー内部エラー" }, { status: 500 });
  });
}
