"use client";
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { assistantEvent, type AssistantIntent } from "../../lib/assistant";
import { useWorkspace, useLocation } from "../workspace/ui";
import { api } from "../../lib/client";
import { locationResourceId } from "@axiom/shared/workspace-location";
const AssistantPanel = dynamic(() => import("./AssistantPanel"), {
  ssr: false,
});
export default function AssistantHost() {
  const { session, spaces, notify } = useWorkspace(),
    { path, params } = useLocation();
  const [intent, setIntent] = useState<
    (AssistantIntent & { spaceId: string; serial: number }) | null
  >(null);
  const current = useRef({ path, params, spaces, notify });
  current.current = { path, params, spaces, notify };
  const opener = useRef<HTMLElement | null>(null),
    sequence = useRef(0);
  useEffect(() => {
    const open = (event: Event) => {
      const value = (event as CustomEvent<AssistantIntent>).detail ?? {},
        serial = ++sequence.current;
      opener.current = document.activeElement as HTMLElement | null;
      void (async () => {
        const { path, params, spaces } = current.current;
        let spaceId =
          value.spaceId ??
          (path.startsWith("/workspaces/")
            ? path.split("/")[2]
            : (params.get("space") ?? undefined));
        const resourceId = locationResourceId(path + "?" + params);
        if (!spaceId && resourceId)
          spaceId = (await api<{ space_id: string }>(`resources/${resourceId}`))
            .space_id;
        spaceId ??=
          spaces.find((s) => s.kind === "personal")?.id ?? spaces[0]?.id;
        if (!spaceId)
          throw new Error("Open a workspace before starting the assistant.");
        if (sequence.current === serial)
          setIntent({ ...value, spaceId, serial });
      })().catch((e) => current.current.notify(e.message));
    };
    window.addEventListener(assistantEvent, open);
    return () => {
      sequence.current++;
      window.removeEventListener(assistantEvent, open);
    };
  }, [session.user.id]);
  return intent ? (
    <AssistantPanel
      key={session.user.id + intent.spaceId}
      intent={intent}
      onWorkspace={(spaceId) =>
        setIntent({ spaceId, serial: ++sequence.current })
      }
      onClose={() => {
        setIntent(null);
        opener.current?.focus({ preventScroll: true });
      }}
    />
  ) : null;
}
