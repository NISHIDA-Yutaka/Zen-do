"use client";

import { useEffect, useState } from "react";
import { enablePush, getPushState, type PushState } from "@/lib/push-client";

// リマインダーを設定したのに通知が届かない状態を、その場で気づけるようにする一行案内
// （docs/design.md 15.5: 起動時プロンプトはせず「通知を望んだ瞬間」に許可を求める）。
export function PushNotice({ show }: { show: boolean }) {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!show) return;
    getPushState()
      .then(setState)
      .catch(() => setState(null));
  }, [show]);

  if (!show || state === null || state === "subscribed" || state === "unsupported") return null;

  async function allow() {
    setError(null);
    setBusy(true);
    try {
      setState(await enablePush());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="border-keisen block border-b py-2">
      <span className="text-nibi text-[11px]">
        {state === "denied"
          ? "ブラウザで通知がブロックされているため届きません（サイト設定から許可してください）"
          : "この端末では通知が届きません"}
      </span>
      {state !== "denied" && (
        <button
          type="button"
          disabled={busy}
          onClick={allow}
          className="text-mikan hit-y ml-2 text-[11px] font-bold"
        >
          通知を許可
        </button>
      )}
      {error && <span className="text-beni mt-1 block text-[11px]">{error}</span>}
    </span>
  );
}
