// MCPエンドポイント（Bearer認証）。ツール定義は src/lib/mcp/server.ts。
// mcp-remote 等ヘッダを付けられるクライアント用。claude.aiのコネクタはヘッダを付けられないため
// パス秘密方式の /api/mcp/[token] を使う（docs/mcp-integration.md）。
import { mcpHandler } from "@/lib/mcp/server";

// Supabase SDK を使うため Node ランタイムで動かす
export const runtime = "nodejs";

// Bearer認証（cronルートと同じ流儀・フェイルクローズ）。MCPは全タスクを読み書きできるため、
// 公開URL上では必ずトークンで守る。MCP_TOKEN 未設定なら全リクエストを拒否＝本番に env を
// 入れるまでMCPは無効。クライアントから Authorization: Bearer <MCP_TOKEN> を送る。
function authed(handle: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    const secret = process.env.MCP_TOKEN;
    if (!secret) {
      return Response.json({ error: "MCP_TOKEN が未設定のため無効です" }, { status: 503 });
    }
    if (req.headers.get("authorization") !== `Bearer ${secret}`) {
      return Response.json({ error: "認証が必要です" }, { status: 401 });
    }
    return handle(req);
  };
}

const guarded = authed(mcpHandler);
export { guarded as GET, guarded as POST };
