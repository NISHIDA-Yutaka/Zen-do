"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { normalizeIndent } from "@/lib/markdown";

// メモ本文のMarkdownレンダリング（docs/design.md 13.4）。
// rehype-raw を入れないので生HTMLは描画されない＝そのままでXSS安全。
// typographyプラグインは足さず、既存の色トークンで必要な要素だけ最小限に整える。
// 本文は 12px。見出しはレベルごとに段差がはっきり出るサイズにする。
const COMPONENTS: Components = {
  h1: ({ children }) => <h3 className="mt-3.5 mb-1.5 text-[19px] leading-snug font-bold first:mt-0">{children}</h3>,
  h2: ({ children }) => <h4 className="mt-3 mb-1 text-[16px] leading-snug font-bold first:mt-0">{children}</h4>,
  h3: ({ children }) => <h5 className="mt-2.5 mb-1 text-[14px] font-bold first:mt-0">{children}</h5>,
  h4: ({ children }) => <h6 className="text-nibi mt-2.5 mb-1 text-xs font-bold first:mt-0">{children}</h6>,
  p: ({ children }) => <p className="my-1.5 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="my-1.5 list-disc pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-1.5 list-decimal pl-5">{children}</ol>,
  // GFMのチェックリストは箇条書き記号を消す（チェックボックス自体が印になる）
  li: ({ children }) => <li className="my-0.5 [&:has(>input)]:list-none">{children}</li>,
  input: ({ checked, type }) =>
    type === "checkbox" ? (
      <input type="checkbox" checked={checked} readOnly className="accent-tokiwa mr-1.5 align-middle" />
    ) : null,
  blockquote: ({ children }) => (
    <blockquote className="border-keisen text-nibi my-2 border-l-2 pl-2.5">{children}</blockquote>
  ),
  code: ({ children }) => <code className="bg-kinari rounded px-1 py-px text-[11px]">{children}</code>,
  // コードブロックは中の code の装飾を打ち消して、枠はこちらで持つ
  pre: ({ children }) => (
    <pre className="bg-kinari my-2 overflow-x-auto rounded-lg p-2.5 text-[11px] [&_code]:bg-transparent [&_code]:p-0">
      {children}
    </pre>
  ),
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-asagi underline">
      {children}
    </a>
  ),
  hr: () => <hr className="border-keisen my-3" />,
  // 広い表でもモーダルを横に広げない
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="border-keisen w-full border-collapse border text-[11px]">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border-keisen bg-kinari border px-1.5 py-1 text-left font-semibold">{children}</th>,
  td: ({ children }) => <td className="border-keisen border px-1.5 py-1">{children}</td>,
};

// remarkBreaks: 編集欄での改行をそのまま改行として出す（メモは散文よりメモ書きが主なため、
// Markdown標準の「空行でしか段落が変わらない」挙動より編集時の見た目に合わせる）
const PLUGINS = [remarkGfm, remarkBreaks];

export function Markdown({ text }: { text: string }) {
  return (
    <div className="text-xs leading-relaxed break-words">
      <ReactMarkdown remarkPlugins={PLUGINS} components={COMPONENTS}>
        {normalizeIndent(text)}
      </ReactMarkdown>
    </div>
  );
}
