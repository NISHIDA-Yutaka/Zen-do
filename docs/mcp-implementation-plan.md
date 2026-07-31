# MCP実装計画（実装担当への引き継ぎ）

作成: 2026-07-31。**仕様は [mcp-integration.md](./mcp-integration.md) が正**（権限方針・ツール一覧・ガードレール）。本書は「どう作るか」の手順書。

## 進捗

- **第1段（参照ツール7種）: 実装・検証済み（2026-07-31）**。`src/lib/mcp/serialize.ts` `src/lib/mcp/queries.ts` `src/app/api/mcp/route.ts`
- **第2段（操作5種＋ガードレール）: 実装・検証済み（2026-07-31）**。以下を追加:
  - リファクタ: 完了/取り消しの中核を `src/lib/complete.ts` へ、習慣生成の中核を `src/lib/habit-instance.ts` へ抽出。既存ルート（complete/uncomplete/instantiate）は薄いラッパに。**挙動不変を確認**（アプリ本体ルートで次回生成＋チェックリスト複製＋undo巻き戻しを実機テスト）
  - `src/lib/mcp/guard.ts`（expected_title 照合・事前条件）、`src/lib/mcp/mutations.ts`（create/complete/uncomplete/set_due/add_habit_today）
  - E2E検証済み（正常系＋全ガードレール: title不一致拒否・既完了拒否・繰り返しへの期日クリア拒否・存在しないID拒否・習慣二重生成の冪等）。TMPデータは全削除
  - 既存テスト127件維持・新規lintエラーなし
- **第3段（認証）: Bearer認証を実装済み（2026-07-31）**。`/api/mcp` を `MCP_TOKEN` によるBearer認証でラップ（cronルートと同じ流儀・フェイルクローズ）:
  - `MCP_TOKEN` 未設定 → 503（本番にenvを入れるまでMCPは無効）
  - トークン不一致/未提示 → 401 / 正しいBearer → 通過
  - ローカル検証済み（401/401/200）。既存＋新規テスト137件（`mcp-serialize.test.ts` 追加）
  - **本番デプロイ時に必要**: Vercelの環境変数に `MCP_TOKEN`（十分に長いランダム文字列）を設定するまで、`/api/mcp` は503を返し安全。設定後、クライアント（mcp-remote 等）から `Authorization: Bearer <MCP_TOKEN>` を送る
  - `.claude/launch.json` に `autoPort: true` を追加（ポート3000使用中でも検証サーバーが空きポートで起動できる）
- 残: 本番Vercelへの `MCP_TOKEN` 設定＋クライアント登録、（必要なら）claude.ai向けOAuth

### 実装中に確定した実API（計画時点から補正）

- パッケージ導入済み: `mcp-handler@^2` / `@modelcontextprotocol/server@^2`
- **`createMcpHandler` は `mcp-handler` からimport**（実体は `createMcpRouteHandler` のエイリアス）
- **route.ts に `export const runtime = "nodejs"` が必要**（Supabase SDKのため。これが無いとEdge実行になり得る）
- `registerTool(name, { title, description, inputSchema: z.object({...}) }, cb)`。`inputSchema` は **`z.object(...)`**（生shapeではない）。引数なしのツールも `z.object({})` を渡す
- 戻り値は `{ content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] }`
- レスポンスは**SSE形式**（`event: message\ndata: {...}`）。curl検証は `Accept: application/json, text/event-stream` を付け、`data: ` 行のJSONを取り出す
- 認証は `withMcpAuth`（`mcp-handler` の named export。第3段で使用）

## 0. 最初に読むもの

1. [mcp-integration.md](./mcp-integration.md) — 何を作るか（必読）
2. `AGENTS.md` — **このNext.jsは通常と異なる**。Route Handlerを書く前に `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` を読む
3. `CLAUDE.md` — 日本語応答・関数型・テストは承認後・自動コミット禁止

## 1. 技術スタック（調査済み・確定）

| 項目 | 内容 |
|---|---|
| アダプタ | `mcp-handler@^2`（Web標準 `(Request) => Promise<Response>` を返す。Vercel非依存） |
| SDK | `@modelcontextprotocol/server@^2`（MCP SDK v2） |
| zod | `^4` — **既存の 4.4.3 をそのまま使える** |
| Node | 20+ — 現環境22でOK |
| Next | 16.2.10（Route Handlerは Web `Request`/`Response`） |

```bash
npm install mcp-handler@^2 @modelcontextprotocol/server@^2
```

**注意**: `mcp-handler` 1.x は `@modelcontextprotocol/sdk` 1.x 用。**2.x を使うこと**（`sdk` パッケージは入れない）。1.x にあった `basePath` 等のルート設定オプションは 2.x で廃止され、**マウントした位置がそのままエンドポイント**になる。

### 基本形

```typescript
// src/app/api/mcp/route.ts
import { createMcpHandler } from "mcp-handler";
import { z } from "zod";

const handler = createMcpHandler((server) => {
  server.registerTool(
    "get_status",
    {
      title: "...",
      description: "...",
      inputSchema: z.object({}),   // 1.x と違い「生shape」ではなく z.object(...) を渡す
    },
    async (args) => ({ content: [{ type: "text", text: JSON.stringify(payload) }] }),
  );
});

export { handler as GET, handler as POST };
```

## 2. 構成方針

```
MCPクライアント ──Streamable HTTP──▶ src/app/api/mcp/route.ts（薄い）
                                        └─▶ src/lib/mcp/*.ts（読み書きヘルパ）
                                              └─▶ src/lib/db.ts ─▶ Supabase
```

- **`route.ts` にはツール定義とJSON整形だけ**。クエリ・判定ロジックは `src/lib/mcp/` に置く（MCP層に業務ロジックを書かない方針）
- 既存の `src/lib/*`（`date.ts` / `habit-stats.ts` / `frequency.ts` / `format.ts` / `items.ts` / `db.ts`）を最大限再利用する
- **第1段では既存の `/api/*` ルートに触らない**（動いているものを壊さない）

## 3. 第1段: 参照ツール

### 3.1 新規ファイル

**`src/lib/mcp/queries.ts`**（server-only）— 読み取りヘルパ。既存libを組み合わせる。

必要な派生値の定義:
- `overdue` — `due_date < today`、または `due_date === today && due_time < 現在時刻(JST)`。`formatDueLabel` の `overdue` と同じ判定（`nowHmInJst()` を使う）
- `overdue_days` — `diffDays(due_date, today)`（当日時刻超過は0）
- `stale_days` — `diffDays(created_at のJST日付, today)`
- `is_recurring` = `recurrence_rule !== null` / `is_habit` = `habit_id !== null`
- `has_children` — 子の件数 > 0

**`src/lib/mcp/serialize.ts`** — Item → MCP返却用オブジェクトへの整形（上の派生値を付与）。UUIDは `id` としてそのまま返す。

**`src/app/api/mcp/route.ts`** — ツール登録。

### 3.2 実装するツール

| ツール | 入力 | 中身 |
|---|---|---|
| `get_status` | なし | `{ today, today_tasks, overdue, inbox, counts }` を1回で返す。**会話の起点** |
| `list_today` | なし | `kind=todo, status=todo, due_date <= today` ＋当日完了分。並びは既存Todayと同じ（due_date→due_time NULLS LAST→sort_order） |
| `list_inbox` | なし | `status=todo, parent_id=null, due_date=null, #memoタグ除外`（`INBOX_QUERY` と同条件）＋ `stale_days` |
| `list_upcoming` | `days?: number`（既定14） | `due_date > today` かつ `<= today+days` |
| `get_task` | `id: uuid` | 単体＋子ToDo＋リマインダー＋繰り返し |
| `find_task` | `query: string` | タイトル部分一致（未完了優先）。**候補を配列で返す。1件に絞らない**。0件なら空配列と明示メッセージ |
| `list_habits` | なし | `computeHabitStats` の結果＋今日の候補か（`isPlannerCandidate`）＋当日インスタンスの状態 |

### 3.3 返り値の約束

- **全レスポンスに `today`（JSTの今日）を含める** — AIが相対日付（「明日」）を自分で計算できるようにするため。第2段の `set_due` はISO日付しか受け付けない
- `content: [{ type: "text", text: JSON.stringify(payload, null, 2) }]` で返す
- 件数が多い一覧は上限を設ける（例: 100件）。超えたら `truncated: true` を含める

### 3.4 ツールのdescriptionが最重要

AIの振る舞いはdescriptionで決まる。例:

> `list_inbox`: 「未仕分けタスク一覧。`stale_days` は放置日数。7日以上のものは会話で言及して再スケジュールを促すとよい」

「いつやりますか？」と自発的に聞かせたいなら、そう書く。

## 4. 第2段: 操作ツール＋ガードレール

### 4.1 既存ロジックの再利用（重要な判断）

完了処理の中核（**繰り返しの次回生成・チェックリストの子複製・undo巻き戻し**）は現在 `src/app/api/items/[id]/complete/route.ts` の中にある。MCPから同じ挙動を得るには:

**推奨**: この中核を `src/lib/complete.ts` に抽出し、**既存ルートとMCPの両方が呼ぶ**形にする。
- ロジック二重化を避けるための正当なリファクタ（CLAUDE.md「理由なくリファクタしない」に抵触しない）
- **既存の挙動を1ミリも変えないこと**。抽出後に既存テスト（127件）が全て通ることを必ず確認
- 抽出が難しければ、代替として MCP から内部 `fetch` で自分の `/api/items/:id/complete` を叩く手もあるが、非推奨（自己HTTP呼び出しは認証・URL解決が面倒）

### 4.2 ツール

| ツール | 入力 |
|---|---|
| `create_task` | `title, due_date?, due_time?, tags?, parent_id?` |
| `complete_task` | `id, expected_title` |
| `uncomplete_task` | `id, expected_title` |
| `set_due` | `id, expected_title, due_date（null可）, due_time?` |
| `add_habit_today` | `habit_id, expected_title` |

### 4.3 ガードレール（必ず全部入れる）

**`src/lib/mcp/guard.ts`** に共通化する。

1. **`expected_title` 照合** — DBの実タイトルと `trim()` 後の完全一致。不一致なら**操作せず**エラー:
   ```
   対象が一致しません。指定IDのタスクは「実際のタイトル」です。
   意図したタスクか確認してから再実行してください。
   ```
2. **事前条件チェック** — 存在しない / `status='dropped'` / 既に完了済み（completeの場合）は明示エラー。黙って成功にしない
3. **`set_due` の繰り返しガード** — `due_date: null` かつ `recurrence_rule !== null` なら**拒否**（期日クリアで繰り返しが外れる事故防止）。理由を文章で返す
4. **`find_task` は自動確定しない** — 複数候補をそのまま返す
5. **一括操作を作らない** — 1呼び出し1タスク
6. **UUID形式チェック** — 不正形式は即エラー

### 4.4 副作用の明示

書き込みツールの返り値には**何が起きたか**を含める:
- 繰り返しなら「次回 2026-08-05 を作成しました（チェックリスト7件を複製）」
- 習慣なら「ストリークが970日になりました」

## 5. 第3段: 認証＋デプロイ

- `mcp-handler` は `withMcpAuth`（Bearer検証・RFC 9728準拠の `WWW-Authenticate` 応答）と `protectedResourceHandler` を提供する。まずは**固定Bearerトークン**（環境変数 `MCP_TOKEN`）で開始
- **無認証で公開しない**（全タスクが露出する）
- Vercelにデプロイ後、クライアント側に `https://<本番>/api/mcp` を登録
- 将来 claude.ai コネクタで OAuth が要求される場合は、2026-07-28仕様のCIMD対応を検討（`mcp-handler` の `docs/AUTHORIZATION.md` 参照）

## 6. 検証手順

### ローカル
1. `preview_start`（`.claude/launch.json` の `zendo-dev`）でdevサーバ起動 — **Bashで `npm run dev` しない**
2. エンドポイント疎通:
   ```bash
   curl -s -X POST http://localhost:3000/api/mcp -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
   ```
3. 各ツールを `tools/call` で叩き、返り値のJSONを目視確認
4. **ガードレールの異常系を必ず試す**: 存在しないID / `expected_title` 不一致 / 繰り返しタスクへの期日クリア / 完了済みの再完了
5. Claude Desktop から接続（Streamable HTTP対応なら `{"url":"http://localhost:3000/api/mcp"}`、stdio専用なら `npx -y mcp-remote http://localhost:3000/api/mcp`）して会話テスト

### データの扱い
- **本番Supabaseに直接繋がる**。検証で作ったタスクは必ず削除し、状態を変えたら元に戻す
- 書き込み検証は「TMP-」接頭辞のタスクで行う

## 7. 落とし穴（既知・design.md 14章より）

- **`.next` キャッシュ破損**: `next build` と `next dev` を交互に実行すると、ネストしたAPIルートが全て404になり型チェックも落ちる。`rm -rf .next` で復旧
- **DDLはSQL Editorで手動実行**（service_role API経由では不可）。※今回はスキーマ変更なしの想定
- **自動化ブラウザの制約**: `computer type` はReactのstateを更新しない。今回はcurl中心で検証すればよい

## 8. コミット方針

段階ごとに1コミット（Conventional Commits・本文日本語）:

1. `feat: MCP参照ツールを追加（get_status/list_today/list_inbox 等）`
2. `refactor: 完了処理の中核を lib に抽出`（第2段の前段。挙動不変・既存テスト通過が条件）
3. `feat: MCP操作ツールとガードレールを追加`
4. `feat: MCPエンドポイントにBearer認証を追加`

**push前に必ずユーザー確認**。テスト追加も承認後。

## 9. テストの提案（承認後に書く）

- `src/lib/mcp/` の純粋関数（派生値の計算・`expected_title` 照合・繰り返しガード判定）は既存の vitest でユニットテスト可能
- MCPハンドラ自体のE2Eは、devサーバに対する `tools/call` のcurlスクリプトで代替（既存のnode製E2Eと同じ流儀）
