"use client";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";

// The compatibility editor is browser-only, just like the routed workspace.
const Notebook = dynamic(() => import("./Notebook"), { ssr: false });

/** Old note/PDF URLs remain an explicit compatibility surface. New work starts
 * in the routed workspace; no account-specific HTML is rendered on the server. */
export default function WorkspaceEntry() {
  const [classic, setClassic] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.has("note") || params.has("paper") || params.has("classic"))
      setClassic(true);
    else location.replace("/workbench/home" + location.search + location.hash);
  }, []);
  return classic ? (
    <Notebook />
  ) : (
    <main className="ws-boot" role="status">
      <span className="brand-mark">a</span>
      <p>Opening your workspace…</p>
    </main>
  );
}
