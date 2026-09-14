// GET /api/today — Todayビュー用データ。
//  - todos: 未完了ToDo（期日が今日以前＝今日分＋期限超過）。習慣インスタンスも含む
//  - habitCandidates: 今日が該当日で、まだ当日インスタンス未生成の非pause習慣（デイリープランナー候補）
//  - done: 今日(JST)完了したToDo（「完了済み n件」折りたたみ用。docs/design.md 2章）
// 集計本体は src/lib/today-data.ts（LINEの定時配信と共用）。
import { handle, json } from "@/lib/api";
import { loadTodayData } from "@/lib/today-data";

export function GET(): Promise<Response> {
  return handle(async () => {
    const { date, todos, habitCandidates, done } = await loadTodayData();
    return json({ date, todos, habitCandidates, done });
  });
}
