import { useChatStore } from "@/features/chat/store/chatStore";
import { uid } from "@/shared/lib/format";
import { cn } from "@/shared/lib/cn";
import { FileUp } from "lucide-react";
import { useCallback, useState, type DragEvent, type ReactNode } from "react";

const ACCEPT = new Set(["application/pdf", "text/plain"]);

function sizeLabel(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface FileDropzoneProps {
  children: ReactNode;
}

export function FileDropzone({ children }: FileDropzoneProps) {
  const attachFiles = useChatStore((s) => s.attachFiles);
  const [nativeOver, setNativeOver] = useState(false);

  const ingest = useCallback(
    (fileList: FileList | File[]) => {
      const next = [...fileList]
        .filter((file) => ACCEPT.has(file.type) || /\.(pdf|txt)$/i.test(file.name))
        .map((file) => ({
          id: uid("file"),
          kind: (file.type === "application/pdf" || file.name.endsWith(".pdf")
            ? "pdf"
            : "txt") as "pdf" | "txt",
          name: file.name,
          sizeLabel: sizeLabel(file.size),
        }));
      if (next.length) attachFiles(next);
    },
    [attachFiles],
  );

  const isFileDrag = (event: DragEvent) => event.dataTransfer.types.includes("Files");

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setNativeOver(false);
    if (event.dataTransfer.files?.length) ingest(event.dataTransfer.files);
  };

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      onDragEnter={(e) => {
        if (!isFileDrag(e)) return;
        e.preventDefault();
        setNativeOver(true);
      }}
      onDragOver={(e) => {
        if (!isFileDrag(e)) return;
        e.preventDefault();
        setNativeOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setNativeOver(false);
      }}
      onDrop={onDrop}
    >
      {children}
      <div
        className={cn(
          "pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-[1.4rem] border-2 border-dashed border-transparent",
          nativeOver && "border-teal bg-teal/10 drop-glow",
        )}
      >
        {nativeOver && (
          <div className="flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white">
            <FileUp className="size-4" />
            Drop PDF or TXT — stays on this device
          </div>
        )}
      </div>
    </div>
  );
}
