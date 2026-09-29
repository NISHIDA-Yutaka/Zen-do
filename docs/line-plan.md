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
| 平日 | – | – | 19:00 | 23:00 |
| 休日 | 9:00 | 13:00 | 19:00 | 23:00 |

- 時刻は**既定値**。`src/lib/line-schedule.ts` の定数にまとめ、変えたくなったらそこだけ触る
- **休日の定義**: 土日 ＋ 日本の祝日。祝日判定は `japanese-holidays`（振替休日・国民の休日まで算出する定番パッケージ）。着手時に最新版と保守状況を確認すること
- **何も言うことが無い枠は送らない**（未完了0・習慣候補0・Inbox未仕分け0）。予算試算: 平日2通×22日＋休日4通×9日＝**最大約80通/月**。実際は空振りが多く、もっと少ない
- **安全弁**: 当月の push 送信数が **190通に達したら push を止める**（reply は影響なし）。枠切れで気づかないうちに黙るのを防ぐため、Settings に当月の送信数を表示する

### 各枠の中身

| 枠 | 内容 | ボタン（reply扱い・無料） |
|---|---|---|
| 朝（休日） | 今日のタスク一覧・期限超過・習慣候補 | 「習慣を全部今日に追加」 |
| 昼・夕（催促） | 期限時刻が来ていて未完了のもの（**同時刻ちょうどを含む**）＋今日の残り。**過ぎたものが無ければ「残りn件」だけ、それも0なら送らない** | 各タスクに「完了」「明日へ」 |
| 深夜（締め） | 今日の未完了n件、Inbox未仕分けが溜まっていれば一言 | 「全部明日へ」「個別に見る」（アプリのTodayを開く） |

ボタンが多くなる場合は Flex Message で1通に束ねる（1回の push に最大5メッセージまで＝1通扱い）。

## 2. 文面（励まし系テンプレ）

- 責めない・命令しない。「まだです」ではなく「残ってます」「あと少し」
- **完了した件数には触れない**（2026-09-15変更。残っているものだけ伝える方が行動に繋がるため）
- **未完了は省略せず全件並べる**（2026-09-15変更。何が残っているか分からないと動けない）
- ただし**ボタンを付けるのは先頭5件まで**。全件に付けるとFlexの10KB上限を超えて送信ごと弾かれる
- 例（夕・催促）:
  > 時間が来ているものが1件あります。
  > ・15:00 歯医者の予約
  > もう終わっていたら下のボタンで完了にできます。あとに回しても大丈夫です。
- 例（深夜・締め）:
  > お疲れさまでした。
  > 残りは2件です。
  > ・もりした眼科に予約する
  > ・PC横の掃除する
  > 明日に回しても大丈夫。ゆっくり休んでください。

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

完了状況: フェーズ1〜3は実装・本番稼働済み（2026-09-14〜15）。

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

## 9. ADHD向けの声掛け（設計確定 2026-09-15・未実装）

spec.md 1.2 の特性（計画の困難さ・忘却）に対して、**既に持っているデータ**で打つ手。push は増やさない（既存の便に載せるか、返信で完結させる）。
Gemini を呼ぶのは 9.4 の「最初の一歩」だけ。9.1・9.2 はルールだけで動く。
着手順は **9.0 → 9.1 → 9.2 → 9.4**。9.0 を入れてから2〜3日で `postponed_count` が溜まり始めるので、その間に 9.1 を出す。

「次はこれ1つ」「残り時間と見積もりの突き合わせ」は `duration_min` の入力が溜まってから（現状0件のため保留）。

### 9.0 前提: 先送りを数える（必須・数行）

**現状の問題**: `items.postponed_count` は全286件が0。増やす経路 `/api/items/[id]/postpone` を誰も呼んでおらず、Today画面の「明日へ」・LINEの「明日へ」・「まとめて今日へ」・カレンダーのドラッグは全部ただの `due_date` 更新で通っている。

**ルール**: `due_date` が**元より後ろに動いたら `postponed_count` を +1**。前に動かすのは数えない。

**訂正（実装時に判明）**: 「PATCH 1か所で全経路を拾える」は誤り。LINEの「明日へ」「残りを全部明日へ」は `src/lib/line/actions.ts` が直接DBを更新していてPATCHを通らない。判定は純関数 `src/lib/postpone.ts` に置き、**PATCHルートと `moveDueDate()`（items.ts）の2か所**から参照する。PATCHを通らない経路は `moveDueDate()` を使うこと。
- 「繰り越し→今日へ」も数える（期日を過ぎて日をまたいだ時点で1回滑っている）
- 完了時の次回生成で0に戻るのは実装済み（complete.ts）
- 過去分は取り戻せない。数字を埋めない。眼科・旧スマホのような常連は毎日「まとめて今日へ」を通るので2〜3日で閾値に達する
- 判定 `shouldCountPostpone(oldDue, newDue)` は純関数にしてテストする
- **同じ日の再指定は数えない**。カレンダーのドラッグは時刻だけ変えても `due_date` を送るため、数えると「今日の中で時間をずらしただけ」が先送りとして誤検出される
- **前倒しでは減らさない**。累積記録なので、0に戻すのは完了時（complete.ts）と9.2で質問に答えた時だけ
- `/api/items/[id]/postpone` は無条件で+1のまま（名前どおり明示的な先送り操作のため）。現在の呼び出し元はない

### 9.1 習慣の催促（実装済み 2026-09-15・Gemini不要）

当初は「おやすみ中の習慣」だけの想定だったが、**週n回の期限切迫**（週2回で金曜に0/2 など）も同じ枠で扱うよう拡張した。判定は `src/lib/habit-alerts.ts` の純関数 `habitAlert()`。データは `loadTodayData` の `habitAlerts`（インスタンスは既に読んでいるので追加クエリなし）。

**声をかける条件**（これ以外は黙る。毎日「やってない」と言われるのは催促ではなく雑音）:

| 頻度ルール | 条件 |
|---|---|
| `times_per_week` / `times_per_month` | 今期未達成 かつ **残り回数 ≧ 残り日数 − 1**（余裕1日以下）、または救済使用中 |
| `daily` / `every_n_days` | `computeHabitStats().resting === true`（次に落とすと切れる状態）。既に連続が切れているなら蒸し返さない |

余裕1日で発火させるのは、ちょうど並ぶまで待つと**週2回を金曜に0/2で迎えても土曜まで黙ってしまい、打つ手が減る**ため。

**文面**（`habitAlertLines()`）。「途切れます」は**救済を使い切っている時だけ**書く。週n回は1週落としても即切れではないので、無条件に書くと嘘になる:

```
余裕1日   Study Korean、今週あと2回。残り3日です。余裕は1日だけです。
毎日必須  Study Korean、今週あと2回。残り2日です。残り全部の日でやれば届きます。
救済切れ  …残り全部の日でやれば届きます。ここで落とすと連続が切れます。
届かない  …今週の目標には届きませんが、1回でもやれば次に繋がります。
日課      Play the Duolingo、今日やれば途切れません。
```

届かない時に「切れます」と畳みかけないのは、spec.md 1.4「失敗しても責めない」に沿わせるため。

**ボタン**: 朝・昼・夕は **[今日に追加]**（`instantiateHabit`）、深夜は **[やった]**（生成して完了まで。23時に「追加」だけでは意味がない）。postback は `a=hab_add&id=<habitId>` / `a=hab_done&id=<habitId>`。今日分が既に done なら何もせず「もう完了しています」と返す。

### 9.2 引っかかっているタスク（実装済み 2026-09-16・「気が乗らない」の中身だけ9.4待ち）

**選定**: `status='todo'` かつ `habit_id is null` かつ `postponed_count >= 2`。`postponed_count` 降順で **1通あたり最大2件**（Flex容量のため。残りは翌日に持ち越し）。
**置き場所**: 夕と深夜の便で、通常の一覧より**前**に別ブロックで出す。ここに出したタスクは通常の一覧から**除く**（全件表示は保つ。並べ替えただけ）。
**回数は文面に出さない**。内部判定にだけ使う。

```
「もりした眼科に予約する」は何度か動いています。
何が引っかかっていますか？
[完了]  [大きすぎる]  [気が乗らない]  [もう要らない]
```

| ボタン | postback | 処理 | 返信 |
|---|---|---|---|
| 完了 | `a=done&id` | 既存 | 既存 |
| 大きすぎる | `a=big&id` | 既存 `breakdownTask` → **子ToDoとして作成**（`parent_id`=元タスク） | 作った手順を列挙 |
| 気が乗らない | `a=stuck&id` | 9.4 | 一歩を提案＋[やる][別の案] |
| もう要らない | `a=drop&id` | `status='dropped'` | 「破棄しました。戻すならアプリから」 |

**答えたら `postponed_count` を0に戻す**（大きすぎる・気が乗らない・要らない のいずれでも）。戻さないと翌日また同じ質問が来る。「介入したのでここから数え直す」という意味。

**Flex容量**: 質問ブロックは1件4ボタン。質問ブロックがある便では通常の一覧の `BUTTON_LIMIT` を **3** に下げる。実測で最大15ボタン・6072B（上限10240）、LINEの `validate/push` を通過。

**朝には出さない**（実装時の追加判断）。出勤前に「何が引っかかっていますか」と重い問いを投げても答える余裕がないため、夕と深夜だけにした。

**「気が乗らない」は9.4まで未完成**。押すと `postponed_count` を0に戻して「今日は置いておいて大丈夫です」と返すだけで、まだ最初の一歩は出ない。

### 9.3 データ: `line_suggestions`

「別の案」を押すたびにゴミタスクが残らないよう、**[やる]を押すまでタスクを作らない**。提案は postback data（300文字）に載らないのでテーブルに置く。

```
line_suggestions (
  item_id uuid primary key references items(id) on delete cascade,
  step text not null,
  minutes integer not null,
  created_at timestamptz not null default now()
)
```
RLS有効。1タスク1件（上書き）。

### 9.4 最初の一歩（Geminiを使う唯一の箇所）

```
[気が乗らない] a=stuck&id → firstStep(ctx) → line_suggestions に保存
                           → 返信「最初の一歩: 〜（3分）」[やる][別の案]
[やる]        a=go&id     → 保存した一歩で Today にタスク作成（parent_id=元, due_date=今日）→ 返信
[別の案]      a=alt&id    → firstStep(ctx, avoid=[保存済みの案]) → 上書き保存 → 返信
```

- `src/lib/gemini.ts` に `firstStep(ctx: BreakdownContext, avoid: string[] = [])` を足す。呼び方は既存の `breakdownTask` と同じ（REST直叩き・flash・`responseSchema` でJSON固定）
- 出力スキーマ: `{ "step": string, "minutes": number }`。`temperature: 0.6`（「別の案」でちゃんと変わるように。分解の0.4より高め）
- Gemini が失敗したら「今は出せませんでした」と返して終わる。タスクは触らない。`postponed_count` も戻さない（質問は翌日また出る）
- webhook ルートに `export const maxDuration = 30;` を付ける（`after()` 内で Gemini を待つため。Route Segment Config の書き方は `node_modules/next/dist/docs/` で確認すること）

**プロンプト**（これが新規に書く唯一のプロンプト。[大きすぎる] は既存の分解プロンプトをそのまま使う）:

```
あなたはADHDのユーザーのタスク管理を助けるアシスタントです。
次のタスクは何度も先送りされていて、本人は「気が乗らない」と答えました。
タスクを終わらせる必要はありません。「最初の一歩」を1つだけ出してください。

条件:
- 物理的な動作1つだけ（例:「電話番号を調べて連絡先に入れる」「箱を机に出す」）
- 5分以内で終わる。長いなら、もっと小さくする
- いま手元（自宅かスマホ）で、誰にも連絡せずに始められること
- 「決める」「考える」「計画する」で始めない。手が動く動詞で始める
- タスク全体を言い換えただけの一歩にしない（それでは着手のハードルが下がらない）
- メモに書かれた事情（特に「何が面倒か」）があれば、そこを避ける一歩にする
- ユーザーと同じ言語で書く

# 文脈
タスク: {title}
メモ: {notes または（なし）}
所属プロジェクト: {projectTitle}（あれば。プロジェクトのメモも）
タグ: {tags}
避ける案: {avoid を列挙}（「別の案」の時だけ付ける）
```

「メモに書かれた事情」の行は、MCP の `update_notes` で書いたヒアリング内容がそのまま一歩の質に効くようにするためのもの。

### 9.5 変更するファイル（目安）

| ファイル | 変更 |
|---|---|
| `src/app/api/items/[id]/route.ts` | 9.0 の +1 |
| `src/lib/today-data.ts` | `restingHabits` |
| `src/lib/line/messages.ts` | おやすみ中ブロック・質問ブロック・`digestActions` 拡張・`BUTTON_LIMIT` の切替 |
| `src/lib/line/flex.ts` | 2種類のブロック描画 |
| `src/lib/line/postback.ts` | `hab_add` `hab_done` `big` `stuck` `drop` `go` `alt` |
| `src/lib/line/actions.ts` | 各ハンドラ |
| `src/lib/gemini.ts` | `firstStep` |
| `src/app/api/line/webhook/route.ts` | `maxDuration` |
| `supabase/migrations/` | `line_suggestions` |

### 9.6 テスト（提案。承認を得てから）

純関数の対象: `shouldCountPostpone`（後ろ＝+1／前・同日・null→日付＝数えない）、引っかかりタスクの選定（閾値・上限2件・習慣除外・降順）、おやすみ中ブロックの文面（枠で「今日に追加」「やった」が切り替わる）、postback の新しい種類の往復。
Gemini 呼び出し自体はテストしない（外部API）。実機確認は「気が乗らない」→提案→「別の案」→違う案→「やる」→Todayに1件、の順。

## 10. 第二弾: Gemini との会話（設計確定 2026-09-29・段階1実装済み 2026-09-29）

§6 フェーズ4（自然言語）の具体化。docs/gemini-digest-plan.md の「段階2 [話を聞いて]」もここに統合する（当初案の「会話中フラグ」方式はやめる）。

### 10.0 決定事項

1. **テキストのタスク登録（§3 の `parseSmartInput` 捕捉）は廃止**し、テキストは全部 Gemini に渡す。「明日15時 歯医者」のような登録も Gemini が `create_task` で行う。**Gemini が失敗しても捕捉登録には戻さない**（「うまく処理できませんでした。少し時間をおいてもう一度送ってください」と返すだけ。誤登録が一番困るため）
2. **ツールは MCP の14ツールと同じ中身**（`src/lib/mcp/queries.ts` / `mutations.ts` をそのまま呼ぶ）。削除・破棄は渡さない。`expected_title` の取り違え防止もそのまま効く。重要度・所要時間の設定は MCP にも無いので、要る時に両方へ足す
3. **会話履歴**: 見えているやり取り（本人の発言と返事）だけを `line_messages` に残し、**直近30分・最大10往復**を毎回渡す。30分空いたら新しい話題。ツールの途中結果は残さない（必要ならGeminiが毎回調べ直す＝古いデータで判断させない）
4. **[話を聞いて]**: 定時報告の注目タスクのボタンを `next` で出し分ける（hearing → [話を聞いて][今日はパス] / breakdown → [ベイビーステップにして][今日はパス]）。押すと「タスク『◯◯』について話を聞く」を履歴の起点に入れて Gemini が1問目を出す。**1回1問・最大3問**。**答えるたびに要点1行をメモへ追記**（途中で離れても残る）。締めの返事に選択肢ボタン [ベイビーステップにして][期日を決める][ここまで]
5. **遅さ対策**: 受信直後に「入力中…」表示（`showLoadingAnimation`・最大60秒・無料）。ツールのやり取りは1発言あたり最大3往復、全体で50秒まで（reply トークンは受信から1分）。超えたら「時間がかかってしまいました。もう一度送ってください」。push では送り直さない（有料）。会話用は思考量を抑える設定を試す
6. **誤操作対策**: 意図が明確な操作は確認なしで実行し、**何をしたかをタスク名つきで必ず返事に書く**（違えば「取り消して」で戻せる。毎回確認すると2往復になる）。候補が複数・登録か雑談か曖昧、なら**推測せず聞き返す**。**Gemini が行った操作はすべて `gemini_logs` に残す**（ツール名・対象・引数）
7. **口調**: 定時報告と同じ相棒（です・ます・落ち着いた話し方・例文を置かない）。返事は1〜3文。挨拶から始めない
8. **費用**: 見込み1往復2〜4円。まず使って記録から実額を見る。そのため `gemini_logs` に**トークン数**（`usageMetadata`）を残す。高ければ会話用だけ軽いモデルに替える

ボタン（postback）は従来どおり Gemini を通さず即時処理する（無料・速い）。

### 10.1 流れ

```
text ─→ webhook（200を先に返し after() で処理）
          ├ showLoadingAnimation（60秒）
          ├ line_messages から直近30分・10往復を読む
          ├ Gemini（system: 相棒の口調＋判断ルール / tools: 14ツール）
          │    functionCall → 実行 → functionResponse → …（最大3往復）
          │    → 最終の文章
          ├ reply（無料）
          └ line_messages に本人の発言と返事を保存 / gemini_logs に操作とトークン数
```

### 10.2 データ（マイグレーション）

```
line_messages (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,          -- LINEのユーザー
  role text not null,             -- 'user' / 'assistant'
  text text not null,
  item_id uuid references items(id) on delete set null,  -- [話を聞いて] の起点だけ。どのタスクの話か
  created_at timestamptz not null default now()
)
index (user_id, created_at desc) / RLS有効

alter table gemini_logs add column usage jsonb;  -- promptTokenCount / candidatesTokenCount / thoughtsTokenCount
```

### 10.3 実装メモ

- **ツール定義は MCP と二重に書かない**: `src/lib/mcp/server.ts` の zod スキーマと説明を共有し、Gemini 用には `z.toJSONSchema` で変換して `functionDeclarations`（`parametersJsonSchema`）に渡す。共有のために定義を1か所へ切り出す（MCP の挙動は変えない）
- **Gemini 3 の関数呼び出しは「思考の署名（thoughtSignature）」を次の要求に返す必要がある**。モデルの応答 parts は加工せずそのまま `contents` に積む
- 1回の Gemini 呼び出しの時間切れは「50秒の残り」と25秒の短い方。503は既存どおり1度やり直す
- `gemini_logs.kind='chat'`。`output` に `{ tool_calls: [{ name, args }], reply }`
- webhook ルートに `export const maxDuration = 60;`
- **[話を聞いて] の締め**: 選択肢ボタンは Gemini の文章から推測せず、**Gemini が `finish_hearing` ツールを呼んだ時だけ**コードが付ける（`finish_hearing` は会話専用のツールで、何もせずボタンの合図だけを返す）。[期日を決める][ここまで] は message アクション（そのままテキストとして Gemini に届く）、[ベイビーステップにして] は既存の `big` postback
- 聞き取りの追記の形: `・LINEで聞き取り（M/D）：要点`（`update_notes` の append）
- postback に `hear`（id付き）を足す。押されたら `line_messages` に起点（role=user・item_id付き）を入れてから会話を1回回す

### 10.4 段階

1. **会話の土台**（実装済み 2026-09-29）: テキスト→Gemini＋ツール、会話履歴、入力中表示、操作とトークン数の記録。**テキスト捕捉（`src/lib/line/capture.ts`）はここで廃止**
   - 実装: ツール定義を `src/lib/mcp/tools.ts` に切り出し（MCPの tools/list は切り出し前後で完全一致を確認）、`src/lib/line/chat-core.ts`（純関数）、`src/lib/line/chat.ts`（往復の実行）、人物設定は `src/lib/line/persona.ts` で定時報告と共用
   - ローカルで署名つきの模擬 webhook（架空ユーザー）で確認: 状況の問い合わせ（1往復・約5秒）、登録（`create_task`・約4秒）、文脈つきの期日変更（「それ明後日に」・元の期日も返事に書く）、「取り消して」で元の期日へ、曖昧な「あれ終わった」は聞き返し。`thinkingLevel: "low"` と `parametersJsonSchema` はそのまま通った。1回あたりの入力は約5千トークン
   - 試しで分かって指示文に足したこと: **答えるのは最後の発言だけ**（履歴の質問にもう一度答え直した）/ **やること＋日時だけの短い発言は確認せず登録**（以前のLINEの使い方で毎回確認されると手間）
   - `usageMetadata` には文字列や配列も混ざるので、トークン数（数値）だけを残して足し合わせる
2. **[話を聞いて]**: 注目タスクのボタン出し分け、`hear` postback、聞き取りのルール、`finish_hearing`

### 10.5 テスト（純関数）

会話履歴の切り出し（30分・10往復）、履歴→Gemini の `contents` 組み立て、zod→Gemini ツール定義の変換、postback `hear` の往復、締めの選択肢ボタンの組み立て。Gemini 呼び出し自体はテストしない。実機確認は「今日の残りは？」「歯医者は来週に」「Duolingo終わった」「明日15時 歯医者」（登録）「あれ終わった」（曖昧→聞き返す）の順
