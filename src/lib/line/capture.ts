// LINEに書いた一言をタスクにする（docs/line-plan.md 3章）。
// 画面のクイック入力と同じ Smart Input を通すので、「明日15時 歯医者 #病院」がそのまま効く。
import "server-only";
import { db } from "@/lib/db";
import { formatDueFull } from "@/lib/format";
import { parseSmartInput, type ProjectRef } from "@/lib/smart-input";
import type { Item } from "@/lib/types";

async function projectRefs(): Promise<ProjectRef[]> {
  const { data, error } = await db
    .from("items")
    .select("id,title")
    .eq("kind", "project")
    .eq("status", "todo");
  if (error) throw new Error(error.message);
  return (data ?? []) as ProjectRef[];
}

/** 登録して、その結果を伝える文面を返す */
export async function captureFromText(text: string, today: string): Promise<string> {
  const raw = text.trim();
  if (!raw) return "何を登録しますか？";

  const parsed = parseSmartInput(raw, { today, projects: await projectRefs() });
  // 日付やタグだけ書かれてタイトルが空になった場合は、勝手に登録せず聞き返す
  if (!parsed.title) return `「${raw}」だけでは何をするのか分かりませんでした。用件も書いてください。`;

  const insert = {
    kind: "todo" as const,
    title: parsed.title,
    notes: "",
    tags: parsed.tags,
    status: "todo" as const,
    parent_id: parsed.projectId,
    due_date: parsed.dueDate,
    due_time: parsed.dueTime,
    captured_raw: raw,
  };
  const { data, error } = await db.from("items").insert(insert).select("*").single();
  if (error) throw new Error(error.message);
  const item = data as Item;

  const when = item.due_date
    ? formatDueFull(item.due_date, item.due_time, today).text
    : "Inbox（期限なし）";
  const tags = item.tags.length > 0 ? `\n#${item.tags.join(" #")}` : "";
  return `登録しました。\n${item.title}\n${when}${tags}`;
}
