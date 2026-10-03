"use client";
import { Button } from "../ui/controls";
import { useEffect, useState } from "react";
import * as Y from "yjs";
import {
  parseCanvas,
  readCanvas,
  seedCanvas,
  type CanvasData,
} from "@axiom/shared/canvas";
import { CanvasSurface, type CanvasSession } from "./CanvasStudio";
import { useWorkspace } from "../workspace/ui";
import { Copy, RotateCcw } from "lucide-react";

const sample: CanvasData = {
  schemaVersion: 1,
  nodes: [
    {
      id: "question",
      type: "text",
      title: "Question",
      text: "## What changes the result?\n\nDouble-click to edit this card. Try **bold**, a list or $E=mc^2$.",
      x: 0,
      y: 0,
      width: 300,
      height: 230,
      color: "4",
    },
    {
      id: "evidence",
      type: "text",
      title: "Evidence",
      text: "## Test the assumptions\n\n- Reproduce the observation\n- Compare a second model\n- [ ] Record uncertainty",
      x: 400,
      y: 0,
      width: 300,
      height: 230,
    },
  ],
  edges: [
    {
      id: "test",
      fromNode: "question",
      fromSide: "right",
      toNode: "evidence",
      toSide: "left",
      label: "test",
    },
  ],
};
export default function CanvasPlayground({
  source,
  title = "An idea and its evidence",
  readOnly = false,
}: {
  source?: string;
  title?: string;
  readOnly?: boolean;
}) {
  const { notify } = useWorkspace();
  const [reset, setReset] = useState(0),
    [shared, setShared] = useState<CanvasSession | null>(null);
  useEffect(() => {
    const doc = new Y.Doc();
    seedCanvas(doc, source ? parseCanvas(source) : sample);
    const update = () =>
      setShared({
        document: doc,
        source: JSON.stringify(readCanvas(doc)),
        awareness: null,
        readOnly,
        error: "",
        recovery: null,
        status: "In memory",
        reopen: () => {},
        reconnect: () => {},
      });
    doc.on("update", update);
    update();
    return () => {
      doc.off("update", update);
      doc.destroy();
    };
  }, [reset, source, readOnly]);
  return (
    <div className="docs-canvas">
      {!readOnly && (
        <div className="scratchpad-toolbar">
          <strong>Canvas example</strong>
          <Button
            className="button ghost"
            onClick={() =>
              void navigator.clipboard.writeText(shared?.source ?? "").then(
                () => notify("Canvas JSON copied."),
                () => notify("Clipboard unavailable."),
              )
            }
          >
            <Copy size={14} />
            Copy JSON
          </Button>
          <Button
            className="button ghost"
            onClick={() => setReset((n) => n + 1)}
          >
            <RotateCcw size={14} />
            Reset sample
          </Button>
        </div>
      )}
      {shared && (
        <CanvasSurface
          key={shared.document?.clientID}
          sandbox
          project={{
            resource_id: "documentation-playground",
            name: title,
            space_id: "documentation",
            kind: "canvas",
            settings: {},
            version: 1,
            role: "editor",
            updated_at: "2026-01-01T00:00:00Z",
          }}
          shared={shared}
        />
      )}
    </div>
  );
}
