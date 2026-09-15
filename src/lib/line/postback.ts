// ボタンに載せる操作の符号化（docs/line-plan.md 3章）。
// LINEの postback data は300文字までなので短いキーで持つ。
// DBに触らない純粋な処理なので、送信側（flex）と受信側（webhook）の両方から使える。

export type LineAction =
  | { kind: "done"; id: string }
  | { kind: "tmr"; id: string }
  | { kind: "hab_add"; id: string }
  | { kind: "hab_done"; id: string }
  | { kind: "alltmr" }
  | { kind: "habits" };

export function encodeAction(action: LineAction): string {
  const params = new URLSearchParams({ a: action.kind });
  if ("id" in action) params.set("id", action.id);
  return params.toString();
}

/** 解釈できない data は null。第三者が値を送ってくる前提で、知らないキーは受け付けない */
export function parseAction(data: string): LineAction | null {
  const params = new URLSearchParams(data);
  const kind = params.get("a");
  const id = params.get("id");
  if (kind === "alltmr" || kind === "habits") return { kind };
  if ((kind === "done" || kind === "tmr" || kind === "hab_add" || kind === "hab_done") && id)
    return { kind, id };
  return null;
}
