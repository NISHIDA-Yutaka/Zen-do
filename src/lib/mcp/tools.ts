// Zendo の操作ツールの定義（名前・説明・入力スキーマ・実処理）。ロジックは queries/mutations に置く。
// MCP（src/lib/mcp/server.ts）と LINE の会話（src/lib/line/chat.ts）で同じ定義を使う
// （docs/line-plan.md 10.3。二重に書くと説明や制約がずれていくため）。
import "server-only";
import { z } from "zod";
import {
  addHabitToday,
  completeTask,
  createTask,
  setDue,
  uncompleteTask,
  updateNotes,
} from "@/lib/mcp/mutations";
import {
  findTask,
  getNotes,
  getStatus,
  getTaskDetail,
  listHabits,
  listInbox,
  listToday,
  listUpcoming,
} from "@/lib/mcp/queries";

export type ToolDef = {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodObject;
  /** 引数はここで入力スキーマに通してから実処理へ渡す（Gemini の引数は未検証で来るため） */
  run: (args: unknown) => Promise<unknown>;
};

function defineTool<S extends z.ZodObject>(def: {
  name: string;
  title: string;
  description: string;
  inputSchema: S;
  run: (args: z.infer<S>) => Promise<unknown>;
}): ToolDef {
  return { ...def, run: (args) => def.run(def.inputSchema.parse(args)) };
}

const dateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD 形式で指定してください")
  .describe("期日（YYYY-MM-DD・JSTの暦日）");
const timeStr = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM 形式で指定してください")
  .describe("時刻（HH:MM・24時間制）");
const expectedTitle = z
  .string()
  .min(1)
  .describe(
    "操作対象の現在のタイトル。取り違え防止のため、前後の空白を除いて実タイトルと完全一致が必要。" +
      "一致しなければ何も変更せず、実際のタイトル付きのエラーを返す",
  );
const taskId = z.string().uuid().describe("タスクのUUID（find_task や list_* の返り値の id）");
const habitId = z.string().uuid().describe("習慣のUUID（list_habits の返り値の id）");

export const TOOLS: ToolDef[] = [
  defineTool({
    name: "get_status",
    title: "今日の状況サマリ",
    description:
      "今日のタスク・期限超過・Inbox未仕分けを1回でまとめて返す。会話の起点に使う。" +
      "overdue には期限を過ぎたタスク（過去日 or 当日で時刻超過）、inbox の stale_days は放置日数。",
    inputSchema: z.object({}),
    run: () => getStatus(),
  }),
  defineTool({
    name: "list_today",
    title: "今日のタスク一覧",
    description:
      "今日やるべき未完了タスク（期日が今日以前＝当日分＋期限超過）と、今日完了した分を返す。" +
      "overdue=true は期限超過。習慣インスタンスも含む（is_habit=true）。",
    inputSchema: z.object({}),
    run: () => listToday(),
  }),
  defineTool({
    name: "list_inbox",
    title: "Inbox（未仕分け）一覧",
    description:
      "期日が未設定の未仕分けタスク（プロジェクトの子と #memo 付きは除く）を返す。stale_days は作成からの放置日数。" +
      "期日を付けて仕分けるには set_due を使う。",
    inputSchema: z.object({}),
    run: () => listInbox(),
  }),
  defineTool({
    name: "list_upcoming",
    title: "この先の予定",
    description:
      "今日より後で、指定日数以内に期日がある未完了タスクを日付・時刻順に返す。" +
      "最大100件で打ち切られ、打ち切りは返り値に示されないので、件数が多い期間は days を短くして分けて呼ぶ。",
    inputSchema: z.object({
      days: z.number().int().min(1).max(365).optional().describe("今日から何日先まで見るか（既定14）"),
    }),
    run: ({ days }) => listUpcoming(days ?? 14),
  }),
  defineTool({
    name: "get_task",
    title: "タスクの詳細",
    description:
      "1件のタスクの詳細（メモ・子ToDo・リマインダー・繰り返し設定）を返す。id は他ツールの返り値から取得する。",
    inputSchema: z.object({ id: z.string().uuid().describe("タスクのUUID") }),
    run: async ({ id }) => (await getTaskDetail(id)) ?? { error: "指定IDのタスクが見つかりません", id },
  }),
  defineTool({
    name: "get_notes",
    title: "メモを読む",
    description:
      "タスクの現在のメモ本文を返す。メモを書き換える前に、まずこれで現状を読むこと（update_notes の前段）。",
    inputSchema: z.object({ id: z.string().uuid().describe("タスクのUUID") }),
    run: ({ id }) => getNotes(id),
  }),
  defineTool({
    name: "find_task",
    title: "タスクを検索",
    description:
      "タイトルの部分一致でタスク候補を返す（未完了が先、完了済みも含む。最大100件）。0件なら空配列で返る。" +
      "complete_task・set_due などの操作ツールに渡す id を特定する用途。" +
      "候補が複数あるときは1件に決めず、どれか本人に確認する（取り違えると別のタスクを完了・変更してしまうため）。",
    inputSchema: z.object({ query: z.string().min(1).describe("タイトルに含まれる文字列") }),
    run: ({ query }) => findTask(query),
  }),
  defineTool({
    name: "list_habits",
    title: "習慣一覧と継続指標",
    description:
      "習慣ごとの継続記録（streak/streak_unit）・今週または今月の進捗・今日の候補かどうか（is_today_candidate）を返す。",
    inputSchema: z.object({}),
    run: () => listHabits(),
  }),

  // ---- 操作ツール（書き込み。削除・破棄は渡さない） ----

  defineTool({
    name: "create_task",
    title: "タスクを追加",
    description:
      "新しいタスクを作成する。due_date を省略すると Inbox（未仕分け）に入る。" +
      "due_date＋due_time を付けるとその時刻に通知が自動で付く。相対日付はツール返り値の today を基準に自分でYYYY-MM-DDへ変換すること。",
    inputSchema: z.object({
      title: z.string().min(1).describe("タスクのタイトル"),
      due_date: dateStr.optional(),
      due_time: timeStr.optional(),
      tags: z.array(z.string()).optional().describe("タグ（#は不要）"),
      parent_id: z.string().uuid().optional().describe("プロジェクト/親タスクのUUID"),
    }),
    run: (args) => createTask(args),
  }),
  defineTool({
    name: "complete_task",
    title: "タスクを完了",
    description:
      "タスクを完了にする。繰り返しタスクなら次回が自動生成され、習慣なら継続記録に加算される。" +
      "id は find_task/list_* で得たものを使い、expected_title にその時のタイトルを渡すこと。",
    inputSchema: z.object({ id: taskId, expected_title: expectedTitle }),
    run: ({ id, expected_title }) => completeTask(id, expected_title),
  }),
  defineTool({
    name: "uncomplete_task",
    title: "完了を取り消す",
    description: "完了済みタスクを未完了に戻す。繰り返しで生成された次回分があれば巻き戻す。",
    inputSchema: z.object({ id: taskId, expected_title: expectedTitle }),
    run: ({ id, expected_title }) => uncompleteTask(id, expected_title),
  }),
  defineTool({
    name: "set_due",
    title: "期日を変更",
    description:
      "タスクの期日（と任意で時刻）を変更する。due_date に null を渡すと期日を外して Inbox へ戻す。" +
      "ただし繰り返しタスクは期日クリアで繰り返し設定が消えるため拒否される（具体的な日付への変更は可）。" +
      "due_time を省略した日付変更は既存の時刻を保持する。",
    inputSchema: z.object({
      id: taskId,
      expected_title: expectedTitle,
      due_date: dateStr.nullable().describe("新しい期日。null で期日を外す（Inboxへ）"),
      due_time: timeStr.optional(),
    }),
    run: ({ id, expected_title, due_date, due_time }) => setDue(id, expected_title, due_date, due_time),
  }),
  defineTool({
    name: "add_habit_today",
    title: "習慣を今日のタスクに追加",
    description:
      "習慣を当日タスクとして生成する（Habits画面の『今日やる』相当）。habit_id は list_habits で得る。" +
      "同日に二重生成はされない（既に追加済みならその旨を返す）。",
    inputSchema: z.object({ habit_id: habitId, expected_title: expectedTitle }),
    run: ({ habit_id, expected_title }) => addHabitToday(habit_id, expected_title),
  }),
  defineTool({
    name: "update_notes",
    title: "メモを更新",
    description:
      "タスクのメモ（notes）を書き換える。append=true で既存メモの末尾に追記（会話で聞き取った状況や不足情報の記録に使う）、" +
      "append=false（既定）で全文置換。全置換の前は get_notes で現状を読むこと。" +
      "id は find_task/list_* で得たものを使い、expected_title に現在のタイトルを渡す（取り違え防止）。",
    inputSchema: z.object({
      id: taskId,
      expected_title: expectedTitle,
      notes: z.string().max(8000).describe("append=true なら追記する文、false なら置き換える全文"),
      append: z.boolean().optional().describe("true=末尾に追記 / false（既定）=全文置換"),
    }),
    run: ({ id, expected_title, notes, append }) => updateNotes(id, expected_title, notes, append ?? false),
  }),
];
