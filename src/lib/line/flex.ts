// 定時配信をボタン付きのメッセージにする（docs/line-plan.md 3章）。
// ボタン操作は reply 扱いで無料なので、催促を「読むだけ」で終わらせないための要。
import "server-only";
import type { messagingApi } from "@line/bot-sdk";
import type { Advice } from "@/lib/line/advice";
import { encodeAction } from "@/lib/line/postback";
import type { GlobalAction } from "@/lib/line/messages";
import type { Habit, Item } from "@/lib/types";

const GLOBAL_LABEL: Record<Exclude<GlobalAction, null>, string> = {
  alltmr: "残りを全部明日へ",
  habits: "習慣を今日に追加",
};

function smallButton(label: string, data: string, displayText: string) {
  return {
    type: "button" as const,
    style: "secondary" as const,
    height: "sm" as const,
    action: { type: "postback" as const, label, data, displayText },
  };
}

function taskBlock(item: Item) {
  const time = item.due_time ? `${item.due_time.slice(0, 5)} ` : "";
  return {
    type: "box" as const,
    layout: "vertical" as const,
    spacing: "xs" as const,
    margin: "md" as const,
    contents: [
      { type: "text" as const, text: `${time}${item.title}`, size: "sm" as const, wrap: true },
      {
        type: "box" as const,
        layout: "horizontal" as const,
        spacing: "sm" as const,
        contents: [
          smallButton("完了", encodeAction({ kind: "done", id: item.id }), `完了: ${item.title}`),
          smallButton("明日へ", encodeAction({ kind: "tmr", id: item.id }), `明日へ: ${item.title}`),
        ],
      },
    ],
  };
}

export type HabitButton = { habit: Habit; action: "hab_add" | "hab_done" };

const HABIT_LABEL: Record<HabitButton["action"], string> = {
  hab_add: "今日に追加",
  hab_done: "やった",
};

function habitBlock({ habit, action }: HabitButton) {
  return {
    type: "box" as const,
    layout: "horizontal" as const,
    spacing: "sm" as const,
    margin: "md" as const,
    contents: [
      { type: "text" as const, text: habit.title, size: "sm" as const, wrap: true, flex: 3, gravity: "center" as const },
      {
        ...smallButton(HABIT_LABEL[action], encodeAction({ kind: action, id: habit.id }), `${HABIT_LABEL[action]}: ${habit.title}`),
        flex: 2,
      },
    ],
  };
}

/** 引っかかっているタスクへの4択。2列×2段にして押し間違いを減らす */
const STUCK_CHOICES = [
  { label: "完了", kind: "done" },
  { label: "大きすぎる", kind: "big" },
  { label: "気が乗らない", kind: "stuck" },
  { label: "もう要らない", kind: "drop" },
] as const;

function stuckBlock(item: Item) {
  const row = (choices: (typeof STUCK_CHOICES)[number][]) => ({
    type: "box" as const,
    layout: "horizontal" as const,
    spacing: "sm" as const,
    contents: choices.map((c) =>
      smallButton(c.label, encodeAction({ kind: c.kind, id: item.id }), `${c.label}: ${item.title}`),
    ),
  });
  return {
    type: "box" as const,
    layout: "vertical" as const,
    spacing: "xs" as const,
    margin: "md" as const,
    contents: [
      {
        type: "text" as const,
        text: item.title,
        size: "sm" as const,
        wrap: true,
        weight: "bold" as const,
      },
      row([STUCK_CHOICES[0], STUCK_CHOICES[1]]),
      row([STUCK_CHOICES[2], STUCK_CHOICES[3]]),
    ],
  };
}

/** Gemini が選んだ注目タスク（docs/gemini-digest-plan.md 3章）。「話を聞いて」は段階2で足す */
function focusBlock(focus: NonNullable<Advice["focus"]>) {
  const { item } = focus;
  return {
    type: "box" as const,
    layout: "vertical" as const,
    spacing: "xs" as const,
    margin: "lg" as const,
    contents: [
      { type: "text" as const, text: item.title, size: "sm" as const, wrap: true, weight: "bold" as const },
      { type: "text" as const, text: focus.reason, size: "xs" as const, wrap: true, color: "#6E675E" },
      {
        type: "box" as const,
        layout: "horizontal" as const,
        spacing: "sm" as const,
        contents: [
          smallButton(
            "ベイビーステップにして",
            encodeAction({ kind: "big", id: item.id }),
            `ベイビーステップにして: ${item.title}`,
          ),
          smallButton("今日はパス", encodeAction({ kind: "pass", id: item.id }), `今日はパス: ${item.title}`),
        ],
      },
    ],
  };
}

function clipAltText(s: string): string {
  // altText（通知欄・引用に出る文字列）はLINE側の上限が400文字。
  // 超えると送信ごと弾かれてしまうので、ここで必ず収める
  return s.length > 400 ? `${s.slice(0, 399)}…` : s;
}

/**
 * 文面＋ボタン。操作対象が無ければただのテキストで送る
 * （Flexは通知欄に altText しか出ないので、飾りだけのために使わない）。
 */
export function buildDigestMessage(
  text: string,
  tasks: Item[],
  global: GlobalAction,
  habits: HabitButton[] = [],
  stuck: Item[] = [],
  advice: Advice | null = null,
): messagingApi.Message {
  // 通知欄には Gemini の声かけを先に出す（テンプレより目を引くため）
  const plain = advice ? [advice.greeting, text].filter(Boolean).join("\n\n") : text;
  const focus = advice?.focus ?? null;
  if (tasks.length === 0 && global === null && habits.length === 0 && stuck.length === 0 && !focus) {
    return { type: "text", text: plain };
  }

  const altText = clipAltText(plain);

  const footer =
    global === null
      ? undefined
      : {
          type: "box" as const,
          layout: "vertical" as const,
          contents: [smallButton(GLOBAL_LABEL[global], encodeAction({ kind: global }), GLOBAL_LABEL[global])],
        };

  return {
    type: "flex",
    altText,
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          ...(advice ? [{ type: "text" as const, text: advice.greeting, size: "sm" as const, wrap: true }] : []),
          ...(focus ? [focusBlock(focus)] : []),
          ...(advice ? [{ type: "separator" as const, margin: "lg" as const }] : []),
          ...(text ? [{ type: "text" as const, text, size: "sm" as const, wrap: true, margin: "lg" as const }] : []),
          ...stuck.map(stuckBlock),
          ...tasks.map(taskBlock),
          ...habits.map(habitBlock),
        ],
      },
      ...(footer ? { footer } : {}),
    },
  };
}
