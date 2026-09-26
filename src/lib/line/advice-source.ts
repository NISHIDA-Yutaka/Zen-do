// 定時報告の Gemini 部分の材料集めと呼び出し（docs/gemini-digest-plan.md 2章）。
// 失敗しても定時報告は止めない: どこで失敗しても null を返し、呼び出し側はテンプレだけで送る。
import "server-only";
import { db } from "@/lib/db";
import { generateJson } from "@/lib/gemini";
import { loadOpenChildren } from "@/lib/items";
import {
  ADVICE_SCHEMA,
  type Advice,
  type AdviceCandidate,
  type AdviceContext,
  buildAdvicePrompt,
  resolveAdvice,
} from "@/lib/line/advice";
import type { Item } from "@/lib/types";

// src/lib/client.ts の MEMO_TAG と同じ（クライアント側の定数はswrを引き込むので参照しない）
const MEMO_TAG = "memo";
/** Gemini を待つ上限。これを越えたらテンプレだけで送る（通知を遅らせない） */
// 実測で成功時も8〜9秒かかったため、10秒では半分近くが時間切れになった
const ADVICE_TIMEOUT_MS = 25_000;
/** 直近に選んだものを避ける期間 */
const RECENT_HOURS = 48;

export type AdviceExtras = {
  inbox: Item[];
  passedIds: Set<string>;
  recentFocusIds: Set<string>;
  openChildren: Map<string, number>;
};

async function loadInbox(): Promise<Item[]> {
  const { data, error } = await db
    .from("items")
    .select("*")
    .eq("kind", "todo")
    .eq("status", "todo")
    .is("parent_id", null)
    .is("due_date", null)
    .not("tags", "cs", `{${MEMO_TAG}}`)
    // 放置の長いものから（候補の上限で切られても古いものが残るように）
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as Item[];
}

async function loadPassedIds(today: string): Promise<Set<string>> {
  const { data, error } = await db.from("line_focus_passes").select("item_id").eq("pass_date", today);
  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((r) => (r as { item_id: string }).item_id));
}

async function loadRecentFocusIds(now: Date): Promise<Set<string>> {
  const since = new Date(now.getTime() - RECENT_HOURS * 3600_000).toISOString();
  const { data, error } = await db
    .from("gemini_logs")
    .select("output")
    .eq("kind", "digest")
    .eq("ok", true)
    .gte("created_at", since);
  if (error) throw new Error(error.message);
  const ids = (data ?? [])
    .map((r) => (r as { output: { focus_item_id?: unknown } | null }).output?.focus_item_id)
    .filter((id): id is string => typeof id === "string");
  return new Set(ids);
}

/** 1回の cron で枠が複数あっても材料は1度だけ集める。失敗したら null（＝Geminiを使わない） */
export async function loadAdviceExtras(todos: Item[], today: string, now: Date): Promise<AdviceExtras | null> {
  try {
    const [inbox, passedIds, recentFocusIds] = await Promise.all([
      loadInbox(),
      loadPassedIds(today),
      loadRecentFocusIds(now),
    ]);
    const children = await loadOpenChildren([...todos, ...inbox].map((i) => i.id));
    const openChildren = new Map<string, number>();
    for (const c of children) {
      if (c.parent_id) openChildren.set(c.parent_id, (openChildren.get(c.parent_id) ?? 0) + 1);
    }
    return { inbox, passedIds, recentFocusIds, openChildren };
  } catch (err) {
    console.warn("[line] 声かけの材料を集められませんでした:", err);
    return null;
  }
}

/**
 * 注目タスクの候補。Today→Inbox の順。習慣のインスタンスは除く（習慣は別枠で声をかけるため）。
 * 繰り返しタスクも除く（毎回決まってやるルーティンで、「着手すべき1件」に選ぶと的外れになる。
 * 実際に毎日のチェックリストを選んで分解を勧めてきた）。
 * 今日パスされたものも除く
 */
export function adviceCandidates(todos: Item[], extras: AdviceExtras): AdviceCandidate[] {
  const toCandidate = (item: Item, place: AdviceCandidate["place"]): AdviceCandidate => ({
    item,
    place,
    openChildren: extras.openChildren.get(item.id) ?? 0,
    recentlyPicked: extras.recentFocusIds.has(item.id),
  });
  return [
    ...todos.filter((t) => !t.habit_id && !t.recurrence_rule).map((t) => toCandidate(t, "today")),
    ...extras.inbox.map((t) => toCandidate(t, "inbox")),
  ].filter((c) => !extras.passedIds.has(c.item.id));
}

// 後から gemini_logs を読んで意味が通る形（参照名ではなく実ID・タイトル）で残す
function summarize(advice: Advice) {
  return {
    greeting: advice.greeting,
    focus_item_id: advice.focus?.item.id ?? null,
    focus_title: advice.focus?.item.title ?? null,
    reason: advice.focus?.reason ?? null,
    next: advice.focus?.next ?? null,
  };
}

export async function fetchAdvice(ctx: AdviceContext, preview = false): Promise<Advice | null> {
  const { prompt, refs } = buildAdvicePrompt(ctx);
  let advice: Advice | null = null;
  try {
    await generateJson({
      kind: preview ? "digest_preview" : "digest",
      prompt,
      schema: ADVICE_SCHEMA,
      // 毎回同じ声かけにならないよう分解（0.4）より高め
      temperature: 0.8,
      timeoutMs: ADVICE_TIMEOUT_MS,
      toLog: (value) => {
        advice = resolveAdvice(value, refs);
        return advice ? summarize(advice) : { invalid: value };
      },
    });
  } catch (err) {
    console.warn("[line] Gemini の声かけを作れませんでした（テンプレだけで送ります）:", err);
    return null;
  }
  return advice;
}
