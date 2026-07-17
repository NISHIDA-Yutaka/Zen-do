# Zendo データベース設計書 v1.0

> [spec.md](spec.md) 5章「データモデル（案）」の実装詳細版。スキーマに関しては本ドキュメントと
> [supabase/migrations/](../supabase/migrations/) 配下のSQLを正とする。
> セマンティクス（繰り返し・リマインダー・習慣の意味論）の定義もここに置く。

---

## 1. 設計方針

1. **単一テーブル継承**: タスク(ToDo) / Project は1つの `items` テーブルに `kind` 列で同居させる（2026-07-16の統合により2種。docs/design.md 8章）。**Inboxは状態ではなくビュー**（`kind='todo' AND due_date IS NULL AND parent_id IS NULL AND is_memo=false AND status='todo'`）——「仕分け」は期日設定であり、kind遷移を伴わない。ToDo⇄Projectの昇格・降格はkind更新1回
2. **習慣インスタンス＝ToDo行**: デイリープランナーが生成する「今日の習慣」は `items` テーブルの通常のToDo行（`habit_id` 付き）。Todayビュー・リマインダー・スワイプ操作などToDoの全機能をそのまま流用でき、実践ログは「habit_id付きToDo行の集合」から導出する（ログ専用テーブルとの二重管理を避ける）
3. **DBアクセスはすべてNext.js API Routes経由**: クライアントはSupabaseと直接通信しない。理由: (a) 繰り返し完了時の次回生成などをサーバー側でアトミックに実行できる (b) 将来DBを乗り換えてもクライアントは無変更 (c) DB接続情報がブラウザに一切渡らない
4. **タイムゾーンはJST固定**: 「今日」の境界判定・習慣の日付・ストリーク計算はすべて `Asia/Tokyo`（サーバー環境変数 `APP_TIMEZONE`）で行う。日本はDSTがないため単純化できる
5. **同期に備えたID設計**: 主キーはUUIDで、将来のオフライン対応時にクライアント側生成IDをそのまま使えるようにしておく（採番の衝突がない）

---

## 2. アクセスアーキテクチャ

```
[ブラウザ (React)] --fetch--> [Next.js API Routes (Vercel)] --secret key--> [Supabase Postgres]
                                      |
                                      +--> [Claude API]（将来）
                                      +--> [Google Calendar API]（将来）
[外部cron (cron-job.org等)] --Bearer CRON_SECRET--> [/api/cron/reminders] --> [Web Push配信]
```

- Supabaseの全テーブルは **RLS有効・ポリシーなし**（= 公開キーでは何も読み書きできない）。API Routesだけが **secret key**（`sb_secret_...`、環境変数 `SUPABASE_SECRET_KEY`。旧 service_role キーの後継。Postgres上では service_role ロールとして動きRLSを迂回する）でアクセスする
- **service_roleへの権限付与が必要**: ダッシュボードで「Automatically expose new tables」を無効にしていると、新規テーブルへの権限が service_role にも自動付与されず `permission denied` になる。`20260715000001_grant_service_role.sql` で service_role にだけ明示的に `grant` している（RLSは有効のままなので公開キーは引き続き全拒否）
- publishable/anon などの公開キーはそもそもクライアントに配布しない（`NEXT_PUBLIC_` 環境変数に入れない）
- cron用ルートだけは外部から叩かれるため `CRON_SECRET` によるBearer認証を必須にする

### 2.1 認証なし運用の帰結（リスクの明文化）
- アプリ本体は認証なし。**URLを知っている人はUI経由で全データにアクセスできる**。これは仕様決定時に受容済みのリスク
- 緩和策: Vercelのプロジェクト名にランダム文字列を含めて推測困難にする（例: `zendo-x7k2p9`）、全ページに `X-Robots-Tag: noindex` を付与、URLを他人に共有しない
- 本構成の利点: URLが漏れてもDB接続情報自体は漏れない。URL変更（プロジェクトリネーム）だけで即座にアクセスを遮断できる

---

## 3. テーブル構成

実際のDDLは [supabase/migrations/20260714000001_init.sql](../supabase/migrations/20260714000001_init.sql) を参照。ここでは構造と意図を説明する。

```
habits ──< items（habit_id: 習慣インスタンス）
items ──< items（parent_id: Project>ToDo>子ToDo… の再帰階層）
items ──< items（generated_from: 繰り返しの前回→次回リンク）
items ──< reminders
push_subscriptions（独立: Web Push購読端末）
```

### 3.1 items（タスク / Project 共用）

| 列 | 型 | 意味 |
|---|---|---|
| id | uuid PK | |
| kind | enum: project / todo | 2026-07-16に'inbox'を廃止（Inboxはビュー。docs/design.md 8章） |
| title | text | |
| notes | text | Markdown本文。デフォルト空文字 |
| tags | text[] | 自由タグ。GINインデックス |
| is_memo | boolean | Notesビューに出す「メモ」フラグ |
| status | enum: todo / done / dropped | 2026-07-16に'doing'を廃止（docs/design.md 7.5） |
| parent_id | uuid → items | 親Project/親ToDo。親削除で子もカスケード削除 |
| habit_id | uuid → habits | 習慣インスタンスの場合のみ。**(habit_id, due_date)で部分ユニーク**＝同じ習慣を同じ日に二重生成できない |
| due_date | date | 期日（JSTの暦日） |
| due_time | time | 時刻（due_dateがある場合のみ許可。CHECK制約） |
| recurrence_rule | jsonb | 4章参照。due_dateがある場合のみ許可（CHECK制約） |
| generated_from | uuid → items | 繰り返しで「どの回から生成されたか」。部分ユニーク＝二重生成防止 兼 完了取り消し時の巻き戻しに使用 |
| postponed_count | int | 先送り回数。将来のAI介入判定（放置検出）用 |
| sort_order | double precision | 手動並べ替え用（新規は末尾+1、挿入は前後の中点） |
| done_at | timestamptz | 完了時刻 |
| captured_raw | text | オフラインキャプチャ時の生入力。オンライン復帰後の再パース用 |
| created_at / updated_at | timestamptz | updated_atはトリガーで自動更新 |

**is_memo をタグではなく専用列にした理由**: タグ`#memo`方式だとタイプミスや改名でメモが「行方不明」になる事故が起きうる。ビューの表示条件に使う属性は構造化しておく（spec.md 5章の❓を解消）。

**メモに期日を付けた場合**: そのままTodayビューにも出る。「この日に見返したいメモ」として機能するので許容（むしろ便利）。

### 3.2 habits（習慣マスター）

| 列 | 型 | 意味 |
|---|---|---|
| id | uuid PK | |
| title / notes / tags | | itemsと同様 |
| frequency_rule | jsonb | 5章参照。daily / every_n_days / times_per_week の3種（2026-07-16刷新） |
| default_reminder_rule | jsonb | インスタンス生成時に自動で付けるリマインダールール（6章の語彙。null可） |
| is_paused | boolean | 一時停止中はプランナーに出ない・実践率の分母にも入れない |
| sort_order | double precision | |
| created_at / updated_at | | |

### 3.3 reminders

| 列 | 型 | 意味 |
|---|---|---|
| id | uuid PK | |
| item_id | uuid → items | アイテム削除でカスケード削除 |
| rule | jsonb | 定義（6章の語彙）。期日変更時の再計算とインスタンス複製の元データ |
| remind_at | timestamptz | ruleを解決した実際の発火時刻。ディスパッチャはこれだけ読む |
| snoozed_until | timestamptz | スヌーズ先。発火判定は `coalesce(snoozed_until, remind_at)` |
| sent_at | timestamptz | 送信済みマーク。nullが「未送信」 |

### 3.4 push_subscriptions

Web Push購読端末（endpoint / p256dh / auth / user_agent / failed_count）。配信失敗が連続5回に達した購読は削除する（機種変更等で死んだ端末の掃除）。

---

## 4. 繰り返しエンジンの仕様

### 4.1 ルールのJSON表現（MVPで4種すべて実装）

```jsonc
{ "type": "daily" }                                    // 毎日
{ "type": "weekly", "weekdays": [1, 3, 5] }            // 毎週月水金（ISO: 1=月 … 7=日）
{ "type": "monthly_day", "day": 31 }                   // 毎月31日（短い月は月末にクランプ）
{ "type": "interval_days", "n": 3, "from": "schedule" }// 3日おき。from: "schedule" | "completion"
```

「第n曜日」（例: 第2土曜）はMVP対象外。将来 `{ "type": "monthly_nth_weekday", "nth": 2, "weekday": 6 }` として追加する。

### 4.2 次回生成の基本原則

**次回インスタンスは「現在の回を完了(done)にした瞬間」にサーバー側で生成する**。cronによる事前生成はしない。

理由（ADHD配慮の中核設計）: スケジュール通りに未完了インスタンスを積み上げると、数日サボっただけで「溜まった過去分」が画面を埋め、罪悪感でアプリ自体を開かなくなる。**未消化の過去回は積み上げない・遡って生成しない**。

### 4.3 次回期日の計算

```
base = max(今日(JST), 現在の回のdue_date)   // 期限切れ完了でも過去分を生成しないための下駄
daily:          base + 1日
weekly:         base より後で最初に weekdays に該当する日
monthly_day:    base より後で最初の「day日（月末クランプ）」
interval_days (from=schedule):    due_date + k*n のうち base より後の最小のもの（位相を保つ）
interval_days (from=completion):  今日(JST) + n
```

具体例:
- 毎週火曜のタスクを木曜に遅れて完了 → 次回は「来週の火曜」（今週分の巻き戻しはしない）
- 毎日のタスクを3日放置して完了 → 次回は「明日」1件のみ（3件溜まらない）
- 3日おき(schedule)を1日先送りして完了 → 位相は元のdue_date基準のまま進む
- 3日おき(completion)、例: 観葉植物の水やり → 完了した日から3日後

### 4.4 次回インスタンスに引き継ぐもの

| 引き継ぐ | 引き継がない |
|---|---|
| title, notes, tags, parent_id, due_time, recurrence_rule, sort_order, habit_id | 子ToDo（チェックリスト複製は将来機能）、postponed_count（0にリセット）、絶対時刻指定のリマインダー |
| 相対ルールのリマインダー（rule から remind_at を新期日で再計算して複製） | |

`generated_from` に元の回のidを記録する。

### 4.5 エッジケースの確定事項

| ケース | 挙動 |
|---|---|
| 期限切れのまま完了 | 4.3の`base`により、今日以降の直近1回だけ生成。過去分は永久に生成されない |
| 先送り（due_date変更） | その回のみ移動し `postponed_count` +1。weekly/monthly の位相は不変（ルール自体が暦に固定されているため）。interval(schedule) は位相ごと移動 |
| 破棄（dropped） | 連鎖終了。次回は生成しない。「繰り返しをやめる」操作を兼ねる |
| ルールの編集 | アクティブな回の `recurrence_rule` を編集＝次回以降に反映。過去の完了済み行には触らない |
| 完了の取り消し（undo） | `generated_from = 自分` の行が存在し、かつ `status='todo'` のままなら削除して巻き戻す。ユーザーが既に編集・着手していれば削除しない |
| 二重完了リクエスト | `generated_from` の部分ユニークインデックスがDBレベルで二重生成を防ぐ |
| recurrence_rule があるのに due_date がない | CHECK制約で禁止（次回計算の基準が存在しないため） |

---

## 5. 習慣とデイリープランナー

### 5.1 frequency_rule（2026-07-16刷新。docs/design.md 10.1が正）

```jsonc
{ "type": "daily" }                    // 毎日
{ "type": "every_n_days", "n": 3 }     // n日に1回
{ "type": "times_per_week", "n": 3 }   // 週n回（週は月曜はじまり・JST）
```

曜日固定の語彙は廃止——暦固定ルーチンは繰り返しタスク（recurrence_rule）で作る棲み分け。

### 5.2 インスタンス化の流れ

1. Todayビュー付属のデイリープランナーが「候補（下記）かつ 当日未生成 かつ 非pause」の習慣を表示。候補判定は**完了ログ依存**: daily=毎日 / every_n_days=最終完了からn日経過（実績ゼロなら毎日） / times_per_week=今週の完了数がn未満
2. ユーザーがピックすると `items` に行を生成: `kind='todo', habit_id=習慣id, due_date=今日`。title/notes/tagsは習慣マスターからコピー、`default_reminder_rule` があればリマインダーも生成
3. ピック解除＝その行を削除。「今日はやらない」＝ピックしない（行を作らない）だけ。**「やらなかった」ことを記録する操作は存在しない**（責めない設計）

`(habit_id, due_date)` のユニーク制約により同日二重生成はDBレベルで不可能。

### 5.3 実践ログ・継続指標の導出

- 実践ログ = `items where habit_id = X and status = 'done'` の due_date 集合
- ストリーク・おやすみ救済・今週の進捗・直近4週の達成率の定義は **docs/design.md 10.2 が正**（すべて実践ログから導出、保存列は増やさない）

**受容する不正確さ**: frequency_rule を変更したり pause した場合、過去分の分母も現在のルールで再計算される（ルール変更履歴は保持しない）。個人アプリでは許容し、問題になったら `habit_rule_history` を後付けする。

---

## 6. リマインダーパイプライン

### 6.1 ルールの語彙

```jsonc
{ "kind": "at", "at": "2026-07-20T15:00:00+09:00" }  // 絶対時刻（繰り返しには複製されない）
{ "kind": "on_due_at", "time": "08:00" }             // 当日の指定時刻
{ "kind": "day_before_at", "time": "20:00" }         // 前日の指定時刻
{ "kind": "before_due_minutes", "minutes": 60 }      // 期限のn分前（due_time必須。バリデーションで担保）
```

- 作成時に rule → `remind_at`（絶対時刻）へ解決して保存。**due_date/due_time を変更したら、そのitemの相対ルールのリマインダーを全て再計算する**（サーバー側の更新処理に組み込む）
- 1つのitemに複数リマインダー可（例: 前日20時 + 当日朝8時 + 1時間前）

### 6.2 配信（ディスパッチャ）

```
外部cron --毎分--> GET /api/cron/reminders (Bearer CRON_SECRET)
  1. UPDATE reminders SET sent_at = now()
     WHERE sent_at IS NULL AND coalesce(snoozed_until, remind_at) <= now()
     RETURNING *      ← 先にマークしてから送る（at-most-once。二重通知より取りこぼしの方がマシ…ではないが、
                         毎分pollなので実質的な取りこぼし窓は極小。リトライ列の追加は将来課題）
  2. 各 push_subscriptions へ web-push 送信
  3. 失敗した購読は failed_count+1、連続5回で購読行を削除
```

- **インフラ注意**: Vercel Hobby プランのcronは実行頻度が粗い（分単位の定期実行に使えない）ため、外部の無料cronサービス（cron-job.org 等、1分間隔可）からAPIを叩く構成にする。Supabase pg_cron はベンダー結合になるため使わない（ポータビリティ方針）
- スヌーズ: `snoozed_until` を設定し `sent_at` をnullに戻す → 次のpollで再発火。プリセットは「1時間後」「明日の朝（9:00）」＋任意時刻

---

## 7. Inboxビューと仕分け（2026-07-16の統合後）

**「inbox」というkind・状態・遷移は存在しない**（docs/design.md 8章）。Inbox画面は検索条件 `kind='todo' AND due_date IS NULL AND parent_id IS NULL AND is_memo=false AND status='todo'` のビュー。

| 操作 | 実装 |
|---|---|
| キャプチャ | `items` に `kind='todo'`・期日なしで insert → 定義によりInboxビューに現れる。Smart Inputが解釈した due_date/tags 等は insert 時点で列に反映済み（プレビュー→確定を経るため）。生文字列は `captured_raw` に保持 |
| 仕分け（今日/明日） | `due_date` を設定するだけ → ビューから自然に消える |
| 期日の✕クリア | `due_date` を null に → ビューに自然に現れる（特別な遷移ルールなし） |
| Project化 | `kind='project'` に更新（詳細モーダルの「⋯→Projectに変換」） |
| ToDo ⇄ Project | kind更新のみで昇格・降格可能（単一テーブルの利点） |

---

## 8. 将来拡張への備え（今は作らないが設計上考慮済み）

- **オフライン同期**: UUID主キー＋updated_at（Last-Write-Wins）を前提に設計済み。同期キューの設計は着手時に別ドキュメントで
- **Googleカレンダー同期**: `calendar_sync_links (item_id, google_event_id, last_synced_at)` テーブルを追加するだけで載る。itemsへの列追加は不要
- **AI介入（放置検出）**: `updated_at` と `postponed_count` が判定材料としてそのまま使える
- **習慣頻度の柔軟化・第n曜日**: jsonbルールへの type 追加のみ。スキーマ変更不要

---

## 9. マイグレーション運用

- [supabase/migrations/](../supabase/migrations/) にタイムスタンプ付きSQLファイルを置き、Supabase CLI（`supabase db push`）で適用する
- スキーマ変更は必ず新しいマイグレーションファイルの追加で行う（既存ファイルは編集しない）

---

## 10. 実装への引き継ぎ事項（次セッション向け）

1. Supabaseプロジェクトを作成し、`20260714000001_init.sql` を適用する
2. API Routesのデータ層は `src/lib/db.ts`（service_roleクライアント、server-only）を使う。クライアントコンポーネントからSupabaseを直接importしてはならない
3. 「ToDo完了」のAPIは必ず本ドキュメント4章のセマンティクス（次回生成・undo・二重生成防止）を実装すること
4. due_date/due_time 変更時のリマインダー再計算（6.1）を更新APIに組み込むこと
