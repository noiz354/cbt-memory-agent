import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { cn } from "@/shared/lib/cn";

interface ChatMarkdownProps {
  content: string;
  className?: string;
}

export function ChatMarkdown({ content, className }: ChatMarkdownProps) {
  return (
    <div
      className={cn(
        "prose-chat text-[15px] leading-7 text-ink",
        "[&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0",
        "[&_strong]:font-semibold [&_em]:text-ink-soft",
        "[&_ul]:my-2 [&_ol]:my-2 [&_li]:my-0.5",
        "[&_blockquote]:border-l-2 [&_blockquote]:border-teal/50 [&_blockquote]:pl-3 [&_blockquote]:text-ink-mute",
        "[&_code]:rounded-md [&_code]:bg-ink/6 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-[13px]",
        "[&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:bg-ink [&_pre]:p-3 [&_pre]:text-teal-mist",
        "[&_.katex-display]:my-3 [&_.katex-display]:overflow-x-auto",
        className,
      )}
    >
      <Markdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
        {content}
      </Markdown>
    </div>
  );
}
