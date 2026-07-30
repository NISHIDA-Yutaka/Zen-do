# Zendo × MCP 連携（将来タスク・設計メモ）

方針確定: 2026-07-30 の会話。**最初からリモート前提**で設計するが、制作・テスト段階はローカル（Claude Desktop から stdio）で扱えれば十分。まだ未着手。

## 1. 目的・ユースケース

他のAIアプリ（claude.ai / Claude Desktop / MCP対応クライアント）から、Zendoのタスクを**リアルタイムに参照・操作しながら会話**する。

想定する会話例:
- 「今日はこのタスクが終わっていません」
- 「Inboxにこのタスクが7/20からずっと残っています。いつやりますか？」
- ユーザー「じゃあ明日やる」→ AIが期日を明日に更新

## 2. 接続形態（最初からリモート前提）

| 段階 | 形態 | 接続元 | 認証 |
|---|---|---|---|
| 制作・テスト | ローカル stdio | 同一PCの Claude Desktop | 不要（環境変数でSupabaseキー） |
| 本番 | リモート（Streamable HTTP） | claude.ai / 各AIアプリ / 複数端末 | **必須** |

ロジックは共通なのでローカル→リモート移行コストは小さい。まずローカルで道具立てを固め、リモート化する。

## 3. アーキテクチャ

MCPサーバーは**薄いアダプタ**に徹する。ドメインロジックは既存 `src/lib/*`、必要なら `/api/*` を再利用する。

```
AIアプリ ──MCP──▶ MCPサーバー(薄い) ──▶ src/lib (既存) ──▶ Supabase
```

- MCP層に業務ロジックを書かない（特定レイヤーへのロックイン回避。feedback_backend_portability と整合）
- 滞留日数・超過日数など「会話に効く派生値」は lib の読み取りヘルパ側で計算し、ツールの返り値に含める

## 4. ツール / リソース仕様（案・確定前）

### 読み取り
- `get_today()` — 今日の未完了/完了。各タスクに期限超過フラグを含める
- `get_inbox()` — 未仕分け。`created_at` と**滞留日数**、`postponed_count` を付ける（「◯日から残っている」を言えるように）
- `list_overdue()` — 期限超過（`due_date`＋`due_time` 基準）
- `get_task(id)` — 単体（子ToDo・リマインダー含む）

### 更新
- `create_task({ title, due_date?, due_time?, tags?, parent_id? })`
- `complete_task(id)` / `uncomplete_task(id)`
- `set_due(id, due_date, due_time?)` — リスケ（「明日やる」を反映）
- `drop_task(id)` — 破棄

返り値スキーマは、AIが自然に状況説明できるよう派生値（滞留日数・超過日数・次回予定）を含める。読み取り主体のクライアント向けに today/inbox を MCP **Resource** として公開する案もある。

## 5. "リアルタイム" の実体

MCPは**会話ターンごとにツールを呼んで最新を取得**する＝実質リアルタイム。ただし Zendo→AI への push ではない。「毎朝AIから棚卸しを促す」ような能動的リマインドは、AIアプリ側の定期実行（スケジュール）と別途組み合わせる。

## 6. 認証（リモート化の本丸）

- ローカル stdio: 不要
- リモート最小: 固定 Bearer トークン（自分専用・URL秘匿）
- リモート本格: OAuth 2.1（claude.ai コネクタが期待する標準）
- **注意**: 現状のZendoは実質単一ユーザーで service key 直叩き。公開MCPに無認証で出すと全タスクが露出する。リモート化時は認証を必ず入れる

## 7. 技術メモ

- Next.js/Vercel 上で Streamable HTTP を提供（`@modelcontextprotocol/sdk` ＋ Vercel向けMCPアダプタを検討）。ステートレス構成が扱いやすい
- ランタイムは Node（Supabase SDK 利用のため）
- 既存APIの認可モデル（単一ユーザー前提）を、MCP公開に合わせて見直す

## 8. 残タスク（段階）

1. ツール仕様の確定（読み取り/更新の粒度・返り値スキーマ・滞留/超過日数の定義）
2. `src/lib` にMCP用読み取りヘルパを整理（滞留日数・超過判定など）
3. ローカル stdio MCPサーバー実装 → Claude Desktop で会話テスト
4. リモート化（Vercel Streamable HTTP）
5. 認証（Bearer → OAuth 2.1）
6. claude.ai 等へコネクタ登録し E2E 確認

## 9. 進め方

設計の詰め（ツールスキーマ・認証方式）は上位モデルで行い、確定後の実装をOpusで（feedback_model_roles）。
