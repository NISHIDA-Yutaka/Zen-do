"use client";

import type { ProjectRef, SmartParseResult, SmartToken } from "@/lib/smart-input";
import { tokenKey } from "@/lib/smart-input";
import { cn } from "@/lib/utils";

// 解釈プレビュー（docs/design.md 11.1）。Enter確定前に必ず見える位置に出す。
export function SmartPreview({
  parsed,
  onCancelToken,
}: {
  parsed: SmartParseResult;
  onCancelToken: (key: string) => void;
}) {
  if (parsed.tokens.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 py-1.5 text-[11.5px]">
      <span className="text-nibi/70 text-[10.5px]">解釈:</span>
      {parsed.title && <span className="font-semibold">{parsed.title}</span>}
      {parsed.tokens.map((t) => (
        <Chip key={tokenKey(t)} token={t} onCancel={() => onCancelToken(tokenKey(t))} />
      ))}
    </div>
  );
}

function Chip({ token, onCancel }: { token: SmartToken; onCancel: () => void }) {
  const tone =
    token.kind === "date" || token.kind === "time"
      ? "bg-asagi-soft text-asagi"
      : "bg-kinari text-foreground/80";
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-semibold", tone)}>
      {token.label}
      <button
        type="button"
        aria-label={`${token.label}の解釈を取り消す`}
        onClick={onCancel}
        className="hit-y opacity-55 hover:opacity-100"
      >
        ✕
      </button>
    </span>
  );
}

// !プロジェクトのサジェスト（docs/design.md 11.3）。暗黙作成はせず、明示ボタンのみ。
export function ProjectSuggest({
  query,
  projects,
  onPick,
  onCreate,
}: {
  query: string;
  projects: ProjectRef[];
  onPick: (p: ProjectRef) => void;
  onCreate: (title: string) => void;
}) {
  const hits = projects.filter((p) => p.title.includes(query));
  return (
    <div className="border-keisen bg-background absolute bottom-full left-6 z-50 mb-1 w-56 overflow-hidden rounded-xl border text-xs shadow-xl">
      {hits.map((p) => (
        <button
          key={p.id}
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(p);
          }}
          className="border-keisen hover:bg-kinari block w-full truncate border-b px-3.5 py-2 text-left last:border-b-0"
        >
          {p.title}
        </button>
      ))}
      {query !== "" && (
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            onCreate(query);
          }}
          className="border-keisen text-mikan hover:bg-kinari block w-full truncate border-t px-3.5 py-2 text-left font-bold"
        >
          ＋ 新規プロジェクト「{query}」を作成
        </button>
      )}
      {hits.length === 0 && query === "" && (
        <p className="text-nibi px-3.5 py-2">プロジェクト名を入力…</p>
      )}
    </div>
  );
}
