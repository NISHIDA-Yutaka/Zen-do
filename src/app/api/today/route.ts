// GET /api/today — Todayビュー用データ。
//  - todos: 未完了ToDo（期日が今日以前＝今日分＋期限超過）。習慣インスタンスも含む
//  - habitCandidates: 今日が該当日で、まだ当日インスタンス未生成の非pause習慣（デイリープランナー候補）
//  - done: 今日(JST)完了したToDo（「完了済み n件」折りたたみ用。docs/design.md 2章）
//  - children: todos の未完了の子（一覧で親の下に展開する）
// 集計本体は src/lib/today-data.ts（LINEの定時配信と共用）。
import { handle, json } from "@/lib/api";
import { loadOpenChildren } from "@/lib/items";
import { loadTodayData } from "@/lib/today-data";

export function GET(): Promise<Response> {
  return handle(async () => {
    const { date, todos, habitCandidates, done } = await loadTodayData();
    // LINE配信は子を使わないので、共用の loadTodayData ではなく画面用のここで取る
    const children = await loadOpenChildren(todos.map((t) => t.id));
    return json({ date, todos, habitCandidates, done, children });
  });
}
