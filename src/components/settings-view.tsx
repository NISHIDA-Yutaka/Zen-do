"use client";

import { useCallback, useEffect, useState } from "react";
import useSWR from "swr";
import { getJson, postJson } from "@/lib/client";
import { disablePush, enablePush, getPushState, type PushState } from "@/lib/push-client";
import { cn } from "@/lib/utils";

const STATE_LABEL: Record<PushState, string> = {
  unsupported: "このブラウザは通知に対応していません",
  default: "この端末では通知が届きません",
  denied: "ブラウザで通知がブロックされています",
  granted: "この端末では通知が届きません",
  subscribed: "この端末で通知を受け取ります",
};

export function SettingsView() {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(() => {
    getPushState()
      .then(setState)
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function toggle() {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      setState(state === "subscribed" ? await disablePush() : await enablePush());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const r = await postJson<{ delivered: number; failed: number }>("/api/push/test");
      setNotice(
        r.delivered > 0
          ? `${r.delivered}台の端末に送信しました`
          : "送信できませんでした。通知を許可し直してください",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <header className="pt-2 pb-1">
        <h1 className="text-lg font-bold">Settings</h1>
      </header>

      <h2 className="text-nibi border-keisen border-b py-2 text-xs font-semibold">通知</h2>

      {state === null ? (
        <p className="text-nibi py-4 text-sm">読み込み中…</p>
      ) : (
        <div className="border-keisen flex items-center justify-between gap-3 border-b py-3">
          <span className="min-w-0">
            <span className="block text-sm font-medium">リマインダーの通知</span>
            <span className="text-nibi mt-0.5 block text-[11px]">{STATE_LABEL[state]}</span>
          </span>
          {state === "denied" || state === "unsupported" ? null : state === "subscribed" ? (
            <button
              type="button"
              disabled={busy}
              onClick={toggle}
              className="border-wakuiro text-foreground/80 hover:bg-kinari hit-y shrink-0 rounded-lg border px-3 py-1.5 text-xs font-semibold"
            >
              止める
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={toggle}
              className="bg-mikan hit-y shrink-0 rounded-lg px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
            >
              通知を許可
            </button>
          )}
        </div>
      )}

      {state === "denied" && (
        <p className="text-nibi py-3 text-xs">
          一度ブロックすると、アプリからは許可を求められません。ブラウザのサイト設定から通知を許可してください。
        </p>
      )}

      {state === "subscribed" && (
        <div className="border-keisen flex items-center justify-between gap-3 border-b py-3">
          <span className="text-sm">動作確認</span>
          <button
            type="button"
            disabled={busy}
            onClick={sendTest}
            className="border-wakuiro text-foreground/80 hover:bg-kinari hit-y shrink-0 rounded-lg border px-3 py-1.5 text-xs font-semibold"
          >
            テスト通知を送る
          </button>
        </div>
      )}

      {error && <p className="text-beni py-2 text-sm">{error}</p>}
      {notice && <p className="text-nibi py-2 text-sm">{notice}</p>}

      <LineSection />

      <p className="text-nibi/70 pt-6 text-xs">
        Google連携・AIの介入設定はまだありません。
      </p>
    </section>
  );
}

type LineStatus = {
  configured: boolean;
  recipients: number;
  used: number;
  quota: number;
  stopAt: number;
};

// LINE連携（docs/line-plan.md）。無料枠が月200通しかないので消費量を常に見えるようにする。
function LineSection() {
  const { data, error: loadError, mutate } = useSWR<LineStatus>("/api/line/status", getJson);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function sendTest() {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const r = await postJson<{ sent: number }>("/api/line/test");
      setNotice(`${r.sent}件送信しました`);
      void mutate();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h2 className="text-nibi border-keisen mt-6 border-b py-2 text-xs font-semibold">LINE</h2>

      {loadError ? (
        <p className="text-beni py-4 text-sm">{loadError.message}</p>
      ) : !data ? (
        <p className="text-nibi py-4 text-sm">読み込み中…</p>
      ) : !data.configured ? (
        <p className="text-nibi py-3 text-xs">
          まだ設定されていません。LINE公式アカウントを作り、
          <span className="font-semibold">LINE_CHANNEL_ACCESS_TOKEN</span> と
          <span className="font-semibold">LINE_CHANNEL_SECRET</span> を登録すると使えます。
        </p>
      ) : (
        <>
          <div className="border-keisen flex items-center justify-between gap-3 border-b py-3">
            <span className="min-w-0">
              <span className="block text-sm font-medium">送信先</span>
              <span className="text-nibi mt-0.5 block text-[11px]">
                {data.recipients > 0
                  ? `${data.recipients}件`
                  : "まだいません。LINEで公式アカウントを友だち追加してください"}
              </span>
            </span>
            <button
              type="button"
              disabled={busy || data.recipients === 0}
              onClick={sendTest}
              className="border-wakuiro text-foreground/80 hover:bg-kinari hit-y shrink-0 rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
            >
              テスト送信
            </button>
          </div>

          <div className="border-keisen border-b py-3">
            <span className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-medium">今月の送信数</span>
              <span
                className={cn(
                  "text-xs font-semibold",
                  data.used >= data.stopAt ? "text-beni" : "text-nibi",
                )}
              >
                {data.used} / {data.quota}
              </span>
            </span>
            <span className="text-nibi mt-0.5 block text-[11px]">
              {data.used >= data.stopAt
                ? `上限に達したため送信を止めています（${data.stopAt}通で停止）`
                : `無料枠は月${data.quota}通。${data.stopAt}通で自動的に止まります`}
            </span>
          </div>
        </>
      )}

      {error && <p className="text-beni py-2 text-sm">{error}</p>}
      {notice && <p className="text-nibi py-2 text-sm">{notice}</p>}
    </>
  );
}
