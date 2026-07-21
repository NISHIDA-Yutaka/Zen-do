"use client";

import { useCallback, useEffect, useState } from "react";
import { ItemModal } from "@/components/item-modal";
import { QuickAddFab, QuickAddInline, type QuickAddPayload } from "@/components/quick-add";
import type { ProjectRow } from "@/app/api/projects/route";
import { getJson, postJson } from "@/lib/client";
import { todayInJst } from "@/lib/date";
import { cn } from "@/lib/utils";

type ProjectsData = { projects: ProjectRow[] };

function formatNextDue(ymd: string, today: string): { text: string; late: boolean } {
  const [, m, d] = ymd.split("-").map(Number);
  return { text: `${m}月${d}日`, late: ymd < today };
}

export function ProjectsView() {
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const today = todayInJst();

  const load = useCallback(() => {
    getJson<ProjectsData>("/api/projects")
      .then((r) => setProjects(r.projects))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // この画面はプレーン入力（Smart Inputの適用外。docs/design.md 11.1）
  async function addProject(payload: QuickAddPayload) {
    setError(null);
    try {
      await postJson("/api/items", { kind: "project", title: payload.title });
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <section>
      <header className="flex items-baseline justify-between pt-2 pb-1">
        <h1 className="text-lg font-bold">Projects</h1>
        <p className="text-nibi text-xs">{projects.length}件</p>
      </header>

      {error && <p className="text-beni py-2 text-sm">{error}</p>}

      {loading ? (
        <p className="text-nibi py-4 text-sm">読み込み中…</p>
      ) : projects.length === 0 ? (
        <p className="text-nibi py-4 text-sm">プロジェクトはまだありません。</p>
      ) : (
        <ul>
          {projects.map((p) => {
            const due = p.nextDue ? formatNextDue(p.nextDue, today) : null;
            return (
              <li key={p.id} className="border-keisen flex items-center gap-3 border-b py-3">
                <button
                  type="button"
                  onClick={() => setOpenId(p.id)}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="block truncate text-sm font-medium">{p.title}</span>
                  <span
                    className={cn(
                      "mt-0.5 block text-[11px] tabular-nums",
                      p.childTotal === 0 ? "text-nibi/60" : "text-nibi",
                    )}
                  >
                    {p.childTotal === 0 ? "子ToDoなし" : `残り ${p.childRemaining}/${p.childTotal}`}
                  </span>
                </button>
                {due && (
                  <span className={cn("shrink-0 text-xs", due.late ? "text-beni font-semibold" : "text-nibi")}>
                    {due.text}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <QuickAddInline placeholder="プロジェクトを追加…" onAdd={addProject} />
      <QuickAddFab placeholder="プロジェクトを追加…" onAdd={addProject} />

      {openId && (
        <ItemModal
          itemId={openId}
          onClose={() => {
            setOpenId(null);
            load();
          }}
        />
      )}
    </section>
  );
}
