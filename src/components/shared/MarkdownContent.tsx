"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="flex flex-col gap-3 text-sm leading-relaxed text-royal-700">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p>{children}</p>,
          h1: ({ children }) => (
            <h1 className="text-lg font-semibold text-royal-950">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-base font-semibold text-royal-950">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-sm font-semibold text-royal-950">
              {children}
            </h3>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold text-royal-900">
              {children}
            </strong>
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-royal-600 underline hover:text-royal-700"
            >
              {children}
            </a>
          ),
          ul: ({ children }) => (
            <ul className="list-disc space-y-1 pl-5">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal space-y-1 pl-5">{children}</ol>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-royal-300 pl-3 italic text-royal-500">
              {children}
            </blockquote>
          ),
          code: ({ children }) => (
            <code className="rounded bg-royal-100 px-1 py-0.5 text-xs">
              {children}
            </code>
          ),
          hr: () => <hr className="border-royal-100" />,
          table: ({ children }) => (
            <div className="overflow-x-auto rounded-md border border-royal-100">
              <table className="w-full min-w-max border-collapse text-sm">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-royal-50">{children}</thead>
          ),
          th: ({ children }) => (
            <th className="border border-royal-100 px-3 py-1.5 text-left font-medium text-royal-700">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-royal-100 px-3 py-1.5">
              {children}
            </td>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
