"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { normalizeIndent, remarkBlankLineGaps } from "@/lib/markdown";
import { cn } from "@/lib/utils";

// メモ本文のMarkdownレンダリング（docs/design.md 13.4）。
// rehype-raw を入れないので生HTMLは描画されない＝そのままでXSS安全。
// typographyプラグインは足さず、既存の色トークンで必要な要素だけ最小限に整える。
// 本文は 12px。見出しはレベルごとに段差がはっきり出るサイズにする。
//
// dataGap は編集欄で空行を挟んだ要素（remarkBlankLineGaps）。空行ならどこでも、
// 編集欄の空行1行ぶんとほぼ同じ20pxを上に空ける（後ろに付けて各要素の既定の上余白より優先させる）
const GAP = "mt-5";
// 描画側の構文木（hast）のうち見る部分だけ（hast の型は react-markdown の間接依存なので直接は使わない）
type HastNode = { type?: string; properties?: Record<string, unknown>; children?: HastNode[] };
const gap = (node: HastNode | undefined) => node?.properties?.dataGap === true && GAP;

const COMPONENTS: Components = {
  h1: ({ node, children }) => (
    <h3 className={cn("mt-3.5 mb-1.5 text-[19px] leading-snug font-bold first:mt-0", gap(node))}>{children}</h3>
  ),
  h2: ({ node, children }) => (
    <h4 className={cn("mt-3 mb-1 text-[16px] leading-snug font-bold first:mt-0", gap(node))}>{children}</h4>
  ),
  h3: ({ node, children }) => (
    <h5 className={cn("mt-2.5 mb-1 text-[14px] font-bold first:mt-0", gap(node))}>{children}</h5>
  ),
  h4: ({ node, children }) => (
    <h6 className={cn("text-nibi mt-2.5 mb-1 text-xs font-bold first:mt-0", gap(node))}>{children}</h6>
  ),
  p: ({ node, children }) => <p className={cn("my-1.5 first:mt-0 last:mb-0", gap(node))}>{children}</p>,
  ul: ({ node, children }) => <ul className={cn("my-1.5 list-disc pl-5", gap(node))}>{children}</ul>,
  ol: ({ node, children }) => <ol className={cn("my-1.5 list-decimal pl-5", gap(node))}>{children}</ol>,
  // GFMのチェックリストは箇条書き記号を消す（チェックボックス自体が印になる）
  li: ({ node, children }) => (
    <li className={cn("my-0.5 [&:has(>input)]:list-none", gap(node))}>{children}</li>
  ),
  input: ({ checked, type }) =>
    type === "checkbox" ? (
      <input type="checkbox" checked={checked} readOnly className="accent-tokiwa mr-1.5 align-middle" />
    ) : null,
  blockquote: ({ node, children }) => (
    <blockquote className={cn("border-keisen text-nibi my-2 border-l-2 pl-2.5", gap(node))}>{children}</blockquote>
  ),
  code: ({ children }) => <code className="bg-kinari rounded px-1 py-px text-[11px]">{children}</code>,
  // コードブロックは中の code の装飾を打ち消して、枠はこちらで持つ。
  // 空行の印は（Markdownの変換の都合で）中の code 側に付くので、そちらを見る
  pre: ({ node, children }) => (
    <pre
      className={cn(
        "bg-kinari my-2 overflow-x-auto rounded-lg p-2.5 text-[11px] [&_code]:bg-transparent [&_code]:p-0",
        gap(node?.children.find((c) => c.type === "element")),
      )}
    >
      {children}
    </pre>
  ),
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-asagi underline">
      {children}
    </a>
  ),
  hr: ({ node }) => <hr className={cn("border-keisen my-3", gap(node))} />,
  // 広い表でもモーダルを横に広げない
  table: ({ node, children }) => (
    <div className={cn("my-2 overflow-x-auto", gap(node))}>
      <table className="border-keisen w-full border-collapse border text-[11px]">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border-keisen bg-kinari border px-1.5 py-1 text-left font-semibold">{children}</th>,
  td: ({ children }) => <td className="border-keisen border px-1.5 py-1">{children}</td>,
};

// remarkBreaks: 編集欄での改行をそのまま改行として出す（メモは散文よりメモ書きが主なため、
// Markdown標準の「空行でしか段落が変わらない」挙動より編集時の見た目に合わせる）
const PLUGINS = [remarkGfm, remarkBreaks, remarkBlankLineGaps];

export function Markdown({ text }: { text: string }) {
  return (
    <div className="text-xs leading-relaxed break-words">
      <ReactMarkdown remarkPlugins={PLUGINS} components={COMPONENTS}>
        {normalizeIndent(text)}
      </ReactMarkdown>
    </div>
  );
}
