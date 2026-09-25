// 一覧の親子組み立て（docs/design.md 2章）。表示は1階層だけで、孫は詳細モーダルで潜る。
import type { Item } from "@/lib/types";

export type TaskRow = { item: Item; children: Item[] };

// 親が最上位の行として並ぶ子は、単独の行にせず親の下にだけ出す（同じタスクが2か所に出ないように）。
// 親そのものが別の親の下に入った場合、その子を隠すと孫が一覧から消えてしまうので最上位に残す
function topLevelIds(items: Item[]): Set<string> {
  const byId = new Map(items.map((i) => [i.id, i]));
  const memo = new Map<string, boolean>();
  const isTop = (item: Item, depth: number): boolean => {
    const known = memo.get(item.id);
    if (known !== undefined) return known;
    const parent = item.parent_id ? byId.get(item.parent_id) : undefined;
    // 深さの上限は親子の循環（データ破損）で無限再帰しないための保険
    const top = !parent || depth > items.length || !isTop(parent, depth + 1);
    memo.set(item.id, top);
    return top;
  };
  return new Set(items.filter((i) => isTop(i, 0)).map((i) => i.id));
}

/** items の並び順を保ったまま、最上位の行とその未完了の子にまとめる */
export function nestChildren(items: Item[], children: Item[]): TaskRow[] {
  const tops = topLevelIds(items);
  const nestedFromList = items.filter((i) => !tops.has(i.id));
  const seen = new Set<string>();
  const byParent = new Map<string, Item[]>();
  for (const child of [...children, ...nestedFromList]) {
    if (!child.parent_id || !tops.has(child.parent_id) || seen.has(child.id)) continue;
    seen.add(child.id);
    byParent.set(child.parent_id, [...(byParent.get(child.parent_id) ?? []), child]);
  }
  return items
    .filter((i) => tops.has(i.id))
    .map((item) => ({ item, children: byParent.get(item.id) ?? [] }));
}
