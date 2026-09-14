# LINE通知・対話 実装計画

作成: 2026-09-14（設計セッション）。実装担当への引き継ぎ文書。
実装が終わった段階で docs/design.md に「21. LINE連携」として実装済み仕様を起こし、spec.md の実装状況を更新すること。この文書は「決定の経緯」として残す。

## 0. 決定事項（経緯）

- **LINE Notify は2025年3月に終了**しているため、**Messaging API（LINE公式アカウント）**を使う
- **無料プラン（月200通）に収める**。カウントされるのはサーバーから送る push だけで、ユーザーの発言・ボタン操作への **reply は無料・無制限**。よって「push は1日数通に束ね、やり取りは reply に寄せる」を設計の軸にする
- 既存の Web Push リマインダーは**現状維持**（案A）。LINE は「ダイジェスト・催促・締め」という**別の層**として足す。個別リマインダーの LINE 複製は将来のオプトイン
- **双方向を最初から入れる**。最終形は Gemini を挟んだ自然言語での応答（§6 フェーズ4）
- 文面は**励まし系**。まずテンプレで動かし、第2段階で Gemini 生成に差し替える
- 朝のダイジェストは**休日のみ**（平日は職場で必ずアプリを見るため不要）

## 1. 配信スケジュール

| | 朝 | 昼 | 夕 | 深夜（締め） |
|---|---|---|---|---|
| 平日 | – | – | 18:00 | 23:00 |
| 休日 | 9:00 | 13:00 | 18:00 | 23:00 |

- 時刻は**既定値**。`src/lib/line-schedule.ts` の定数にまとめ、変えたくなったらそこだけ触る
- **休日の定義**: 土日 ＋ 日本の祝日。祝日判定は `japanese-holidays`（振替休日・国民の休日まで算出する定番パッケージ）。着手時に最新版と保守状況を確認すること
- **何も言うことが無い枠は送らない**（未完了0・習慣候補0・Inbox未仕分け0）。予算試算: 平日2通×22日＋休日4通×9日＝**最大約80通/月**。実際は空振りが多く、もっと少ない
- **安全弁**: 当月の push 送信数が **190通に達したら push を止める**（reply は影響なし）。枠切れで気づかないうちに黙るのを防ぐため、Settings に当月の送信数を表示する

### 各枠の中身

| 枠 | 内容 | ボタン（reply扱い・無料） |
|---|---|---|
| 朝（休日） | 今日のタスク一覧・期限超過・習慣候補 | 「習慣を全部今日に追加」 |
| 昼・夕（催促） | 期限時刻を過ぎて未完了のもの＋今日の残り。**過ぎたものが無ければ「残りn件」だけ、それも0なら送らない** | 各タスクに「完了」「明日へ」 |
| 深夜（締め） | 今日の未完了n件、Inbox未仕分けが溜まっていれば一言 | 「全部明日へ」「個別に見る」（アプリのTodayを開く） |

ボタンが多くなる場合は Flex Message で1通に束ねる（1回の push に最大5メッセージまで＝1通扱い）。

## 2. 文面（励まし系テンプレ）

- 責めない・命令しない。「まだです」ではなく「残ってます」「あと少し」
- 完了があれば必ず先に触れる（「今日はもう3つ片付きました」）
- 未完了は件数で圧をかけない。3件までは名前を出し、それ以上は「他n件」
- 例（夕・催促）:
  > 今日はもう2つ片付いてますね。
  > 15:00の「歯医者の予約」がまだ残ってます。終わっていたら「完了」を押してください。あとで回すなら「明日へ」で。
- 例（深夜・締め）:
  > お疲れさまでした。今日は4つ完了。
  > 残り2件は明日に回しても大丈夫です。「全部明日へ」で片付けて休みましょう。

テンプレは `src/lib/line-messages.ts` に純関数で置き、Today のデータ→文面 をテストする。Gemini 差し替え時もこの関数の入出力を保つ。

## 3. 双方向（webhook）

`POST /api/line/webhook`

- **署名検証必須**（`x-line-signature` を channel secret で HMAC-SHA256）。失敗は 401
- **必ず即 200 を返し、重い処理は `after()`（next/server）に逃がす**。LINE は応答が遅いとリトライしてくるため。reply token は1分有効なので `after()` 内で reply しても間に合う
- イベント別:
  - `follow`: `line_recipients` に userId を登録（送り先はこれで決まる。手で貼る必要なし）
  - `unfollow`: `unfollowed_at` を記録して送信対象から外す
  - `message`(text): **Smart Input のパーサ（`parseSmartInput`）でタスク化して Inbox/Today に登録**し、reply で確認（「明日15:00 歯医者 を登録しました」）。フェーズ4で Gemini に置き換わるまでの入口
  - `postback`: ボタン操作。`data` に `action=complete&id=…` の形で持たせ、既存の `/api/items/:id/complete` 等と同じ内部関数を呼ぶ。reply で結果を返す
- 同一イベントの再送対策: `webhookEventId` を `line_events`（後述）に保存し、重複は無視

## 4. データ・環境

テーブル（migration 1本）:

```
line_recipients (user_id text pk, display_name text, created_at, unfollowed_at)
line_push_log   (id, kind text, slot text, sent_on date, sent_at, message_count int)
                unique(kind, slot, sent_on)   -- 同じ日の同じ枠は二重送信しない
line_events     (event_id text pk, received_at)  -- webhook 再送の重複排除
```

- `line_push_log` の unique 制約が**所有権**になる。cron は「insert できた場合だけ送る」（reminders の `sent_at` claim と同じ考え方。多重起動しても二重送信しない）
- `sent_on` は **JST の暦日**（`todayInJst`）
- 環境変数: `LINE_CHANNEL_ACCESS_TOKEN`（長期）、`LINE_CHANNEL_SECRET`。Vercel と `.env.local` の両方に
- ライブラリ: **`@line/bot-sdk`**（公式）

## 5. cron

`GET /api/cron/line`（Bearer `CRON_SECRET`、既存 reminders と同じ認証）

- 既存の外部cron（cron-job.org）に**ジョブを1本追加**、5分間隔で叩く
- 処理: 現在のJST時刻から「今日発火すべき枠のうち、まだ `line_push_log` に無いもの」を求め、文面を作り、空でなければ push して log に記録
- 枠の時刻を**過ぎていれば発火**（ちょうどの分に当たらなくてよい）。ただし**枠の時刻から2時間以上過ぎていたら発火しない**（cron停止からの復帰時に朝の分が夜に届くのを防ぐ。reminders の24時間ルールと同じ狙い）

## 6. 実装フェーズ（この順で。各フェーズごとに動作確認）

1. **土台**: LINE公式アカウント作成（**ユーザー自身の操作**: LINE Developers でプロバイダー→Messaging API チャネル→長期トークン発行、Webhook URL 設定、応答メッセージ OFF）。`@line/bot-sdk` 導入、migration、webhook（署名検証・follow/unfollow・イベント重複排除）、Settings に「LINE」節（連携状態・テスト送信・当月送信数）
2. **定時配信**: `line-schedule.ts`（平日/休日・枠）、`line-messages.ts`（励ましテンプレ）、`/api/cron/line`、`line_push_log` による冪等化、190通の安全弁。cron-job.org 登録はユーザー操作
3. **ボタン操作＋テキスト捕捉**: postback（完了・明日へ・習慣追加・全部明日へ）、text→`parseSmartInput`→登録→reply
4. **自然言語**: Gemini の function calling に **MCP と同じ操作群**（`src/lib/mcp/server.ts` の14ツールの内部関数）を渡し、テキストの意図を操作に写す。「今日の残りは？」「歯医者は来週に」「Duolingo終わった」を扱えれば十分。応答は励まし系のシステムプロンプトで統一。**分からない発言はタスク登録に倒さず聞き返す**（誤登録が一番困る）
5. 完了後: design.md 21章、spec.md 実装状況更新（ユーザー確認の上で）

## 7. 将来（スコープ外）

- 個別リマインダーの LINE 複製（重要なものだけオプトイン）
- Gemini による文面生成（テンプレの差し替え）と「先送り3日目なので分解しますか」型の能動提案
- 配信時刻の Settings UI（定数で足りるうちは作らない）

## 8. 実装上の注意

- **着手前に `node_modules/next/dist/docs/` の `after` と Route Handlers のガイドを読むこと**（AGENTS.md）
- webhook は**公開エンドポイント**。署名検証を通らない要求は本文を読まずに 401。ログに本文を残さない
- push の送信数は**必ず `line_push_log` に通してから**送る（数え漏れ＝枠切れ）
- テストは提案の上で承認を得る（CLAUDE.md）。純関数化する対象: スケジュール判定（平日/休日・枠・2時間ルール）、文面生成、postback の data 解析
- コミットはフェーズ単位で、ユーザー確認の上で
