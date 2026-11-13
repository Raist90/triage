import type { ComponentProps } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { openExternal } from "../lib/open";
import { Kbd } from "./ui";

type MarkdownProps = {
  children: string;
};

function MarkdownLink({ href, children }: ComponentProps<"a">) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={(event) => {
        event.preventDefault();
        if (href) void openExternal(href);
      }}
      className="text-accent underline underline-offset-2 hover:text-accent/80"
    >
      {children}
    </a>
  );
}

const components: Components = {
  a: MarkdownLink,
  p: ({ children }) => <p className="my-3 first:mt-0 last:mb-0">{children}</p>,
  h1: ({ children }) => (
    <h1 className="mt-6 mb-2 text-lead font-medium text-fg first:mt-0">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-6 mb-2 text-prose font-medium text-fg first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-6 mb-2 text-prose font-medium text-fg first:mt-0">
      {children}
    </h3>
  ),
  h4: ({ children }) => (
    <h4 className="mt-4 mb-2 text-ui font-medium text-fg first:mt-0">
      {children}
    </h4>
  ),
  h5: ({ children }) => (
    <h5 className="mt-4 mb-1 text-ui font-medium text-fg first:mt-0">
      {children}
    </h5>
  ),
  h6: ({ children }) => (
    <h6 className="mt-4 mb-1 text-meta font-medium text-fg first:mt-0">
      {children}
    </h6>
  ),
  ul: ({ children }) => (
    <ul className="my-3 list-disc space-y-1 pl-6">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="my-3 list-decimal space-y-1 pl-6">{children}</ol>
  ),
  li: ({ children }) => (
    <li className="pl-1 [&:has(>input[type=checkbox])]:list-none">
      {children}
    </li>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-4 border-l-2 border-line pl-3 text-fg-faint">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-6 border-line" />,
  strong: ({ children }) => (
    <strong className="font-medium text-fg">{children}</strong>
  ),
  code: ({ children }) => (
    <code className="rounded-[3px] border border-line bg-surface px-1 py-px font-mono text-meta text-fg-body">
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="my-4 overflow-x-auto rounded-[6px] border border-line bg-surface p-3 font-mono text-code whitespace-pre text-fg-body [&>code]:border-0 [&>code]:bg-transparent [&>code]:p-0 [&>code]:text-code">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="my-4 overflow-x-auto rounded-[6px] border border-line">
      <table className="w-full border-collapse text-meta [&_tr:last-child>*]:border-b-0">
        {children}
      </table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b border-line bg-surface px-2 py-2 text-left font-medium text-fg">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border-b border-line px-2 py-2 align-top text-fg-body">
      {children}
    </td>
  ),
  input: ({ checked, type }) => (
    <input
      type={type}
      checked={checked}
      disabled
      className="mr-2 size-3 align-middle accent-accent"
    />
  ),
  img: ({ src, alt }) => (
    <img
      src={src}
      alt={alt ?? ""}
      loading="lazy"
      className="my-3 max-w-full rounded-[4px] border border-line"
    />
  ),
  details: ({ children }) => (
    <details className="my-3 rounded-[4px] border border-line px-3 py-2">
      {children}
    </details>
  ),
  summary: ({ children }) => (
    <summary className="cursor-pointer text-fg select-none">{children}</summary>
  ),
  kbd: ({ children }) => <Kbd>{children}</Kbd>,
};

export function Markdown({ children }: MarkdownProps) {
  return (
    <div className="text-prose break-words text-fg-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, rehypeSanitize]}
        components={components}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
