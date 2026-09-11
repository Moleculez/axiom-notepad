"use client";
import { useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { ResearchController } from "../lib/research-store";
const PdfViewer = dynamic(() => import("./PdfViewer"), { ssr: false });
export default function PaperPane({
  paper,
  userId,
  research,
  onClose,
  onInsert,
}: {
  paper: {
    id: string;
    name: string;
    page?: number;
    annotation?: string;
    citeKey?: string;
  };
  userId: string;
  research: ResearchController;
  onClose: () => void;
  onInsert: (value: string, privateMaterial?: boolean) => void;
}) {
  const [width, setWidth] = useState(50),
    root = useRef<HTMLElement>(null);
  const adjust = (value: number) => setWidth(Math.max(30, Math.min(70, value)));
  return (
    <>
      <div
        className="paper-divider"
        role="separator"
        aria-label="Resize note and paper panes"
        aria-orientation="vertical"
        tabIndex={0}
        aria-valuemin={30}
        aria-valuemax={70}
        aria-valuenow={width}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
            e.preventDefault();
            adjust(width + (e.key === "ArrowLeft" ? 5 : -5));
          }
        }}
        onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
        onPointerMove={(e) => {
          if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
          const bounds = root.current?.parentElement?.getBoundingClientRect();
          if (bounds) adjust(((bounds.right - e.clientX) / bounds.width) * 100);
        }}
        onPointerUp={(e) => e.currentTarget.releasePointerCapture(e.pointerId)}
      />
      <aside
        className="paper-pane"
        ref={root}
        style={{ flexBasis: width + "%" }}
      >
        <PdfViewer
          attachment={paper}
          userId={userId}
          research={research}
          onClose={onClose}
          onInsert={onInsert}
          citeKey={paper.citeKey}
        />
      </aside>
    </>
  );
}
