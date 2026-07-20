// GET /api/projects — Projects画面用（docs/design.md 9章）。
// 最上位プロジェクト＋直接子ToDoの集計（残り n/m・次の期日）を返す。
import { handle, json } from "@/lib/api";
import { db } from "@/lib/db";
import type { Item } from "@/lib/types";

export type ProjectRow = Item & {
  childTotal: number; // 直接子のうち破棄以外の総数
  childRemaining: number; // 未完了(status='todo')の直接子
  nextDue: string | null; // 未完了子の最小 due_date（超過判定は画面側）
};

export function GET(): Promise<Response> {
  return handle(async () => {
    const { data: projData, error: projErr } = await db
      .from("items")
      .select("*")
      .eq("kind", "project")
      .eq("status", "todo")
      .is("parent_id", null)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (projErr) throw new Error(projErr.message);
    const projects = (projData ?? []) as Item[];

    if (projects.length === 0) return json({ projects: [] });

    const { data: childData, error: childErr } = await db
      .from("items")
      .select("parent_id, status, due_date")
      .in(
        "parent_id",
        projects.map((p) => p.id),
      );
    if (childErr) throw new Error(childErr.message);
    const children = (childData ?? []) as Pick<Item, "parent_id" | "status" | "due_date">[];

    const rows: ProjectRow[] = projects.map((p) => {
      const mine = children.filter((c) => c.parent_id === p.id && c.status !== "dropped");
      const remaining = mine.filter((c) => c.status === "todo");
      const nextDue = remaining
        .map((c) => c.due_date)
        .filter((d): d is string => d !== null)
        .reduce<string | null>((a, d) => (a === null || d < a ? d : a), null);
      return {
        ...p,
        childTotal: mine.length,
        childRemaining: remaining.length,
        nextDue,
      };
    });

    return json({ projects: rows });
  });
}
