// 右クリックメニューの日時の付け直し（docs/design.md 2章）。Smart Input と同じ語彙で日付・時刻だけを読む。
import { parseSmartInput } from "@/lib/smart-input";

/** PATCH /api/items/:id に渡す差分。due_time を省いた更新はサーバー側で既存の時刻が保たれる */
export type DuePatch = { due_date: string; due_time?: string };

/**
 * 付け直し用の入力を解釈する。日付・時刻以外の語が混じっていたら null（取り違えて保存しないため）。
 * - 日付だけ: 時刻は今のまま（右クリックの「明日へ」やMCPの set_due と同じ）
 * - 時刻だけ: 期日は今のまま時刻だけ変える。期日が無ければ今日。
 *   Smart Input の「時刻だけなら今日」と違うのは、付け直しでは今の期日を起点に考える方が自然なため
 */
export function parseDueInput(
  text: string,
  opts: { today: string; currentDate: string | null },
): DuePatch | null {
  const parsed = parseSmartInput(text, { today: opts.today });
  if (parsed.title !== "") return null;
  if (parsed.tokens.some((t) => t.kind !== "date" && t.kind !== "time")) return null;
  const date = parsed.tokens.find((t) => t.kind === "date")?.value;
  const time = parsed.tokens.find((t) => t.kind === "time")?.value;
  if (!date && !time) return null;
  const dueDate = date ?? opts.currentDate ?? opts.today;
  return time ? { due_date: dueDate, due_time: time } : { due_date: dueDate };
}
