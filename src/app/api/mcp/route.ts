// MCPエンドポイント（Streamable HTTP）。docs/mcp-integration.md / mcp-implementation-plan.md。
// 第1段: 参照ツールのみ。ツール定義とJSON整形だけを持ち、ロジックは src/lib/mcp に置く。
// マウント位置(/api/mcp)がそのままエンドポイントURLになる（mcp-handler v2）。
import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import {
  addHabitToday,
  completeTask,
  createTask,
  setDue,
  uncompleteTask,
} from "@/lib/mcp/mutations";
import {
  findTask,
  getStatus,
  getTaskDetail,
  listHabits,
  listInbox,
  listToday,
  listUpcoming,
} from "@/lib/mcp/queries";

// Supabase SDK を使うため Node ランタイムで動かす
export const runtime = "nodejs";

function ok(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
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
  .describe("操作対象の現在のタイトル（取り違え防止のため実タイトルと一致が必要）");

const handler = createMcpHandler((server) => {
  server.registerTool(
    "get_status",
    {
      title: "今日の状況サマリ",
      description:
        "今日のタスク・期限超過・Inbox未仕分けを1回でまとめて返す。会話の起点に使う。" +
        "overdue には期限を過ぎたタスク（過去日 or 当日で時刻超過）、inbox の stale_days は放置日数。" +
        "放置が長いタスクは会話で触れて再スケジュールを促すとよい。",
      inputSchema: z.object({}),
    },
    async () => ok(await getStatus()),
  );

  server.registerTool(
    "list_today",
    {
      title: "今日のタスク一覧",
      description:
        "今日やるべき未完了タスク（期日が今日以前＝当日分＋期限超過）と、今日完了した分を返す。" +
        "overdue=true は期限超過。習慣インスタンスも含む（is_habit=true）。",
      inputSchema: z.object({}),
    },
    async () => ok(await listToday()),
  );

  server.registerTool(
    "list_inbox",
    {
      title: "Inbox（未仕分け）一覧",
      description:
        "期日が未設定の未仕分けタスク。stale_days は作成からの放置日数。" +
        "7日以上放置のものは「いつやりますか？」と会話で促し、set_due で期日を付けると片付く（第2段のツール）。",
      inputSchema: z.object({}),
    },
    async () => ok(await listInbox()),
  );

  server.registerTool(
    "list_upcoming",
    {
      title: "この先の予定",
      description: "今日より後で、指定日数以内に期日があるタスクを日付順に返す。",
      inputSchema: z.object({
        days: z.number().int().min(1).max(365).optional().describe("今日から何日先まで見るか（既定14）"),
      }),
    },
    async ({ days }) => ok(await listUpcoming(days ?? 14)),
  );

  server.registerTool(
    "get_task",
    {
      title: "タスクの詳細",
      description:
        "1件のタスクの詳細（メモ・子ToDo・リマインダー・繰り返し設定）を返す。id は他ツールの返り値から取得する。",
      inputSchema: z.object({ id: z.string().uuid().describe("タスクのUUID") }),
    },
    async ({ id }) => {
      const res = await getTaskDetail(id);
      if (!res) return ok({ error: "指定IDのタスクが見つかりません", id });
      return ok(res);
    },
  );

  server.registerTool(
    "find_task",
    {
      title: "タスクを検索",
      description:
        "タイトルの部分一致でタスク候補を返す（未完了を優先）。" +
        "**候補が複数あるときは自動で1件に決めず、ユーザーに確認すること**。0件なら空配列で返る。" +
        "第2段の操作ツールに渡す id を特定する用途。",
      inputSchema: z.object({ query: z.string().min(1).describe("タイトルに含まれる文字列") }),
    },
    async ({ query }) => ok(await findTask(query)),
  );

  server.registerTool(
    "list_habits",
    {
      title: "習慣一覧と継続指標",
      description:
        "習慣ごとの継続記録（streak/streak_unit）・今週または今月の進捗・今日の候補かどうか（is_today_candidate）を返す。" +
        "『Duolingoは969日連続です』のように継続を会話に反映できる。",
      inputSchema: z.object({}),
    },
    async () => ok(await listHabits()),
  );

  // ---- 操作ツール（書き込み。削除・破棄は渡さない） ----

  server.registerTool(
    "create_task",
    {
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
    },
    async (args) => ok(await createTask(args)),
  );

  server.registerTool(
    "complete_task",
    {
      title: "タスクを完了",
      description:
        "タスクを完了にする。繰り返しタスクなら次回が自動生成され、習慣なら継続記録に加算される。" +
        "id は find_task/list_* で得たものを使い、expected_title にその時のタイトルを渡すこと。",
      inputSchema: z.object({ id: z.string().uuid(), expected_title: expectedTitle }),
    },
    async ({ id, expected_title }) => ok(await completeTask(id, expected_title)),
  );

  server.registerTool(
    "uncomplete_task",
    {
      title: "完了を取り消す",
      description: "完了済みタスクを未完了に戻す。繰り返しで生成された次回分があれば巻き戻す。",
      inputSchema: z.object({ id: z.string().uuid(), expected_title: expectedTitle }),
    },
    async ({ id, expected_title }) => ok(await uncompleteTask(id, expected_title)),
  );

  server.registerTool(
    "set_due",
    {
      title: "期日を変更",
      description:
        "タスクの期日（と任意で時刻）を変更する。due_date に null を渡すと期日を外して Inbox へ戻す。" +
        "ただし繰り返しタスクは期日クリアで繰り返し設定が消えるため拒否される（具体的な日付への変更は可）。" +
        "due_time を省略した日付変更は既存の時刻を保持する。",
      inputSchema: z.object({
        id: z.string().uuid(),
        expected_title: expectedTitle,
        due_date: dateStr.nullable().describe("新しい期日。null で期日を外す（Inboxへ）"),
        due_time: timeStr.optional(),
      }),
    },
    async ({ id, expected_title, due_date, due_time }) =>
      ok(await setDue(id, expected_title, due_date, due_time)),
  );

  server.registerTool(
    "add_habit_today",
    {
      title: "習慣を今日のタスクに追加",
      description:
        "習慣を当日タスクとして生成する（Habits画面の『今日やる』相当）。habit_id は list_habits で得る。" +
        "同日に二重生成はされない（既に追加済みならその旨を返す）。",
      inputSchema: z.object({ habit_id: z.string().uuid(), expected_title: expectedTitle }),
    },
    async ({ habit_id, expected_title }) => ok(await addHabitToday(habit_id, expected_title)),
  );
});

// Bearer認証（cronルートと同じ流儀・フェイルクローズ）。MCPは全タスクを読み書きできるため、
// 公開URL上では必ずトークンで守る。MCP_TOKEN 未設定なら全リクエストを拒否＝本番に env を
// 入れるまでMCPは無効。ローカル検証は .env.local に MCP_TOKEN を設定し、クライアントから
// Authorization: Bearer <MCP_TOKEN> を送る（mcp-remote は --header で付与）。
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

const guarded = authed(handler);
export { guarded as GET, guarded as POST };
