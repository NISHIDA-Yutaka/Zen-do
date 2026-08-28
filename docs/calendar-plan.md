# カレンダー（タイムライン）実装計画

作成: 2026-08-28（設計セッション）。実装担当への引き継ぎ文書。
実装が終わった段階で docs/design.md に「20. カレンダー」として実装済み仕様を起こし、spec.md の実装状況を更新すること。この文書はその後も「決定の経緯」として残す。

## 0. 決定事項（経緯）

- 方針比較の結果「**Zendo内タイムライン（FullCalendar採用）**」を先行し、Googleカレンダー同期は将来段階とする
  - 理由: OAuth・同期メンテの運用負担をソロ運用で抱えるのは価値が確定してから。内蔵タイムラインはZendoの操作（完了・先送り・分解）と直結でき、ADHD支援としての価値が高い
- ライブラリは **FullCalendar v6**（コアMIT）。日/週/月表示・ドラッグ移動・下端リサイズ・タッチ（長押しドラッグ）が全部入りで、自作は勧めない判断
- `time_kind`（時刻が「期限」か「開始」か）は**今回は追加しない**。Googleの予定を受け取る段階（§7）まで不要

## 1. データモデル

migration `supabase/migrations/20260828000001_item_duration.sql`:

```sql
alter table items add column duration_min integer
  check (duration_min is null or (duration_min > 0 and duration_min <= 1440));
comment on column items.duration_min is '所要時間（分）。カレンダーのブロック長。nullは未見積り';
```

- `due_time` なしでも `duration_min` は持てる（見積りだけ先に付ける使い方を許す）。カレンダーは `due_time` があるものだけブロック描画に使う
- `Item` 型（src/lib/types.ts）に `duration_min: number | null` を追加
- validation.ts の create/update スキーマに `duration_min: z.number().int().min(1).max(1440).nullable().optional()`
- `PATCH /api/items/[id]` の更新ホワイトリスト（route.ts内の `for (const key of [...])`）に `duration_min` を追加

## 2. API

新エンドポイントは作らない。`GET /api/items` に範囲パラメータを追加（design.md 12.5 の `due_after` と同じ拡張方式）:

- `due_from=YYYY-MM-DD` → `.gte("due_date", ...)`
- `due_to=YYYY-MM-DD` → `.lte("due_date", ...)`
- `statuses=todo,done` → `.in("status", ...)`。**省略時は従来どおり絞り込まない**（既存呼び出しの挙動を変えないため。status指定なしだと dropped も返る）ので、カレンダーは必ず `statuses=todo,done` を渡す

カレンダーは表示中の範囲が変わるたび（FullCalendar の `datesSet`）にこのクエリをSWRキーとして取得する。習慣インスタンスも items 行なので自動的に含まれる。

## 3. 画面 `/calendar`

- 新ルート `src/app/calendar/page.tsx` ＋ `src/components/calendar-view.tsx`（"use client"）
- ナビ（app-shell.tsx の配列）に `{ href: "/calendar", label: "Calendar" }` を追加。6タブになるのでスマホ下部ナビの幅・文字サイズを確認し、収まらなければラベル短縮や調整を検討
- パッケージ: `@fullcalendar/react` `@fullcalendar/core` `@fullcalendar/timegrid` `@fullcalendar/daygrid` `@fullcalendar/interaction`
- ビュー:
  - PC（`isFinePointer()`＝src/lib/pointer.ts）: 初期 `timeGridWeek`
  - タッチ: 初期 3日表示（`views: { timeGridThreeDay: { type: "timeGrid", duration: { days: 3 } } }`）。週7列はスマホ幅に入らないための割り切り
  - 切替ボタンで日/週(3日)/月（`dayGridMonth`）
- タイムゾーン: FullCalendarはデフォルトのローカル時刻のまま使う（利用者はJST運用）。イベントは `start: \`${due_date}T${due_time}\`` の文字列で渡し、TZライブラリは入れない

## 4. 描画規則

| 対象 | 描画 |
|---|---|
| `due_time` あり | 時間ブロック。長さ = `duration_min`（nullは `defaultTimedEventDuration: "00:30"` で30分仮描画） |
| `due_time` なし | 全日（allDay）欄 |
| `status='done'` | 淡色＋打ち消し線（nibi系）。todoは通常色 |
| 習慣インスタンス（`habit_id` あり） | asagi系で描き分け（メタ行チップと同系統） |

配色は design.md 1章の7系統トークンから。FullCalendar v6 は `--fc-*` CSS変数で公式にテーマ変更できるので、globals.css で `--fc-border-color: var(--color-keisen)` のように割り当てる（`!important` 不要）。細部はFCのクラスに対するCSS上書きになるが最小限に留める。

## 5. 操作

すべて既存パターン（SWR楽観的更新 + 失敗時rollback、docs/design.md 17章）に従う。

- **タップ/クリック**（`eventClick`）→ 既存 `ItemModal` を開く（notes-view.tsx の `openId` パターン流用）
- **ドラッグ移動**（`eventDrop`）→ `PATCH { due_date, due_time }`。全日欄→時間軸へのドロップは時刻付与、逆は `due_time: null`
- **下端リサイズ**（`eventResize`）→ `PATCH { duration_min }`（開始と終了の差分から算出）
- 失敗時は `info.revert()` を呼んでFC側の表示も戻す
- `snapDuration: "00:15"`、`slotDuration: "00:30"`
- **空き枠の選択→クイック追加はフェーズ2**（最初は入れない）
- doneのブロックはドラッグ・リサイズ不可（`editable: false` を個別イベントに指定）

### ItemModal への追加

期日行の並びに「所要時間」フィールドを追加（分単位の数値、空=null）。カレンダーを開かなくても見積もれるようにする。

## 6. 実装フェーズ（この順で。各フェーズごとに動作確認）

1. **DB+API**: migration、types、validation、PATCH/POSTホワイトリスト、`due_from/due_to/statuses`。テスト追加は提案の上で承認を得る（CLAUDE.md）
2. **表示のみ**: `/calendar` ルート＋FullCalendar導入＋描画規則＋タップでItemModal。ドラッグ無効で出す
3. **操作**: ドラッグ移動・リサイズ・楽観的更新・revert
4. **仕上げ**: `--fc-*` テーマ調整、スマホ3日表示・長押しドラッグの実機確認、ItemModalの所要時間フィールド
5. 完了後: design.md に20章として実装済み仕様を記載、spec.md の実装状況更新（ユーザー確認の上で）

## 7. 将来（今回のスコープ外）

- **Google読み取り連携**: Googleの既存予定を表示専用レイヤーとしてタイムラインに重ねる（OAuth必要）。この段階で `time_kind` 相当（期限か開始か）の区別を導入する
- **Google書き込み同期**: 対応表 `calendar_links`（item_id / gcal_calendar_id / gcal_event_id / gcal_etag / last_pushed_hash / synced_at）＋専用「Zendo」カレンダー方式。増分同期は `sync_token` 保存。Zendoの `interval_days from completion` はRRULE表現不可のため当日インスタンスのみ送る
- 空き枠タップでのクイック追加

## 8. 実装上の注意

- **着手前に `node_modules/next/dist/docs/` の該当ガイドを読むこと**（AGENTS.md。このNext.jsは学習データと異なる）
- FullCalendarコンポーネントは client component。SSRで落ちる場合は `next/dynamic` の `ssr: false` を検討
- styled-components・インラインスタイル・`!important` 禁止（CLAUDE.md）。FCのテーマはCSS変数で
- コミットはフェーズ単位で、ユーザー確認の上で行う
