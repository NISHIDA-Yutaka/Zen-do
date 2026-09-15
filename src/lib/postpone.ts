// 先送りの判定（docs/line-plan.md 9.0）。
// postponed_count は「引っかかっているタスク」の検出に使う（9.2）。
// 期日を後ろへ動かした時だけ数える。前倒し・期日の付け外しは先送りではない。

/** 期日が後ろに動いたか。'YYYY-MM-DD' は辞書順＝時系列順 */
export function shouldCountPostpone(oldDue: string | null, newDue: string | null): boolean {
  // 期日なし→設定（Inboxからの仕分け）と、期日を外す（Inboxへ戻す）は先送りに数えない
  if (!oldDue || !newDue) return false;
  return newDue > oldDue;
}
