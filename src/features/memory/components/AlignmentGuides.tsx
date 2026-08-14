import type { AlignmentGuide } from "@/features/memory/types";

export function AlignmentGuides({ guides }: { guides: AlignmentGuide }) {
  return (
    <>
      {guides.vertical != null && (
        <div
          className="pointer-events-none absolute top-[-2400px] h-[4800px] w-px bg-teal"
          style={{ left: guides.vertical }}
        />
      )}
      {guides.horizontal != null && (
        <div
          className="pointer-events-none absolute left-[-2400px] h-px w-[4800px] bg-teal"
          style={{ top: guides.horizontal }}
        />
      )}
    </>
  );
}
