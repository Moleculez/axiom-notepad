"use client";
import { printDocument } from "../lib/print-document";
import { openExternalEditorLink } from "../lib/editor-links";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Bell,
  BookOpen,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  Code2,
  Copy,
  FileText,
  FlaskConical,
  Folder,
  FolderPlus,
  History,
  Home,
  ImagePlus,
  LayoutTemplate,
  Link as LinkIcon,
  List,
  LockKeyhole,
  LogOut,
  Menu,
  MessageSquare,
  Moon,
  MoreHorizontal,
  Network,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Search,
  Settings,
  Sigma,
  Sparkles,
  Star,
  Sun,
  Trash2,
  Users,
  X,
  Bold,
  Italic,
  ListChecks,
  Quote,
  Table2,
  Download,
  Upload,
  LoaderCircle,
  Type,
  Eye,
  BookmarkPlus,
} from "lucide-react";
import type { Note } from "@axiom/shared/access";
import { templates } from "@axiom/shared/templates";
import {
  parseMarkdown,
  renderDocument,
  slug,
  type ParsedDocument,
  type RenderContext,
} from "@axiom/markdown";
import Auth from "./Auth";
import TableOfContents from "./TableOfContents";
import { sectionAtPosition, type OutlineHeading } from "../lib/outline";
import Dialog, { DialogFocusBoundary } from "./Dialog";
import Graph from "./Graph";
import ReadingView from "./ReadingView";
import AppearanceSettings from "./AppearanceSettings";
import { useAppearance } from "../lib/appearance";
import { useEditorPreferences } from "../lib/editor-preferences";
import CommandPalette from "./CommandPalette";
import NoteTitle from "./NoteTitle";
import TablePicker from "./TablePicker";
import {
  editorCommands,
  keysFor,
  eventBinding,
  shortcutPlatform,
  shortcutLabel,
  type EditorCommandId,
} from "@axiom/shared/editor";
import { useResearch, type CachedPaper } from "../lib/research-store";
import { scrollFraction, type ReadingItem } from "@axiom/shared/research";
import ResearchDataSettings from "./ResearchDataSettings";
import PaperPane from "./PaperPane";
import ReferenceLibrary, { ReferenceEditor } from "./ReferenceLibrary";
import {
  api,
  post,
  download,
  timeAgo,
  initials,
  colorFor,
  cacheAvailable,
  SIGN_OUT_PENDING,
  finishPendingSignOut,
} from "../lib/client";
import type { EditorHandle, EditorMode, CommentAnchor } from "./Editor";
const Editor = dynamic(() => import("./Editor"), {
  ssr: false,
  loading: () => (
    <div className="editor-loading">
      <LoaderCircle className="spin" size={18} />
      Opening your notebook…
    </div>
  ),
});
type Page =
  | "home"
  | "all"
  | "private"
  | "favorites"
  | "trash"
  | "graph"
  | "references"
  | "templates"
  | "project"
  | "note";
type Session = {
  user: { id: string; name: string; email: string };
  emailAvailable: boolean;
  groups: { id: string; name: string; description: string; role: string }[];
};
type Workspace = {
  notes: Note[];
  projects: any[];
  references: any[];
  members: any[];
  notifications: any[];
  links: { source_id: string; target_id: string; target: string }[];
};
const emptyWorkspace: Workspace = {
  notes: [],
  projects: [],
  references: [],
  members: [],
  notifications: [],
  links: [],
};
export default function Notebook() {
  const [session, setSession] = useState<Session | null>(null),
    [booting, setBooting] = useState(true),
    [groupId, setGroupId] = useState(""),
    [workspace, setWorkspace] = useState<Workspace>(emptyWorkspace),
    [page, setPage] = useState<Page>("home"),
    [projectId, setProjectId] = useState<string | null>(null),
    [note, setNote] = useState<Note | null>(null),
    [source, setSource] = useState(""),
    [parsed, setParsed] = useState<ParsedDocument>(() => parseMarkdown("")),
    [mode, setMode] = useState<EditorMode>("write");
  const [sidebar, setSidebar] = useState(true),
    [activeSection, setActiveSection] = useState<string | null>(null),
    [outlineCollapsed, setOutlineCollapsed] = useState<
      Record<string, string[]>
    >({}),
    [outlineReveal, setOutlineReveal] = useState(0),
    [contextOpen, setContextOpen] = useState(true),
    [contextTab, setContextTab] = useState("outline"),
    [collapsed, setCollapsed] = useState<string[]>([]),
    [status, setStatus] = useState("Connecting…"),
    [presence, setPresence] = useState<
      { id: string; name: string; color: string }[]
    >([]),
    [offline, setOffline] = useState(false),
    [remoteVersion, setRemoteVersion] = useState(false);
  const [modal, setModal] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [toast, setToast] = useState(""),
    [templateId, setTemplateId] = useState("blank"),
    [newTitle, setNewTitle] = useState(""),
    [searchQuery, setSearchQuery] = useState(""),
    [searchResults, setSearchResults] = useState<any[]>([]),
    [commentText, setCommentText] = useState(""),
    [commentReply, setCommentReply] = useState<string | null>(null),
    [commentAnchor, setCommentAnchor] = useState<CommentAnchor | null>(null),
    [comments, setComments] = useState<any[]>([]),
    [versions, setVersions] = useState<any[]>([]),
    [attachments, setAttachments] = useState<any[]>([]),
    [pdf, setPdf] = useState<any>(null),
    [readerTab, setReaderTab] = useState("paper"),
    [pendingLocation, setPendingLocation] = useState<{
      id: string;
      heading?: string;
      fraction?: number;
      quote?: string;
    } | null>(null),
    [inviteLink, setInviteLink] = useState(""),
    [importFile, setImportFile] = useState<File | null>(null),
    [importPreview, setImportPreview] = useState<any>(null);
  const editor = useRef<EditorHandle>(null),
    upload = useRef<HTMLInputElement>(null),
    bibUpload = useRef<HTMLInputElement>(null),
    opening = useRef(0),
    workspaceRequest = useRef(0),
    activeGroup = useRef(groupId),
    noteRef = useRef(note),
    initialOpen = useRef(false);
  noteRef.current = note;
  activeGroup.current = groupId;
  const group = session?.groups.find((g) => g.id === groupId),
    project = workspace.projects.find(
      (p) => p.id === (note?.project_id ?? projectId),
    ),
    manager = group?.role === "owner" || group?.role === "admin";
  const appearance = useAppearance(session?.user.id);
  const editorSettings = useEditorPreferences(session?.user.id);
  const [settingsSection, setSettingsSection] = useState("Theme");
  const [recoveredText, setRecoveredText] = useState("");
  useEffect(() => {
    if (!session?.user.id) {
      setRecoveredText("");
      return;
    }
    try {
      setRecoveredText(
        localStorage.getItem(`axiom:editor-recovery:${session.user.id}`) ?? "",
      );
    } catch {
      /* In-memory recovery is still available. */
    }
  }, [session?.user.id]);
  const recoverEditorText = (text: string) => {
    if (!session?.user.id || localStorage.getItem(SIGN_OUT_PENDING)) return;
    setRecoveredText(text);
    try {
      localStorage.setItem(`axiom:editor-recovery:${session.user.id}`, text);
    } catch {
      setToast(
        "Recovered text is in memory only. Download it before closing this page.",
      );
    }
  };
  const research = useResearch(session?.user.id, groupId);
  const researchRef = useRef(research),
    documentScroll = useRef<HTMLElement>(null),
    outlineInput = useRef<"caret" | "scroll">("scroll"),
    readingTouched = useRef(false),
    resumedNote = useRef(""),
    progressTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
      undefined,
    );
  researchRef.current = research;
  const dark = appearance.dark;
  const navigateSection = useCallback(
    (heading: OutlineHeading) => {
      outlineInput.current = "caret";
      setActiveSection(heading.id);
      setOutlineReveal((value) => value + 1);
      if (mode === "read")
        documentScroll.current
          ?.querySelector(
            `.read-mount:not(.print-only) [id="${CSS.escape(heading.id)}"]`,
          )
          ?.scrollIntoView({ block: "start", behavior: "instant" });
      else editor.current?.focus(heading.from);
      if (note?.id)
        history.replaceState(
          null,
          "",
          `/?note=${note.id}#${encodeURIComponent(heading.id)}`,
        );
    },
    [mode, note?.id],
  );
  const updateVisibleSection = useCallback(() => {
    const scroller = documentScroll.current;
    if (!scroller || outlineInput.current !== "scroll") return;
    const top = scroller.getBoundingClientRect().top + 48;
    if (mode !== "read") {
      const position = editor.current?.visiblePosition(top);
      if (position != null)
        setActiveSection(sectionAtPosition(parsed.outline, position));
    } else {
      const elements = scroller.querySelectorAll<HTMLElement>(
        ".read-mount:not(.print-only) :is(h1,h2,h3,h4,h5,h6)[id]",
      );
      let id = parsed.outline[0]?.id ?? null;
      for (const element of elements) {
        if (element.getBoundingClientRect().top > top) break;
        id = element.id;
      }
      setActiveSection(id);
    }
  }, [mode, parsed.outline]);
  const outlineViewRef = useRef(updateVisibleSection);
  outlineViewRef.current = updateVisibleSection;
  useEffect(() => {
    outlineInput.current = "scroll";
    const frame = requestAnimationFrame(() => outlineViewRef.current());
    return () => cancelAnimationFrame(frame);
  }, [note?.id, mode]);
  const closeModal = useCallback(() => {
    editor.current?.cancelInsert();
    setModal(null);
  }, []);
  const commandRef = useRef<(id: EditorCommandId) => void>(() => {});
  const workspaceCommand = (id: EditorCommandId) => {
    if (id === "source") {
      setMode((m) => (m === "source" ? "write" : "source"));
      requestAnimationFrame(() => editor.current?.focus());
    } else if (id === "searchNotes") setModal("search");
    else if (id === "comment") {
      setCommentAnchor(editor.current?.anchor() ?? null);
      setContextTab("comments");
      setContextOpen(true);
    } else if (id === "commands") {
      editor.current?.prepareInsert();
      setModal("commands");
    } else if (id === "shortcuts") {
      setSettingsSection("Keyboard shortcuts");
      setModal("settings");
    } else if (id === "outline") {
      setContextTab("outline");
      setContextOpen((v) => !v);
    } else if (id === "focusMode")
      appearance.apply(
        {
          ...appearance.preferences,
          focusMode: !appearance.preferences.focusMode,
        },
        appearance.device,
      );
    else if (id === "attachment") {
      if (offline) setToast("Reconnect to upload an attachment.");
      else upload.current?.click();
    } else if (id === "table") setModal("insert-table");
  };
  commandRef.current = workspaceCommand;
  const runEditorCommand = (id: EditorCommandId) => {
    if (editorCommands.find((c) => c.id === id)?.scope === "workspace") {
      workspaceCommand(id);
      return;
    }
    if (mode === "read") setMode("write");
    editor.current?.execute(id);
  };
  const report = useCallback(
    (error: unknown) =>
      setToast(error instanceof Error ? error.message : String(error)),
    [],
  );
  const loadSession = useCallback(async () => {
    if (localStorage.getItem(SIGN_OUT_PENDING)) {
      setSession(null);
      setNote(null);
      setWorkspace(emptyWorkspace);
      setBooting(false);
      await finishPendingSignOut();
      return;
    }
    const params = new URLSearchParams(location.search);
    if (
      params.has("reset") ||
      (params.has("reset-flow") && params.has("token"))
    ) {
      // Recovery links must work even while this browser has a valid session.
      setSession(null);
      setNote(null);
      setBooting(false);
      return;
    }
    try {
      const data = await api<Session>("me");
      if (localStorage.getItem(SIGN_OUT_PENDING)) return;
      setSession(data);
      localStorage.setItem("axiom:session", JSON.stringify(data));
      const preferred = localStorage.getItem("axiom:group");
      setGroupId(
        data.groups.some((g) => g.id === preferred)
          ? preferred!
          : (data.groups[0]?.id ?? ""),
      );
      setOffline(false);
    } catch (error) {
      if (cacheAvailable(error)) {
        const cached = localStorage.getItem("axiom:session");
        if (cached) {
          const data = JSON.parse(cached);
          setSession(data);
          setGroupId(
            localStorage.getItem("axiom:group") ?? data.groups[0]?.id ?? "",
          );
          setOffline(true);
        }
      } else setSession(null);
    } finally {
      setBooting(false);
    }
  }, []);
  const loadWorkspace = useCallback(async () => {
    if (!session || !groupId) return;
    const request = ++workspaceRequest.current;
    const cacheKey = `axiom:workspace:${session.user.id}:${groupId}`;
    try {
      const data = await api<Workspace>(`workspace?groupId=${groupId}`);
      if (
        request !== workspaceRequest.current ||
        groupId !== activeGroup.current ||
        localStorage.getItem(SIGN_OUT_PENDING)
      )
        return;
      setWorkspace(data);
      localStorage.setItem(cacheKey, JSON.stringify(data));
      setOffline(false);
      const current = noteRef.current;
      if (current) {
        const fresh = data.notes.find((n) => n.id === current.id);
        if (fresh && fresh.generation !== current.generation)
          setRemoteVersion(true);
        else if (fresh)
          setNote((n) => (n?.id === fresh.id ? { ...n, ...fresh } : n));
      }
    } catch (error) {
      if (
        request !== workspaceRequest.current ||
        groupId !== activeGroup.current ||
        localStorage.getItem(SIGN_OUT_PENDING)
      )
        return;
      const cached = localStorage.getItem(cacheKey);
      if (cacheAvailable(error) && cached) {
        setWorkspace(JSON.parse(cached));
        setOffline(true);
      } else report(error);
    }
  }, [session, groupId, report]);
  const openNote = useCallback(
    async (
      id: string,
      location?: { heading?: string; fraction?: number; quote?: string },
    ) => {
      if (!session) return;
      const request = ++opening.current;
      const key = `axiom:note:${session.user.id}:${id}`;
      try {
        let n: Note;
        try {
          n = await api<Note>(`notes/${id}`);
          localStorage.setItem(key, JSON.stringify(n));
        } catch (error) {
          const cached = localStorage.getItem(key);
          if (cacheAvailable(error) && cached) n = JSON.parse(cached);
          else throw error;
        }
        if (
          request !== opening.current ||
          localStorage.getItem(SIGN_OUT_PENDING)
        )
          return;
        setNote(n);
        readingTouched.current = false;
        resumedNote.current = "";
        if (location) {
          setPendingLocation({ id, ...location });
          resumedNote.current = id;
        }
        setGroupId(n.group_id);
        setSource(n.body);
        setParsed(parseMarkdown(n.body));
        setPage("note");
        setRemoteVersion(false);
        setCommentAnchor(null);
        setCommentReply(null);
        setPresence([]);
        setStatus(navigator.onLine ? "Connecting…" : "Saved locally · offline");
        history.replaceState(null, "", `/?note=${id}`);
        localStorage.setItem("axiom:last-note", id);
        if (window.innerWidth < 900) {
          setSidebar(false);
          setContextOpen(false);
        }
      } catch (error) {
        report(error);
      }
    },
    [session, report],
  );
  const refresh = useCallback(() => {
    void loadWorkspace();
    if (noteRef.current && navigator.onLine) {
      void api(`notes/${noteRef.current.id}/comments`)
        .then(setComments)
        .catch(() => {});
    }
  }, [loadWorkspace]);
  useEffect(() => {
    void loadSession();
    const online = () => {
        setOffline(false);
        void loadSession();
      },
      off = () => setOffline(true);
    window.addEventListener("online", online);
    window.addEventListener("offline", off);
    const signOutInOtherTab = (event: StorageEvent) => {
      if (event.key === SIGN_OUT_PENDING && event.newValue) {
        opening.current++;
        workspaceRequest.current++;
        setSession(null);
        setNote(null);
        setPdf(null);
        setPendingLocation(null);
        clearTimeout(progressTimer.current);
        setWorkspace(emptyWorkspace);
        setModal(null);
      }
    };
    window.addEventListener("storage", signOutInOtherTab);
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production")
      void navigator.serviceWorker
        .register("/workspace-sw.js", { scope: "/", updateViaCache: "none" })
        .catch(report);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", off);
      window.removeEventListener("storage", signOutInOtherTab);
    };
  }, [loadSession, report]);
  useEffect(() => {
    if (groupId) {
      localStorage.setItem("axiom:group", groupId);
      void loadWorkspace();
    }
  }, [groupId, loadWorkspace]);
  useEffect(() => {
    const narrow = matchMedia("(max-width: 899px)");
    const collapse = () => {
      if (narrow.matches) {
        setSidebar(false);
        setContextOpen(false);
      }
    };
    collapse();
    narrow.addEventListener("change", collapse);
    return () => narrow.removeEventListener("change", collapse);
  }, []);
  useEffect(() => {
    const update = () => {
      if (navigator.onLine && document.visibilityState === "visible")
        void loadWorkspace();
    };
    const timer = setInterval(update, 15000);
    window.addEventListener("focus", update);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", update);
    };
  }, [loadWorkspace]);
  useEffect(() => {
    if (!session || initialOpen.current) return;
    initialOpen.current = true;
    const params = new URLSearchParams(location.search),
      id = params.get("note");
    if (id) {
      let heading = "";
      try {
        heading = decodeURIComponent(location.hash.slice(1));
      } catch {
        /* Invalid fragment is ignored. */
      }
      void openNote(id, heading ? { heading } : undefined);
      const paper = params.get("paper");
      if (paper && /^[a-f0-9-]{36}$/.test(paper))
        setPdf({
          id: paper,
          name: "Research paper",
          page: Number(params.get("page")) || undefined,
          annotation: params.get("annotation") || undefined,
        });
    }
    if (params.get("invite"))
      void post("invitation", { token: params.get("invite") })
        .then(async () => {
          history.replaceState(null, "", "/");
          await loadSession();
          setToast("You have joined the research group.");
        })
        .catch(report);
  }, [session, openNote, loadSession, report]);
  useEffect(() => {
    const followLocation = () => {
      const id = new URLSearchParams(location.search).get("note");
      if (!id) return;
      let heading = "";
      try {
        heading = decodeURIComponent(location.hash.slice(1));
      } catch {
        return;
      }
      if (id !== noteRef.current?.id)
        void openNote(id, heading ? { heading } : undefined);
      else if (heading) {
        resumedNote.current = id;
        setPendingLocation({ id, heading });
      }
    };
    window.addEventListener("hashchange", followLocation);
    window.addEventListener("popstate", followLocation);
    return () => {
      window.removeEventListener("hashchange", followLocation);
      window.removeEventListener("popstate", followLocation);
    };
  }, [openNote]);
  useEffect(() => {
    if (
      !pendingLocation ||
      note?.id !== pendingLocation.id ||
      status === "Connecting…"
    )
      return;
    const timer = setTimeout(() => {
      if (pendingLocation.heading || pendingLocation.quote) {
        const heading = parsed.outline.find(
          (h) =>
            h.id === pendingLocation.heading ||
            h.id === slug(pendingLocation.heading ?? "") ||
            h.text === pendingLocation.quote,
        );
        if (!heading) {
          if (status === "Connecting…") return;
          report(
            new Error(
              "This saved heading is no longer present. The note is open so you can find its new location.",
            ),
          );
        } else {
          if (
            mode !== "read" &&
            (!editor.current || editor.current.text() !== source)
          )
            return;
          navigateSection(heading);
        }
        if (heading)
          history.replaceState(
            null,
            "",
            `/?note=${note.id}#${encodeURIComponent(heading.id)}`,
          );
      } else if (
        documentScroll.current &&
        pendingLocation.fraction !== undefined
      )
        documentScroll.current.scrollTop =
          pendingLocation.fraction *
          Math.max(
            0,
            documentScroll.current.scrollHeight -
              documentScroll.current.clientHeight,
          );
      setPendingLocation(null);
    }, 150);
    return () => clearTimeout(timer);
  }, [
    pendingLocation,
    parsed,
    source,
    mode,
    note?.id,
    status,
    report,
    navigateSection,
  ]);
  useEffect(() => {
    if (
      !note ||
      pendingLocation ||
      readingTouched.current ||
      resumedNote.current === note.id
    )
      return;
    const progress = research.entries.find(
      (e) =>
        e.kind === "reading" &&
        !e.value.deleted &&
        (e.value as ReadingItem).kind === "progress" &&
        (e.value as ReadingItem).target_id === note.id,
    )?.value as ReadingItem | undefined;
    if (progress) {
      resumedNote.current = note.id;
      setPendingLocation({ id: note.id, fraction: progress.data.fraction });
    }
  }, [note?.id, research.entries, pendingLocation]);
  useEffect(() => {
    clearTimeout(progressTimer.current);
    return () => clearTimeout(progressTimer.current);
  }, [note?.id, groupId, session?.user.id, page]);
  useEffect(() => {
    if (!note || page !== "note" || !pdf) return;
    history.replaceState(
      null,
      "",
      `/?note=${note.id}&paper=${pdf.id}${pdf.page ? "&page=" + pdf.page : ""}${pdf.annotation ? "&annotation=" + pdf.annotation : ""}`,
    );
  }, [pdf, note?.id, page]);
  useEffect(() => {
    if (!note || page !== "note") return;
    setComments([]);
    setAttachments([]);
    if (!navigator.onLine) {
      setAttachments(
        researchRef.current.papers
          .filter((p) => p.meta.note_id === note.id)
          .map((p) => p.meta),
      );
      return;
    }
    void api(`notes/${note.id}/comments`).then(setComments).catch(report);
    void api(`notes/${note.id}/attachments`).then(setAttachments).catch(report);
  }, [note?.id, page, report]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 6500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.getModifierState("AltGraph") ||
        document.querySelector("dialog[open]")
      )
        return;
      const target = event.target as Element;
      if (
        target.closest?.("input,textarea,[contenteditable]") &&
        !target.closest(".research-editor")
      )
        return;
      const platform = shortcutPlatform(),
        key = eventBinding(event, platform);
      const command = editorCommands.find(
        (c) =>
          c.scope === "workspace" &&
          keysFor(c.id, editorSettings.effective, platform).includes(key),
      );
      if (
        !command ||
        (!note &&
          !["searchNotes", "commands", "shortcuts"].includes(command.id))
      )
        return;
      event.preventDefault();
      commandRef.current(command.id);
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [editorSettings.effective, note]);
  useEffect(() => {
    if (modal !== "search" || !groupId) return;
    const timer = setTimeout(() => {
      if (!navigator.onLine || !searchQuery.trim())
        setSearchResults(
          workspace.notes
            .filter(
              (n) =>
                !n.deleted_at &&
                n.title.toLowerCase().includes(searchQuery.toLowerCase()),
            )
            .slice(0, 30),
        );
      else
        void api(
          `search?groupId=${groupId}&q=${encodeURIComponent(searchQuery)}`,
        )
          .then(setSearchResults)
          .catch(report);
    }, 160);
    return () => clearTimeout(timer);
  }, [searchQuery, modal, workspace.notes, groupId, report]);
  const renderContext = useMemo<RenderContext>(
    () => ({
      theme: dark ? "dark" : "light",
      references: Object.fromEntries(
        workspace.references.map((r) => [r.cite_key, r]),
      ),
      resolveLink: (target) => {
        const [name, heading] = target.split("#");
        const candidates = workspace.notes.filter(
          (n) =>
            !n.deleted_at &&
            (n.id === name || n.title.toLowerCase() === name.toLowerCase()),
        );
        if (candidates.length !== 1) return undefined;
        return {
          href: `/?note=${candidates[0].id}${heading ? "#" + encodeURIComponent(heading) : ""}`,
          title: candidates[0].title,
        };
      },
    }),
    [workspace.references, workspace.notes, dark],
  );
  const openLink = useCallback(
    (target: string) => {
      if (openExternalEditorLink(target)) return;
      const file = /^\/api\/v1\/attachments\/([a-f0-9-]{36})(?:#(.*))?$/.exec(
        target,
      );
      if (file) {
        const params = new URLSearchParams(file[2] ?? "");
        setPdf({
          id: file[1],
          name:
            attachments.find((a) => a.id === file[1])?.name ?? "Research paper",
          page: Number(params.get("page")) || undefined,
          annotation: params.get("annotation") ?? undefined,
        });
        setReaderTab("paper");
        return;
      }
      const [name, rawHeading] = target.split("#");
      let heading: string | undefined = rawHeading;
      try {
        heading = rawHeading ? decodeURIComponent(rawHeading) : undefined;
      } catch {
        /* Keep literal fragment. */
      }
      const candidates = workspace.notes.filter(
        (n) =>
          !n.deleted_at &&
          ((!name && n.id === noteRef.current?.id) ||
            n.id === name ||
            n.title.toLowerCase() === name.toLowerCase()),
      );
      if (candidates.length === 1) {
        if (candidates[0].id === noteRef.current?.id && heading)
          setPendingLocation({ id: candidates[0].id, heading });
        else void openNote(candidates[0].id, heading ? { heading } : undefined);
      } else {
        setSearchQuery(target);
        setModal("search");
      }
    },
    [workspace.notes, openNote, attachments],
  );
  const openCachedPaper = (paper: CachedPaper) => {
    closeModal();
    void openNote(paper.meta.note_id);
    setPdf({ id: paper.meta.id, name: paper.meta.name });
    setReaderTab("paper");
  };
  const openBookmark = (item: ReadingItem) => {
    closeModal();
    if (item.target_type === "note") {
      setReaderTab("note");
      void openNote(item.target_id, item.data);
    } else {
      const cached = research.papers.find((p) => p.meta.id === item.target_id);
      if (cached) {
        openCachedPaper(cached);
        setPdf({
          id: item.target_id,
          name: cached.meta.name,
          page: item.data.page,
        });
      } else
        void api(`attachments/${item.target_id}/meta`)
          .then((meta) => {
            void openNote(meta.note_id);
            setPdf({ id: meta.id, name: meta.name, page: item.data.page });
            setReaderTab("paper");
          })
          .catch(report);
    }
  };
  async function run(work: () => Promise<void>) {
    setBusy(true);
    try {
      await work();
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }
  function navigate(next: Page, project: string | null = null) {
    void loadWorkspace();
    setPage(next);
    setProjectId(project);
    history.replaceState(null, "", "/");
    if (window.innerWidth < 900) setSidebar(false);
  }
  function newNote(template = "blank") {
    setTemplateId(template);
    setNewTitle(
      template === "blank"
        ? ""
        : (templates.find((t) => t.id === template)?.name ?? ""),
    );
    setModal("new-note");
  }
  async function patchNote(input: Record<string, unknown>) {
    if (!note) return;
    const updated = await api<Note>(`notes/${note.id}`, {
      method: "PATCH",
      body: JSON.stringify({ ...input, version: note.version }),
    });
    setNote(updated);
    await loadWorkspace();
  }
  async function createFromTemplate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await run(async () => {
      const created = await post("notes", {
        groupId,
        title: newTitle.trim() || "Untitled",
        projectId: form.get("projectId") || null,
        visibility: form.get("visibility") || "shared",
        body: templates.find((t) => t.id === templateId)!.body,
      });
      closeModal();
      await loadWorkspace();
      await openNote(created.id);
    });
  }
  async function addAttachment(file: File) {
    if (!note) return;
    const destination = note.id;
    await run(async () => {
      const form = new FormData();
      form.append("file", file);
      const result = await api(`notes/${note.id}/attachments`, {
        method: "POST",
        body: form,
      });
      if (noteRef.current?.id !== destination) {
        setToast(
          "Attachment uploaded to the original note. Open it to insert the attachment link.",
        );
        return;
      }
      setAttachments(await api(`notes/${note.id}/attachments`));
      editor.current?.insert(
        `${result.mime.startsWith("image/") ? "!" : ""}[${result.name.replace(/[\[\]]/g, "")}](/api/v1/attachments/${result.id})\n`,
      );
      setToast("Attachment added.");
    });
  }
  async function showHistory() {
    if (!note) return;
    await run(async () => {
      setVersions(await api(`notes/${note.id}/history`));
      setModal("history");
    });
  }
  async function sendComment(event: React.FormEvent) {
    event.preventDefault();
    if (!note || !commentText.trim()) return;
    await run(async () => {
      await post(`notes/${note.id}/comments`, {
        body: commentText,
        parentId: commentReply,
        anchor: commentReply ? null : commentAnchor,
      });
      setCommentText("");
      setCommentAnchor(null);
      setCommentReply(null);
      setComments(await api(`notes/${note.id}/comments`));
    });
  }
  const activeNotes = workspace.notes.filter((n) => !n.deleted_at),
    displayedNotes = workspace.notes.filter((n) =>
      page === "trash"
        ? !!n.deleted_at
        : !n.deleted_at &&
          (page === "private"
            ? n.visibility === "private"
            : page === "favorites"
              ? n.favorite
              : page === "project"
                ? n.project_id === projectId
                : true),
    );
  function noteRows(notes: Note[], nested = false): React.ReactNode {
    return notes.map((n) => (
      <div key={n.id}>
        <button
          className={`note-nav ${page === "note" && note?.id === n.id ? "active" : ""} ${nested ? "nested" : ""}`}
          onClick={() => void openNote(n.id)}
        >
          <FileText size={14} />
          <span>{n.title}</span>
          {n.visibility === "private" && <LockKeyhole size={11} />}
        </button>
        {noteRows(
          activeNotes.filter((child) => child.parent_id === n.id),
          true,
        )}
      </div>
    ));
  }
  function noteList(notes: Note[]) {
    return (
      <div className="notes-list">
        {notes.map((n) => (
          <button
            className="note-list-row"
            key={n.id}
            onClick={() =>
              page === "trash"
                ? void run(async () => {
                    await post(`notes/${n.id}/restore-trash`);
                    await loadWorkspace();
                    setToast("Note restored.");
                  })
                : void openNote(n.id)
            }
          >
            <div className="note-list-icon">
              <FileText size={20} strokeWidth={1.4} />
            </div>
            <div className="note-list-main">
              <strong>{n.title}</strong>
              <span>
                {workspace.projects.find((p) => p.id === n.project_id)?.name ??
                  (n.visibility === "private"
                    ? "Private draft"
                    : "Shared notebook")}
                {n.tags.length > 0 && " · " + n.tags.slice(0, 2).join(", ")}
              </span>
            </div>
            <span className="note-list-time">
              {page === "trash" ? "Restore note" : timeAgo(n.updated_at)}
            </span>
            {page !== "trash" && <ChevronRight size={15} />}
          </button>
        ))}
      </div>
    );
  }
  if (booting)
    return (
      <div className="boot-screen">
        <span className="brand-mark">a</span>
        <p>Opening your workspace…</p>
      </div>
    );
  if (!session)
    return (
      <Auth
        onPasswordReset={() => {
          setSession(null);
          setNote(null);
        }}
        onSignedIn={() => {
          initialOpen.current = false;
          void loadSession();
        }}
      />
    );
  return (
    <DialogFocusBoundary
      className={`app-shell ${sidebar ? "" : "sidebar-hidden"} ${dark ? "dark" : ""}`}
    >
      {sidebar && (
        <aside className="sidebar">
          <div className="sidebar-brand">
            <a
              className="brand"
              href="/"
              onClick={(e) => {
                e.preventDefault();
                navigate("home");
              }}
            >
              <span className="brand-mark">a</span>
              <span>
                Axiom<span className="brand-dot">.</span>
              </span>
            </a>
            <button
              className="icon-button sidebar-toggle"
              aria-label="Hide sidebar"
              onClick={() => setSidebar(false)}
            >
              <Menu size={17} />
            </button>
          </div>
          <button className="group-switch" onClick={() => setModal("groups")}>
            <div className="group-symbol">
              <AtomIcon />
            </div>
            <div>
              <strong>{group?.name ?? "Your workspace"}</strong>
              <span>{workspace.members.length || 1} researchers</span>
            </div>
            <ChevronDown size={14} />
          </button>
          <button className="sidebar-search" onClick={() => setModal("search")}>
            <Search size={15} />
            <span>Find anything</span>
            <kbd>
              {keysFor(
                "searchNotes",
                editorSettings.effective,
                shortcutPlatform(),
              )
                .map((key) => shortcutLabel(key, shortcutPlatform()))
                .join(" / ")}
            </kbd>
          </button>
          <nav className="primary-nav">
            <button
              className={page === "home" ? "active" : ""}
              onClick={() => navigate("home")}
            >
              <Home size={17} />
              Overview
            </button>
            <button
              className={page === "all" ? "active" : ""}
              onClick={() => navigate("all")}
            >
              <FileText size={17} />
              All notes<span className="nav-count">{activeNotes.length}</span>
            </button>
            <button
              className={page === "graph" ? "active" : ""}
              onClick={() => navigate("graph")}
            >
              <Network size={17} />
              Knowledge graph
            </button>
            <button
              className={page === "references" ? "active" : ""}
              onClick={() => navigate("references")}
            >
              <BookOpen size={17} />
              Reference library
            </button>
          </nav>
          <div className="sidebar-scroll">
            <div className="nav-section-title">
              <span>PROJECTS</span>
              <button
                className="icon-button"
                aria-label="New project"
                onClick={() => setModal("project")}
              >
                <Plus size={14} />
              </button>
            </div>
            {workspace.projects.map((p) => (
              <div className="project-nav" key={p.id}>
                <div className="project-nav-heading">
                  <button
                    className="disclosure"
                    aria-label={`${collapsed.includes(p.id) ? "Expand" : "Collapse"} ${p.name}`}
                    onClick={() =>
                      setCollapsed((v) =>
                        v.includes(p.id)
                          ? v.filter((id) => id !== p.id)
                          : [...v, p.id],
                      )
                    }
                  >
                    {collapsed.includes(p.id) ? (
                      <ChevronRight size={13} />
                    ) : (
                      <ChevronDown size={13} />
                    )}
                  </button>
                  <button
                    className={`project-name ${page === "project" && projectId === p.id ? "selected" : ""}`}
                    onClick={() => navigate("project", p.id)}
                  >
                    <Folder size={15} className={`project-color-${p.color}`} />
                    <span>{p.name}</span>
                  </button>
                  <button
                    className="icon-button project-add"
                    aria-label={`Add note to ${p.name}`}
                    onClick={() => {
                      setProjectId(p.id);
                      newNote();
                    }}
                  >
                    <Plus size={12} />
                  </button>
                </div>
                {!collapsed.includes(p.id) &&
                  noteRows(
                    activeNotes.filter(
                      (n) =>
                        n.project_id === p.id &&
                        !n.parent_id &&
                        n.visibility === "shared",
                    ),
                  )}
              </div>
            ))}
            {!!activeNotes.filter(
              (n) => !n.project_id && n.visibility === "shared" && !n.parent_id,
            ).length && (
              <>
                <div className="nav-section-title">
                  <span>SHARED NOTES</span>
                </div>
                {noteRows(
                  activeNotes.filter(
                    (n) =>
                      !n.project_id &&
                      n.visibility === "shared" &&
                      !n.parent_id,
                  ),
                )}
              </>
            )}
            <div className="nav-section-title">
              <span>YOUR SPACE</span>
              <LockKeyhole size={11} />
            </div>
            <nav className="primary-nav private-nav">
              <button
                className={page === "private" ? "active" : ""}
                onClick={() => navigate("private")}
              >
                <LockKeyhole size={16} />
                Private drafts
                <span className="nav-count">
                  {activeNotes.filter((n) => n.visibility === "private").length}
                </span>
              </button>
              <button
                className={page === "favorites" ? "active" : ""}
                onClick={() => navigate("favorites")}
              >
                <Star size={16} />
                Favorites
              </button>
            </nav>
          </div>
          <div className="sidebar-bottom">
            <button onClick={() => navigate("templates")}>
              <LayoutTemplate size={16} />
              Templates
            </button>
            <button onClick={() => navigate("trash")}>
              <Trash2 size={16} />
              Trash
            </button>
            <button onClick={() => setModal("workspace-settings")}>
              <Settings size={16} />
              Settings & members
            </button>
            <div className="sidebar-account">
              <div
                className="avatar"
                style={{ background: colorFor(session.user.id) }}
              >
                {initials(session.user.name)}
              </div>
              <div>
                <strong>{session.user.name}</strong>
                <span>{group?.role ?? "Researcher"}</span>
              </div>
              <button
                className="icon-button"
                aria-label="Notifications"
                onClick={() => setModal("notifications")}
              >
                <Bell size={17} />
                {workspace.notifications.some((n) => !n.read_at) && (
                  <i className="notification-dot" />
                )}
              </button>
            </div>
          </div>
        </aside>
      )}
      <div className="main-area">
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              className="icon-button"
              aria-label="Toggle sidebar"
              onClick={() => setSidebar((v) => !v)}
            >
              <Menu size={18} />
            </button>
            <span className="breadcrumb-group">{group?.name ?? "Axiom"}</span>
            <ChevronRight size={13} />
            <span>
              {page === "note"
                ? note?.visibility === "private"
                  ? "Private drafts"
                  : (project?.name ?? "Shared notebook")
                : page === "project"
                  ? workspace.projects.find((p) => p.id === projectId)?.name
                  : (
                      {
                        home: "Overview",
                        all: "All notes",
                        private: "Private drafts",
                        favorites: "Favorites",
                        trash: "Trash",
                        graph: "Knowledge graph",
                        references: "Reference library",
                        templates: "Templates",
                      } as any
                    )[page]}
            </span>
          </div>
          <div className="topbar-actions">
            {offline && <span className="offline-label">Offline</span>}
            <button
              className="icon-button"
              aria-label={dark ? "Use light theme" : "Use dark theme"}
              onClick={() => {
                appearance.apply(
                  { ...appearance.preferences, mode: dark ? "light" : "dark" },
                  appearance.device,
                );
              }}
            >
              <Sun size={17} className={dark ? "" : "hidden"} />
              <Moon size={17} className={dark ? "hidden" : ""} />
            </button>
            <button
              className="icon-button"
              aria-label="Appearance settings"
              onClick={() => {
                setSettingsSection("Theme");
                setModal("settings");
              }}
            >
              <Settings size={17} />
            </button>
            <button
              className="button primary small"
              onClick={() => newNote()}
              disabled={!groupId || offline}
            >
              <Plus size={15} />
              New note
            </button>
          </div>
        </header>
        {page === "note" && note ? (
          <>
            <div className="document-topline">
              <div
                className="mode-switch"
                role="group"
                aria-label="Editor mode"
              >
                {(["write", "source", "read"] as EditorMode[]).map((m) => (
                  <button
                    key={m}
                    className={mode === m ? "selected" : ""}
                    title={
                      m === "read"
                        ? "Reading view"
                        : keysFor(
                            "source",
                            editorSettings.effective,
                            shortcutPlatform(),
                          )
                            .map((k) => shortcutLabel(k, shortcutPlatform()))
                            .join(" / ")
                    }
                    onClick={() => setMode(m)}
                  >
                    {m === "write" ? (
                      <Type size={14} />
                    ) : m === "source" ? (
                      <Code2 size={14} />
                    ) : (
                      <Eye size={14} />
                    )}
                    {m[0].toUpperCase() + m.slice(1)}
                  </button>
                ))}
              </div>
              <span
                className={`save-status ${status.includes("server") && !status.includes("unavailable") ? "saved" : ""}`}
              >
                <span />
                {status}
              </span>
              <div className="document-collaborators">
                {presence.slice(0, 4).map((u) => (
                  <span
                    key={u.id}
                    className="avatar small"
                    style={{ background: u.color }}
                    title={u.name}
                  >
                    {initials(u.name)}
                  </span>
                ))}
                <span
                  className="avatar small self"
                  style={{ background: colorFor(session.user.id) }}
                  title={`${session.user.name} (you)`}
                >
                  {initials(session.user.name)}
                </span>
              </div>
              <button
                className="icon-button"
                aria-label={
                  workspace.notes.find((n) => n.id === note.id)?.favorite
                    ? "Remove favorite"
                    : "Add favorite"
                }
                onClick={() =>
                  void run(async () => {
                    await post(`notes/${note.id}/favorite`, {
                      favorite: !workspace.notes.find((n) => n.id === note.id)
                        ?.favorite,
                    });
                    await loadWorkspace();
                  })
                }
              >
                <Star
                  size={17}
                  className={
                    workspace.notes.find((n) => n.id === note.id)?.favorite
                      ? "starred"
                      : ""
                  }
                />
              </button>
              <button
                className="button secondary small"
                onClick={() => setModal("share")}
              >
                <Users size={14} />
                Share
              </button>
              <button
                className="icon-button"
                aria-label="Note actions"
                onClick={() => setModal("note-actions")}
              >
                <MoreHorizontal size={19} />
              </button>
              <span className="toolbar-divider" />
              <button
                className="icon-button"
                aria-label="Toggle context panel"
                onClick={() => setContextOpen((v) => !v)}
              >
                {contextOpen ? (
                  <PanelRightClose size={18} />
                ) : (
                  <PanelRightOpen size={18} />
                )}
              </button>
            </div>
            {remoteVersion && (
              <div className="recovery-banner">
                A restored version is available. Your current local text has
                been retained.
                <button
                  onClick={() =>
                    download(
                      note.title + "-local.md",
                      editor.current?.text() ?? source,
                    )
                  }
                >
                  Export local copy
                </button>
                <button onClick={() => void openNote(note.id)}>
                  Open restored version
                </button>
              </div>
            )}
            {pdf && (
              <div
                className="paper-mobile-tabs"
                role="tablist"
                aria-label="Reading workspace"
              >
                <button
                  role="tab"
                  aria-selected={readerTab === "note"}
                  className={readerTab === "note" ? "active" : ""}
                  onClick={() => setReaderTab("note")}
                >
                  Note
                </button>
                <button
                  role="tab"
                  aria-selected={readerTab === "paper"}
                  className={readerTab === "paper" ? "active" : ""}
                  onClick={() => setReaderTab("paper")}
                >
                  Paper
                </button>
              </div>
            )}
            <div
              className={`document-layout ${pdf ? "paper-split-active" : ""}`}
              data-reader-tab={readerTab}
            >
              <main
                className="document-scroll"
                ref={documentScroll}
                onWheel={() => {
                  readingTouched.current = true;
                  outlineInput.current = "scroll";
                }}
                onTouchStart={() => {
                  readingTouched.current = true;
                  outlineInput.current = "scroll";
                }}
                onKeyDown={() => {
                  readingTouched.current = true;
                  outlineInput.current = mode === "read" ? "scroll" : "caret";
                }}
                onPointerDown={(event) => {
                  if (event.target === documentScroll.current)
                    outlineInput.current = "scroll";
                }}
                onScroll={() => {
                  updateVisibleSection();
                  if (!readingTouched.current || !documentScroll.current)
                    return;
                  clearTimeout(progressTimer.current);
                  const el = documentScroll.current,
                    fraction = scrollFraction(el),
                    id = note.id,
                    label = note.title;
                  progressTimer.current = setTimeout(() => {
                    void researchRef.current
                      .saveReading("progress", "note", id, {
                        label,
                        fraction,
                      })
                      .catch(() =>
                        setToast(
                          "Reading position could not be saved. Your document saves separately; retry in Offline files & reading data.",
                        ),
                      );
                  }, 900);
                }}
              >
                {parsed.diagnostics.length > 0 && (
                  <div className="recovery-banner" role="status">
                    {parsed.diagnostics[0].message}
                  </div>
                )}
                <article className="document-page">
                  <div className="document-kicker">
                    <span className="project-indicator" />
                    {note.visibility === "private"
                      ? "PRIVATE DRAFT"
                      : "RESEARCH NOTE"}
                    <span className="document-kicker-line" />
                  </div>
                  <NoteTitle
                    key={note.id + ":" + note.version}
                    value={note.title}
                    typography={appearance.effective}
                    onSave={(title) => {
                      void run(() => patchNote({ title }));
                    }}
                    onContinue={() => editor.current?.focus()}
                  />
                  <div className="document-meta">
                    <button
                      aria-label="Bookmark this note section"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() =>
                        void run(async () => {
                          const position = editor.current?.position() ?? 0;
                          const heading =
                            mode === "read"
                              ? [...parsed.outline]
                                  .reverse()
                                  .find(
                                    (h) =>
                                      (document
                                        .getElementById(h.id)
                                        ?.getBoundingClientRect().top ??
                                        Infinity) <
                                      (documentScroll.current?.getBoundingClientRect()
                                        .top ?? 0) +
                                        130,
                                  )
                              : [...parsed.outline]
                                  .reverse()
                                  .find((h) => h.from <= position);
                          await research.saveReading(
                            "bookmark",
                            "note",
                            note.id,
                            {
                              label: note.title,
                              heading: heading?.id,
                              quote: heading?.text,
                              generation: note.generation,
                              fraction: scrollFraction(documentScroll.current),
                            },
                          );
                          setToast(
                            "Section bookmarked privately. Find it in Offline files & reading data.",
                          );
                        })
                      }
                    >
                      <BookmarkPlus size={14} />
                      Bookmark
                    </button>
                    <span>Updated {timeAgo(note.updated_at)}</span>
                    <span className="meta-dot">·</span>
                    <button onClick={() => setModal("note-actions")}>
                      {note.tags.length ? (
                        note.tags.map((tag) => (
                          <span className="tag" key={tag}>
                            {tag}
                          </span>
                        ))
                      ) : (
                        <span className="muted">Add tags</span>
                      )}
                    </button>
                  </div>
                  {mode !== "read" &&
                    editorSettings.effective.formattingBar && (
                      <div
                        className="format-toolbar"
                        onMouseDown={(e) => {
                          if ((e.target as Element).closest("button"))
                            e.preventDefault();
                        }}
                      >
                        {(
                          [
                            ["bold", "Bold", Bold],
                            ["italic", "Italic", Italic],
                            ["heading2", "Heading", Type],
                            ["task", "Task list", ListChecks],
                            ["quote", "Quote", Quote],
                            ["mathBlock", "Insert equation", Sigma],
                            ["codeBlock", "Insert code", Code2],
                            ["table", "Insert table", Table2],
                            ["noteLink", "Link a note", LinkIcon],
                            ["attachment", "Attach image or file", ImagePlus],
                          ] as const
                        ).map(([id, label, Icon]) => (
                          <button
                            key={id}
                            aria-label={label}
                            title={
                              label +
                              (keysFor(
                                id,
                                editorSettings.effective,
                                shortcutPlatform(),
                              ).length
                                ? " · " +
                                  keysFor(
                                    id,
                                    editorSettings.effective,
                                    shortcutPlatform(),
                                  )
                                    .map((k) =>
                                      shortcutLabel(k, shortcutPlatform()),
                                    )
                                    .join(" / ")
                                : "")
                            }
                            disabled={id === "attachment" && offline}
                            onClick={() => runEditorCommand(id)}
                          >
                            <Icon size={16} />
                          </button>
                        ))}
                        <button
                          aria-label="Comment on selection"
                          onClick={() => {
                            setCommentAnchor(editor.current?.anchor() ?? null);
                            setContextTab("comments");
                            setContextOpen(true);
                          }}
                        >
                          <MessageSquare size={16} />
                        </button>
                        <div className="toolbar-spacer" />
                        <button
                          aria-label="Search editor commands"
                          title="Search commands"
                          onClick={() => workspaceCommand("commands")}
                        >
                          <Search size={16} />
                        </button>
                        <button
                          className="insert-menu"
                          onClick={() => {
                            editor.current?.prepareInsert();
                            setModal("insert");
                          }}
                        >
                          <Plus size={14} />
                          Insert
                          <ChevronDown size={12} />
                        </button>
                      </div>
                    )}
                  <div
                    className={
                      mode === "read" ? "editor-mount hidden" : "editor-mount"
                    }
                  >
                    <Editor
                      ref={editor}
                      note={note}
                      user={session.user}
                      mode={mode}
                      appearance={appearance.effective}
                      preferences={editorSettings.effective}
                      onCommand={workspaceCommand}
                      onRecover={recoverEditorText}
                      renderContext={renderContext}
                      notes={activeNotes}
                      onChange={(value, ast) => {
                        setSource(value);
                        setParsed(ast);
                        if (mode !== "read" && outlineInput.current === "caret")
                          setActiveSection(
                            sectionAtPosition(
                              ast.outline,
                              editor.current?.position() ?? 0,
                            ),
                          );
                      }}
                      onNavigation={(position) => {
                        if (mode === "read") return;
                        outlineInput.current = "caret";
                        setActiveSection(
                          sectionAtPosition(parsed.outline, position),
                        );
                      }}
                      onStatus={setStatus}
                      onPresence={setPresence}
                      onRefresh={refresh}
                      onError={report}
                      onLink={openLink}
                    />
                  </div>
                  <div
                    className={
                      mode === "read" ? "read-mount" : "read-mount print-only"
                    }
                  >
                    <ReadingView
                      active={mode === "read"}
                      parsed={parsed}
                      context={renderContext}
                      onLink={openLink}
                      personalPrint={appearance.effective.exportTypography}
                    />
                  </div>
                  {!source.trim() && mode !== "read" && (
                    <div className="empty-editor-hint">
                      Start with a thought, a question, or an equation.
                      <br />
                      <button
                        className="text-button"
                        onClick={() => setModal("insert")}
                      >
                        Explore writing tools <ArrowRight size={13} />
                      </button>
                    </div>
                  )}
                  {attachments.length > 0 && (
                    <section className="document-attachments">
                      <div className="eyebrow">ATTACHED TO THIS NOTE</div>
                      {attachments.map((file) => (
                        <button
                          key={file.id}
                          className="attachment-card"
                          onClick={() => {
                            if (file.mime === "application/pdf") {
                              setPdf(file);
                              setReaderTab("paper");
                            } else
                              window.open(
                                `/api/v1/attachments/${file.id}`,
                                "_blank",
                                "noopener,noreferrer",
                              );
                          }}
                        >
                          <FileText size={20} />
                          <span>
                            <strong>{file.name}</strong>
                            <small>
                              {file.mime === "application/pdf"
                                ? "PDF document"
                                : "Attachment"}{" "}
                              · {(Number(file.bytes) / 1024).toFixed(0)} KB
                            </small>
                          </span>
                          <ArrowUpRight size={16} />
                        </button>
                      ))}
                    </section>
                  )}
                  <div className="document-end">
                    <span />
                    <span>Keep asking good questions.</span>
                    <span />
                  </div>
                </article>
              </main>
              {pdf && (
                <PaperPane
                  paper={pdf}
                  userId={session.user.id}
                  research={research}
                  onClose={() => {
                    setPdf(null);
                    history.replaceState(null, "", `/?note=${note.id}`);
                  }}
                  onInsert={(value, privateMaterial) => {
                    if (
                      privateMaterial &&
                      note.visibility === "shared" &&
                      !confirm(
                        "This inserts private research material into a shared note. Everyone with access to the note will be able to read the inserted text. Continue?",
                      )
                    )
                      return;
                    editor.current?.insert(value);
                    if (mode === "read") setMode("write");
                    setReaderTab("note");
                  }}
                />
              )}
              {contextOpen && !pdf && (
                <aside className="context-panel">
                  <div
                    className="context-tabs"
                    role="tablist"
                    aria-label="Note context"
                  >
                    {[
                      { id: "outline", icon: List, label: "Outline" },
                      { id: "links", icon: LinkIcon, label: "Backlinks" },
                      { id: "references", icon: BookOpen, label: "References" },
                      {
                        id: "comments",
                        icon: MessageSquare,
                        label: "Comments",
                      },
                    ].map(({ id, icon: Icon, label }) => (
                      <button
                        role="tab"
                        aria-selected={contextTab === id}
                        aria-label={label}
                        title={label}
                        key={id}
                        className={contextTab === id ? "selected" : ""}
                        onClick={() => setContextTab(id)}
                      >
                        <Icon size={16} />
                        {id === "comments" &&
                          comments.filter((c) => !c.parent_id && !c.resolved)
                            .length > 0 && <i />}
                      </button>
                    ))}
                  </div>
                  {contextTab === "outline" && (
                    <>
                      <TableOfContents
                        headings={parsed.outline}
                        activeId={
                          parsed.outline.some((h) => h.id === activeSection)
                            ? activeSection
                            : (parsed.outline[0]?.id ?? null)
                        }
                        collapsed={outlineCollapsed[note.id] ?? []}
                        onCollapsedChange={(ids) =>
                          setOutlineCollapsed((value) => ({
                            ...value,
                            [note.id]: ids,
                          }))
                        }
                        onNavigate={navigateSection}
                        reveal={outlineReveal}
                      />
                      <div className="context-divider" />
                      <div className="context-heading">
                        CONNECTED NOTES
                        <span>
                          {
                            workspace.links.filter(
                              (l) => l.source_id === note.id,
                            ).length
                          }
                        </span>
                      </div>
                      {workspace.links
                        .filter((l) => l.source_id === note.id)
                        .map((link, i) => (
                          <button
                            className="connected-note"
                            key={i}
                            onClick={() => void openNote(link.target_id)}
                          >
                            <FileText size={14} />
                            <span>
                              {
                                workspace.notes.find(
                                  (n) => n.id === link.target_id,
                                )?.title
                              }
                            </span>
                            <ArrowUpRight size={12} />
                          </button>
                        ))}
                      <div className="context-tip">
                        <div className="tip-symbol">
                          <LinkIcon size={15} />
                        </div>
                        <strong>Think in connections.</strong>
                        <p>
                          Use <code>[[note links]]</code> to connect ideas
                          across your notebook.
                        </p>
                        <button
                          className="text-button"
                          onClick={() => setModal("link-note")}
                        >
                          Link a note <ArrowRight size={12} />
                        </button>
                      </div>
                    </>
                  )}
                  {contextTab === "links" && (
                    <>
                      <div className="context-heading">
                        LINKING TO THIS NOTE
                      </div>
                      {workspace.links
                        .filter((l) => l.target_id === note.id)
                        .map((link, i) => (
                          <button
                            className="connected-note"
                            key={i}
                            onClick={() => void openNote(link.source_id)}
                          >
                            <FileText size={14} />
                            <span>
                              {
                                workspace.notes.find(
                                  (n) => n.id === link.source_id,
                                )?.title
                              }
                            </span>
                          </button>
                        ))}
                      {!workspace.links.some(
                        (l) => l.target_id === note.id,
                      ) && (
                        <p className="context-empty">
                          When another note links here, you’ll find it in this
                          panel.
                        </p>
                      )}
                      <button
                        className="context-action"
                        onClick={() => navigate("graph")}
                      >
                        <Network size={15} />
                        Explore the knowledge graph
                      </button>
                    </>
                  )}
                  {contextTab === "references" && (
                    <>
                      <div className="context-heading">REFERENCE LIBRARY</div>
                      {workspace.references.map((r) => (
                        <div className="context-reference" key={r.id}>
                          <span className="reference-key">{r.cite_key}</span>
                          <strong>{r.title}</strong>
                          <small>
                            {r.authors} · {r.year}
                          </small>
                          <button
                            className="text-button"
                            onClick={() =>
                              editor.current?.insert(`[@${r.cite_key}]`)
                            }
                          >
                            Insert citation <Plus size={12} />
                          </button>
                        </div>
                      ))}
                      <button
                        className="context-action"
                        onClick={() => setModal("reference")}
                      >
                        <Plus size={15} />
                        Add a reference
                      </button>
                    </>
                  )}
                  {contextTab === "comments" && (
                    <>
                      <div className="context-heading">
                        DISCUSSION
                        <span>
                          {comments.filter((c) => !c.parent_id).length}
                        </span>
                      </div>
                      <div className="comment-list">
                        {comments
                          .filter((c) => !c.parent_id)
                          .map((c) => (
                            <div
                              className={`comment-thread ${c.resolved ? "resolved" : ""}`}
                              key={c.id}
                            >
                              <div className="comment-author">
                                <span
                                  className="avatar tiny"
                                  style={{ background: colorFor(c.author_id) }}
                                >
                                  {initials(c.author_name)}
                                </span>
                                <strong>{c.author_name}</strong>
                                <span>{timeAgo(c.created_at)}</span>
                              </div>
                              {c.anchor && (
                                <button
                                  className="comment-quote"
                                  onClick={() => {
                                    setMode("write");
                                    if (!editor.current?.locate(c.anchor))
                                      setToast(
                                        "The original text is no longer available in this version.",
                                      );
                                  }}
                                >
                                  {c.anchor.quote}
                                  {c.anchor.generation !== note.generation && (
                                    <small>Original anchor unavailable</small>
                                  )}
                                </button>
                              )}
                              <p>{c.body}</p>
                              <div className="comment-actions">
                                <button
                                  onClick={() => {
                                    setCommentReply(c.id);
                                    setCommentAnchor(null);
                                  }}
                                >
                                  Reply
                                </button>
                                <button
                                  onClick={() =>
                                    void run(async () => {
                                      await api(`comments/${c.id}`, {
                                        method: "PATCH",
                                        body: JSON.stringify({
                                          resolved: !c.resolved,
                                        }),
                                      });
                                      refresh();
                                    })
                                  }
                                >
                                  {c.resolved ? (
                                    <>
                                      <CheckCheck size={12} />
                                      Resolved
                                    </>
                                  ) : (
                                    "Resolve"
                                  )}
                                </button>
                              </div>
                              {comments
                                .filter((reply) => reply.parent_id === c.id)
                                .map((reply) => (
                                  <div className="comment-reply" key={reply.id}>
                                    <strong>{reply.author_name}</strong>
                                    <p>{reply.body}</p>
                                  </div>
                                ))}
                            </div>
                          ))}
                        {!comments.length && (
                          <p className="context-empty">
                            Bring another perspective.
                            <br />
                            Start a discussion or select text to leave an
                            anchored comment.
                          </p>
                        )}
                      </div>
                      <form className="comment-form" onSubmit={sendComment}>
                        {(commentAnchor || commentReply) && (
                          <div className="comment-selection">
                            <span>
                              {commentReply
                                ? "Replying to thread"
                                : commentAnchor!.quote}
                            </span>
                            <button
                              type="button"
                              aria-label="Clear comment selection"
                              onClick={() => {
                                setCommentAnchor(null);
                                setCommentReply(null);
                              }}
                            >
                              <X size={12} />
                            </button>
                          </div>
                        )}
                        <textarea
                          aria-label="Write a comment"
                          placeholder="Add a thought or a question…"
                          value={commentText}
                          onChange={(e) => setCommentText(e.target.value)}
                          rows={3}
                        />
                        <button
                          className="button primary small"
                          disabled={!commentText.trim() || busy || offline}
                        >
                          Post comment
                          <ArrowRight size={13} />
                        </button>
                      </form>
                    </>
                  )}
                </aside>
              )}
            </div>
            <footer className="editor-footer">
              <span>
                <span className="status-dot" />
                {note.visibility === "private"
                  ? "Private to you"
                  : "Shared with your group"}
              </span>
              <span>
                {source.trim()
                  ? source.trim().split(/\s+/).length.toLocaleString()
                  : 0}{" "}
                words<span className="footer-separator">·</span>Markdown
                <span className="footer-separator">·</span>
                <button onClick={() => setModal("help")}>
                  Writing guide <CircleHelp size={12} />
                </button>
              </span>
            </footer>
          </>
        ) : (
          <main className="workspace-scroll">
            {page === "graph" ? (
              <Graph
                notes={workspace.notes}
                links={workspace.links}
                open={(id) => void openNote(id)}
              />
            ) : page === "references" ? (
              <ReferenceLibrary
                groupId={groupId}
                references={workspace.references}
                notes={workspace.notes}
                projects={workspace.projects}
                research={research}
                onRefresh={loadWorkspace}
                onImport={() => bibUpload.current?.click()}
                onOpenNote={(id) => {
                  setReaderTab("note");
                  void openNote(id);
                }}
                onOpenPaper={(paper) => {
                  void openNote(paper.note_id);
                  setPdf(paper);
                  setReaderTab("paper");
                }}
              />
            ) : page === "templates" ? (
              <section className="collection-page">
                <div className="eyebrow">A THOUGHTFUL STARTING POINT</div>
                <h1>Research templates</h1>
                <p className="muted">
                  Structure that supports your thinking, with room to make it
                  your own.
                </p>
                <div className="template-grid">
                  {templates.map((t, i) => (
                    <button
                      className="template-card"
                      key={t.id}
                      onClick={() => newNote(t.id)}
                    >
                      <div className={`template-art template-art-${i}`}>
                        <TemplateIcon id={t.id} size={32} />
                        <span />
                        <span />
                        <span />
                      </div>
                      <h3>{t.name}</h3>
                      <p>{t.description}</p>
                      <span className="template-use">
                        Use template <ArrowUpRight size={14} />
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            ) : (
              <section className="collection-page">
                {page === "home" ? (
                  <>
                    <div className="overview-welcome">
                      <div>
                        <div className="eyebrow">
                          YOUR SHARED RESEARCH NOTEBOOK
                        </div>
                        <h1>
                          A place to think together
                          <span className="serif-dot">.</span>
                        </h1>
                        <p className="muted">
                          Welcome back, {session.user.name.split(" ")[0]}. Pick
                          up a thread, or start a new one.
                        </p>
                      </div>
                      <div className="overview-date">
                        <span>
                          {new Date().toLocaleDateString(undefined, {
                            weekday: "long",
                          })}
                        </span>
                        <strong>
                          {new Date().toLocaleDateString(undefined, {
                            month: "long",
                            day: "numeric",
                          })}
                        </strong>
                      </div>
                    </div>
                    <div className="overview-stats">
                      <span>
                        <FileText size={16} />
                        <strong>
                          {
                            activeNotes.filter((n) => n.visibility === "shared")
                              .length
                          }
                        </strong>
                        shared notes
                      </span>
                      <span>
                        <Folder size={16} />
                        <strong>{workspace.projects.length}</strong>projects
                      </span>
                      <span>
                        <Users size={16} />
                        <strong>{workspace.members.length}</strong>researchers
                      </span>
                      <span>
                        <LinkIcon size={16} />
                        <strong>{workspace.links.length}</strong>connections
                      </span>
                    </div>
                    {workspace.projects.length > 0 && (
                      <>
                        <div className="list-section-heading">
                          <h2>Your projects</h2>
                          <button
                            className="text-button"
                            onClick={() => setModal("project")}
                          >
                            <Plus size={14} />
                            New project
                          </button>
                        </div>
                        <div className="project-grid">
                          {workspace.projects.map((p) => (
                            <button
                              className={`project-card project-color-${p.color}`}
                              key={p.id}
                              onClick={() => navigate("project", p.id)}
                            >
                              <div className="project-card-top">
                                <Folder size={21} strokeWidth={1.5} />
                                <ArrowUpRight size={15} />
                              </div>
                              <h3>{p.name}</h3>
                              <p>
                                {p.description ||
                                  "A shared space to explore a research question."}
                              </p>
                              <span>
                                {
                                  activeNotes.filter(
                                    (n) =>
                                      n.project_id === p.id &&
                                      n.visibility === "shared",
                                  ).length
                                }{" "}
                                notes
                              </span>
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                    <div className="list-section-heading">
                      <h2>Recently opened threads</h2>
                      <button
                        className="text-button"
                        onClick={() => navigate("all")}
                      >
                        All notes <ArrowRight size={14} />
                      </button>
                    </div>
                    {noteList(activeNotes.slice(0, 8))}
                    <div className="overview-bottom">
                      <div className="overview-prompt">
                        <Sparkles size={20} strokeWidth={1.4} />
                        <div>
                          <h3>Give your next idea a little structure.</h3>
                          <p>
                            Start a paper review, derivation, or experiment log.
                          </p>
                        </div>
                        <button
                          className="button secondary small"
                          onClick={() => navigate("templates")}
                        >
                          Explore templates
                          <ArrowRight size={14} />
                        </button>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="section-heading">
                      <div>
                        <div className="eyebrow">
                          {page === "private"
                            ? "SPACE TO THINK OUT LOUD"
                            : page === "trash"
                              ? "RECOVER RECENT WORK"
                              : "YOUR RESEARCH, ORGANIZED"}
                        </div>
                        <h1>
                          {page === "project"
                            ? workspace.projects.find((p) => p.id === projectId)
                                ?.name
                            : (
                                {
                                  all: "All notes",
                                  private: "Private drafts",
                                  favorites: "Favorites",
                                  trash: "Trash",
                                } as any
                              )[page]}
                        </h1>
                        <p className="muted">
                          {page === "private"
                            ? "Only you can access these drafts. Publish them when they are ready."
                            : page === "trash"
                              ? "Deleted notes can be restored for 30 days."
                              : page === "favorites"
                                ? "Keep useful ideas within reach."
                                : page === "project"
                                  ? workspace.projects.find(
                                      (p) => p.id === projectId,
                                    )?.description
                                  : "Every question, derivation, and discovery in your workspace."}
                        </p>
                      </div>
                      {page !== "trash" && (
                        <button
                          className="button primary"
                          onClick={() => newNote()}
                        >
                          <Plus size={16} />
                          New note
                        </button>
                      )}
                    </div>
                    <div className="collection-tools">
                      <span>{displayedNotes.length} notes</span>
                      <span>
                        Last updated <ChevronDown size={12} />
                      </span>
                    </div>
                    {noteList(displayedNotes)}
                  </>
                )}
                {!displayedNotes.length && (
                  <Empty
                    icon={<FileText />}
                    title={
                      page === "trash"
                        ? "Nothing in the trash"
                        : "Every notebook starts with a question"
                    }
                    description={
                      page === "trash"
                        ? "Notes you delete will appear here temporarily."
                        : "Create a note and give the next idea somewhere to grow."
                    }
                    action={
                      page === "trash"
                        ? undefined
                        : () => (groupId ? newNote() : setModal("groups"))
                    }
                    label={
                      groupId ? "Create a note" : "Create your research group"
                    }
                  />
                )}
              </section>
            )}
          </main>
        )}
      </div>
      <input
        ref={upload}
        type="file"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void addAttachment(file);
          e.currentTarget.value = "";
        }}
      />
      <input
        ref={bibUpload}
        type="file"
        accept=".bib"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file)
            void run(async () => {
              const result = await api(`references?groupId=${groupId}`, {
                method: "PUT",
                body: JSON.stringify({ bibtex: await file.text() }),
              });
              await loadWorkspace();
              setToast(
                `Imported ${result.added} references; ${result.skipped} existing entries preserved.`,
              );
            });
          e.currentTarget.value = "";
        }}
      />
      {toast && (
        <div className="toast" role="status">
          <span>{toast}</span>
          <button
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {recoveredText && (
        <aside className="editor-recovery" aria-label="Recovered editor text">
          <strong>A block changed while you were editing</strong>
          <p>
            Your text is retained here. Copy or download it before dismissing.
          </p>
          <textarea
            aria-label="Recovered editor text"
            readOnly
            value={recoveredText}
          />
          <div>
            <button
              className="button secondary"
              onClick={() =>
                download("recovered-editor-text.md", recoveredText)
              }
            >
              Download recovered text
            </button>
            <button
              className="button secondary"
              onClick={() => {
                setRecoveredText("");
                if (session?.user.id)
                  localStorage.removeItem(
                    `axiom:editor-recovery:${session.user.id}`,
                  );
              }}
            >
              Dismiss recovery
            </button>
          </div>
        </aside>
      )}
      {modal && (
        <Dialog
          title={modalTitle(modal)}
          subtitle={
            modal === "new-note"
              ? "Start with a clear page or a little structure."
              : undefined
          }
          onClose={closeModal}
          size={
            modal === "settings"
              ? "settings"
              : [
                    "trash-confirm",
                    "restore-confirm",
                    "remove-member",
                    "logout",
                    "password",
                    "project",
                  ].includes(modal)
                ? "compact"
                : undefined
          }
          wide={[
            "new-note",
            "settings",
            "workspace-settings",
            "research-data",
            "help",
          ].includes(modal)}
        >
          {modal === "new-note" && (
            <form onSubmit={createFromTemplate}>
              <label>
                Note title
                <input
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="A question worth exploring"
                  autoFocus
                  maxLength={200}
                />
              </label>
              <div className="compact-templates">
                {templates.map((t) => (
                  <button
                    type="button"
                    key={t.id}
                    className={templateId === t.id ? "selected" : ""}
                    onClick={() => {
                      setTemplateId(t.id);
                      if (!newTitle)
                        setNewTitle(t.id === "blank" ? "" : t.name);
                    }}
                  >
                    <TemplateIcon id={t.id} size={19} />
                    <span>{t.name}</span>
                    {templateId === t.id && <Check size={13} />}
                  </button>
                ))}
              </div>
              <div className="form-grid">
                <label>
                  Project
                  <select
                    name="projectId"
                    defaultValue={
                      page === "project" || modal === "new-note"
                        ? (projectId ?? "")
                        : ""
                    }
                  >
                    <option value="">Shared notebook</option>
                    {workspace.projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Visibility
                  <select
                    name="visibility"
                    defaultValue={page === "private" ? "private" : "shared"}
                  >
                    <option value="shared">Shared with group</option>
                    <option value="private">Private draft</option>
                  </select>
                </label>
              </div>
              <div className="dialog-footer">
                <button
                  className="button secondary"
                  type="button"
                  onClick={closeModal}
                >
                  Cancel
                </button>
                <button className="button primary" disabled={busy}>
                  Create note
                  <ArrowRight size={15} />
                </button>
              </div>
            </form>
          )}
          {modal === "project" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const form = new FormData(e.currentTarget);
                void run(async () => {
                  const p = await post("projects", {
                    groupId,
                    name: form.get("name"),
                    description: form.get("description"),
                    color: form.get("color"),
                  });
                  await loadWorkspace();
                  closeModal();
                  navigate("project", p.id);
                });
              }}
            >
              <label>
                Project name
                <input
                  name="name"
                  required
                  autoFocus
                  placeholder="A new research direction"
                  maxLength={200}
                />
              </label>
              <label>
                Description
                <textarea
                  name="description"
                  rows={3}
                  placeholder="What are you exploring together?"
                />
              </label>
              <label>
                Color
                <select name="color">
                  <option value="blue">Slate blue</option>
                  <option value="green">Sage green</option>
                  <option value="purple">Muted violet</option>
                  <option value="orange">Warm ochre</option>
                </select>
              </label>
              <div className="dialog-footer">
                <button className="button primary" disabled={busy}>
                  <FolderPlus size={15} />
                  Create project
                </button>
              </div>
            </form>
          )}
          {modal === "groups" && (
            <>
              <div className="group-options">
                {session.groups.map((g) => (
                  <button
                    key={g.id}
                    onClick={() => {
                      setGroupId(g.id);
                      setNote(null);
                      setWorkspace(emptyWorkspace);
                      navigate("home");
                      closeModal();
                    }}
                  >
                    <Users size={18} />
                    <span>
                      <strong>{g.name}</strong>
                      <small>{g.role}</small>
                    </span>
                    {g.id === groupId && <Check size={15} />}
                  </button>
                ))}
              </div>
              <hr />
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const name = new FormData(e.currentTarget).get("name");
                  void run(async () => {
                    const g = await post("groups", { name });
                    await loadSession();
                    setGroupId(g.id);
                    closeModal();
                    navigate("home");
                  });
                }}
              >
                <label>
                  Create a research group
                  <input
                    name="name"
                    required
                    placeholder="Your lab or group name"
                  />
                </label>
                <button className="button primary" disabled={busy}>
                  <Plus size={15} />
                  Create group
                </button>
              </form>
            </>
          )}
          {modal === "search" && (
            <>
              <label className="search-field dialog-search">
                <Search size={19} />
                <input
                  autoFocus
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search notes, ideas, or tags…"
                />
              </label>
              <div className="search-results">
                {searchResults.map((result) => (
                  <button
                    key={result.id}
                    onClick={() => {
                      void openNote(result.id);
                      closeModal();
                    }}
                  >
                    <FileText size={18} />
                    <div>
                      <strong>{result.title}</strong>
                      {result.excerpt && <p>{result.excerpt}</p>}
                    </div>
                    <ArrowUpRight size={14} />
                  </button>
                ))}
                {!searchResults.length && (
                  <p className="muted">No notes found. Try another phrase.</p>
                )}
              </div>
            </>
          )}
          {modal === "link-note" && (
            <>
              <p className="muted">Insert a stable link to another note.</p>
              <div className="search-results">
                {activeNotes
                  .filter((n) => n.id !== note?.id)
                  .map((n) => (
                    <button
                      key={n.id}
                      onClick={() => {
                        editor.current?.insert(`[[${n.id}|${n.title}]]`);
                        closeModal();
                      }}
                    >
                      <FileText size={16} />
                      <strong>{n.title}</strong>
                      <Plus size={14} />
                    </button>
                  ))}
              </div>
            </>
          )}
          {modal === "equation" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const form = new FormData(e.currentTarget),
                  value = String(form.get("latex") ?? "");
                editor.current?.insert(
                  form.get("display") === "on"
                    ? "\n$$\n" + value + "\n$$\n"
                    : "$" + value + "$",
                );
                closeModal();
              }}
            >
              <label>
                LaTeX expression
                <textarea
                  className="mono"
                  name="latex"
                  autoFocus
                  rows={4}
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="E = mc^2"
                  required
                />
              </label>
              <label className="checkbox-label">
                <input type="checkbox" name="display" defaultChecked />
                Display on its own line
              </label>
              <div
                className="equation-preview prose"
                dangerouslySetInnerHTML={{
                  __html: renderDocument(
                    parseMarkdown("$$\n" + (newTitle || "E = mc^2") + "\n$$"),
                  ),
                }}
              />
              <div className="dialog-footer">
                <button className="button primary">
                  Insert equation
                  <Sigma size={15} />
                </button>
              </div>
            </form>
          )}
          {(modal === "insert" || modal === "commands") && (
            <CommandPalette
              preferences={editorSettings.effective}
              insertOnly={modal === "insert"}
              hasNote={!!note}
              tableActive={editor.current?.tableActive()}
              offline={offline}
              onExecute={(id) => {
                setModal(null);
                if (
                  editorCommands.find((c) => c.id === id)?.scope === "workspace"
                )
                  editor.current?.cancelInsert();
                runEditorCommand(id);
              }}
            />
          )}
          {modal === "insert-table" && (
            <TablePicker
              onInsert={(rows, columns) => {
                editor.current?.execute("table", { rows, columns });
                closeModal();
              }}
            />
          )}
          {modal === "share" && note && (
            <>
              <div className="sharing-summary">
                <div className="sharing-icon">
                  {note.visibility === "private" ? (
                    <LockKeyhole size={24} />
                  ) : (
                    <Users size={24} />
                  )}
                </div>
                <h3>
                  {note.visibility === "private"
                    ? "A private space for your thinking"
                    : "A shared note for your group"}
                </h3>
                <p>
                  {note.visibility === "private"
                    ? "Only you can open this draft. Publish it when you are ready to discuss it."
                    : `Members of ${group?.name} can read, edit, and comment on this note.`}
                </p>
              </div>
              {note.visibility === "private" ? (
                <button
                  className="button primary"
                  onClick={() =>
                    void run(async () => {
                      await patchNote({ visibility: "shared" });
                      closeModal();
                      setToast("Note published to your group.");
                    })
                  }
                >
                  Publish to group
                  <ArrowRight size={15} />
                </button>
              ) : (
                <button
                  className="button primary"
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(`${location.origin}/?note=${note.id}`)
                      .then(() => setToast("Group-only note link copied."))
                  }
                >
                  <Copy size={15} />
                  Copy note link
                </button>
              )}
              {manager && (
                <button
                  className="button secondary"
                  onClick={() => {
                    setModal("workspace-settings");
                    setInviteLink("");
                  }}
                >
                  <Users size={15} />
                  Manage members
                </button>
              )}
            </>
          )}
          {modal === "note-actions" && note && (
            <>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = new FormData(e.currentTarget);
                  void run(async () => {
                    await patchNote({
                      tags: String(form.get("tags"))
                        .split(",")
                        .map((t) => t.trim())
                        .filter(Boolean),
                      projectId: form.get("projectId") || null,
                      parentId: form.get("parentId") || null,
                    });
                    closeModal();
                  });
                }}
              >
                <label>
                  Tags
                  <input
                    name="tags"
                    defaultValue={note.tags.join(", ")}
                    placeholder="Separate tags with commas"
                  />
                </label>
                <div className="form-grid">
                  <label>
                    Project
                    <select
                      name="projectId"
                      defaultValue={note.project_id ?? ""}
                    >
                      <option value="">Shared notebook</option>
                      {workspace.projects.map((p) => (
                        <option value={p.id} key={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Parent note
                    <select name="parentId" defaultValue={note.parent_id ?? ""}>
                      <option value="">Top-level note</option>
                      {activeNotes
                        .filter(
                          (n) =>
                            n.id !== note.id &&
                            n.visibility === note.visibility &&
                            n.project_id === note.project_id,
                        )
                        .map((n) => (
                          <option key={n.id} value={n.id}>
                            {n.title}
                          </option>
                        ))}
                    </select>
                  </label>
                </div>
                <button className="button primary small" disabled={busy}>
                  Save details
                </button>
              </form>
              <hr />
              <div className="action-list">
                <button onClick={() => void showHistory()}>
                  <History size={17} />
                  Version history
                  <ChevronRight size={14} />
                </button>
                <button
                  onClick={() => {
                    download(
                      note.title + ".md",
                      editor.current?.text() ?? source,
                    );
                    closeModal();
                  }}
                >
                  <Download size={17} />
                  Export Markdown
                </button>
                <button
                  disabled={offline || busy}
                  onClick={() =>
                    void run(async () => {
                      await editor.current?.flush();
                      const response = await fetch(
                        `/api/v1/notes/${note.id}/export?format=html${appearance.effective.exportTypography ? "&appearance=reading" : ""}`,
                      );
                      if (!response.ok)
                        throw new Error(
                          (await response.json()).error ??
                            "HTML export failed.",
                        );
                      download(
                        note.title + ".html",
                        await response.text(),
                        "text/html",
                      );
                      closeModal();
                    })
                  }
                >
                  <Code2 size={17} />
                  Export HTML
                </button>
                <button
                  onClick={() => {
                    setMode("read");
                    closeModal();
                    void printDocument().catch((error) =>
                      setToast(error.message),
                    );
                  }}
                >
                  <ArrowDownToLine size={17} />
                  Print / save as PDF
                </button>
                <button
                  onClick={() =>
                    void run(async () => {
                      const created = await post("notes", {
                        groupId,
                        title: note.title + " — private copy",
                        visibility: "private",
                        body: editor.current?.text() ?? source,
                        tags: note.tags,
                      });
                      closeModal();
                      await loadWorkspace();
                      await openNote(created.id);
                    })
                  }
                >
                  <Copy size={17} />
                  Copy to private drafts
                </button>
                <button
                  className="danger-text"
                  onClick={() => setModal("trash-confirm")}
                >
                  <Trash2 size={17} />
                  Move to trash
                </button>
              </div>
            </>
          )}
          {modal === "trash-confirm" && note && (
            <>
              <p>
                Move “{note.title}” to the trash? You can restore it for 30
                days.
              </p>
              <div className="dialog-footer">
                <button className="button secondary" onClick={closeModal}>
                  Keep note
                </button>
                <button
                  className="button danger"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await api(`notes/${note.id}`, { method: "DELETE" });
                      setNote(null);
                      navigate("all");
                      await loadWorkspace();
                      closeModal();
                    })
                  }
                >
                  Move to trash
                </button>
              </div>
            </>
          )}
          {modal === "history" && note && (
            <>
              <form
                className="inline-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = e.currentTarget,
                    label = new FormData(form).get("label");
                  void run(async () => {
                    await editor.current?.flush();
                    await post(`notes/${note.id}/history`, { label });
                    setVersions(await api(`notes/${note.id}/history`));
                    form.reset();
                  });
                }}
              >
                <input
                  name="label"
                  required
                  placeholder="Name a milestone…"
                  aria-label="Milestone name"
                />
                <button className="button primary small" disabled={busy}>
                  Save
                </button>
              </form>
              <div className="version-list">
                {versions.map((version) => (
                  <div key={version.id}>
                    <Clock3 size={18} />
                    <div>
                      <strong>{version.label ?? "Automatic checkpoint"}</strong>
                      <span>
                        {new Date(version.created_at).toLocaleString()}{" "}
                        {version.author_name && "· " + version.author_name}
                      </span>
                    </div>
                    <button
                      className="button secondary small"
                      disabled={busy}
                      onClick={() => {
                        setNewTitle(version.id);
                        setModal("restore-confirm");
                      }}
                    >
                      Restore
                    </button>
                  </div>
                ))}
              </div>
              {!versions.length && (
                <p className="muted">
                  Save your first milestone. Automatic checkpoints are created
                  while you work.
                </p>
              )}
            </>
          )}
          {modal === "restore-confirm" && note && (
            <>
              <p>
                Restore this version? The current document will be preserved as
                a “Before restore” checkpoint, and collaborators will be asked
                to reopen the restored document.
              </p>
              <div className="dialog-footer">
                <button
                  className="button secondary"
                  onClick={() => setModal("history")}
                >
                  Cancel
                </button>
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await editor.current?.flush();
                      await post(`notes/${note.id}/restore-version`, {
                        snapshotId: newTitle,
                      });
                      await openNote(note.id);
                      await loadWorkspace();
                      closeModal();
                    })
                  }
                >
                  Restore version
                </button>
              </div>
            </>
          )}
          {modal === "reference" && (
            <ReferenceEditor
              groupId={groupId}
              references={workspace.references}
              notes={activeNotes}
              onSaved={async () => {
                await loadWorkspace();
                closeModal();
              }}
              onCancel={closeModal}
            />
          )}
          {modal === "settings" && (
            <AppearanceSettings
              appearance={appearance}
              editorSettings={editorSettings}
              initialSection={settingsSection}
              onClose={closeModal}
              onWorkspace={() => setModal("workspace-settings")}
              onData={() => setModal("research-data")}
            />
          )}
          {modal === "research-data" && (
            <ResearchDataSettings
              userId={session.user.id}
              research={research}
              preferences={appearance.preferences}
              onOpenPaper={openCachedPaper}
              onOpenBookmark={openBookmark}
            />
          )}
          {modal === "workspace-settings" && (
            <div className="settings-content">
              <div className="settings-section">
                <div className="settings-section-heading">
                  <h3>Group members</h3>
                  <span className="muted">
                    {workspace.members.length} researchers
                  </span>
                </div>
                {workspace.members.map((member) => (
                  <div className="member-row" key={member.id}>
                    <span
                      className="avatar"
                      style={{ background: colorFor(member.id) }}
                    >
                      {initials(member.name)}
                    </span>
                    <div>
                      <strong>{member.name}</strong>
                      <small>{member.email}</small>
                    </div>
                    {group?.role === "owner" && member.role !== "owner" ? (
                      <select
                        aria-label={`Role for ${member.name}`}
                        value={member.role}
                        onChange={(e) =>
                          void run(async () => {
                            await api(
                              `members/${member.id}?groupId=${groupId}`,
                              {
                                method: "PATCH",
                                body: JSON.stringify({ role: e.target.value }),
                              },
                            );
                            await loadWorkspace();
                          })
                        }
                      >
                        <option value="member">Member</option>
                        <option value="admin">Admin</option>
                      </select>
                    ) : (
                      <span className="role-badge">{member.role}</span>
                    )}
                    {manager &&
                      member.role !== "owner" &&
                      member.id !== session.user.id && (
                        <button
                          className="icon-button danger-text"
                          aria-label={`Remove ${member.name}`}
                          onClick={() => {
                            setNewTitle(member.id);
                            setModal("remove-member");
                          }}
                        >
                          <X size={15} />
                        </button>
                      )}
                  </div>
                ))}
                {manager && (
                  <form
                    className="invite-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const form = new FormData(e.currentTarget);
                      void run(async () => {
                        const result = await post("invitations", {
                          groupId,
                          email: form.get("email"),
                          role: form.get("role"),
                        });
                        setInviteLink(result.link);
                        setToast(
                          result.emailed
                            ? "Invitation email sent."
                            : "Invitation ready. Copy the link and share it with this member.",
                        );
                      });
                    }}
                  >
                    <label>
                      Invite a researcher
                      <input
                        type="email"
                        name="email"
                        placeholder="colleague@research.org"
                        required
                      />
                    </label>
                    <div className="invite-form-actions">
                      <select name="role" aria-label="Invitation role">
                        <option value="member">Member</option>
                        {group?.role === "owner" && (
                          <option value="admin">Administrator</option>
                        )}
                      </select>
                      <button className="button primary small" disabled={busy}>
                        <Plus size={14} />
                        Create invitation
                      </button>
                    </div>
                    {inviteLink && (
                      <div className="copy-field">
                        <input
                          value={inviteLink}
                          readOnly
                          aria-label="Invitation link"
                        />
                        <button
                          type="button"
                          className="icon-button"
                          aria-label="Copy invitation"
                          onClick={() =>
                            void navigator.clipboard
                              .writeText(inviteLink)
                              .then(() => setToast("Invitation copied."))
                          }
                        >
                          <Copy size={15} />
                        </button>
                      </div>
                    )}
                  </form>
                )}
              </div>
              <div className="settings-section">
                <h3>Import & export</h3>
                <p className="muted">
                  Keep your notes portable with Markdown and BibTeX.
                </p>
                <div className="button-row">
                  <button
                    className="button secondary small"
                    onClick={() => {
                      setImportFile(null);
                      setImportPreview(null);
                      setModal("import");
                    }}
                  >
                    <Upload size={14} />
                    Import notes
                  </button>
                  <a
                    className="button secondary small"
                    href={`/api/v1/export?groupId=${groupId}`}
                  >
                    <Download size={14} />
                    Export shared notebook
                  </a>
                </div>
              </div>
              <div className="settings-section">
                <h3>Your account</h3>
                <p className="muted">{session.user.email}</p>
                <div className="button-row">
                  <button
                    className="button secondary small"
                    onClick={() => setModal("password")}
                  >
                    <LockKeyhole size={14} />
                    Change password
                  </button>
                  <button
                    className="button secondary small"
                    onClick={() => setModal("logout")}
                  >
                    <LogOut size={14} />
                    Sign out
                  </button>
                </div>
              </div>
            </div>
          )}
          {modal === "remove-member" && (
            <>
              <p>
                Remove {workspace.members.find((m) => m.id === newTitle)?.name}{" "}
                from this group? Their access to shared notes will end.
              </p>
              <div className="dialog-footer">
                <button
                  className="button secondary"
                  onClick={() => setModal("workspace-settings")}
                >
                  Cancel
                </button>
                <button
                  className="button danger"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await api(`members/${newTitle}?groupId=${groupId}`, {
                        method: "DELETE",
                      });
                      await loadWorkspace();
                      setModal("workspace-settings");
                    })
                  }
                >
                  Remove member
                </button>
              </div>
            </>
          )}
          {modal === "password" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const form = new FormData(e.currentTarget);
                void run(async () => {
                  const response = await fetch("/api/auth/change-password", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({
                      currentPassword: form.get("current"),
                      newPassword: form.get("next"),
                      revokeOtherSessions: true,
                    }),
                  });
                  const data = await response.json();
                  if (!response.ok) throw new Error(data.message);
                  closeModal();
                  setToast(
                    "Password changed. Other sessions have been signed out.",
                  );
                });
              }}
            >
              <label>
                Current password
                <input
                  type="password"
                  name="current"
                  autoComplete="current-password"
                  required
                />
              </label>
              <label>
                New password
                <input
                  type="password"
                  name="next"
                  autoComplete="new-password"
                  minLength={12}
                  required
                />
              </label>
              <div className="dialog-footer">
                <button className="button primary" disabled={busy}>
                  Change password
                </button>
              </div>
            </form>
          )}
          {modal === "logout" && (
            <>
              <p>
                Sign out and clear this account’s cached notes from this
                browser? Export any unsynchronized text you want to keep first.
                {!navigator.onLine &&
                  " Server-session revocation will finish automatically when this browser reconnects."}
              </p>
              <div className="dialog-footer">
                {note && (
                  <button
                    className="button secondary"
                    onClick={() =>
                      download(
                        note.title + "-local.md",
                        editor.current?.text() ?? source,
                      )
                    }
                  >
                    Export current note
                  </button>
                )}
                <button
                  className="button primary"
                  onClick={() =>
                    void run(async () => {
                      localStorage.setItem(
                        SIGN_OUT_PENDING,
                        crypto.randomUUID(),
                      );
                      opening.current++;
                      workspaceRequest.current++;
                      const userId = session.user.id;
                      setSession(null);
                      setNote(null);
                      setPdf(null);
                      setPendingLocation(null);
                      clearTimeout(progressTimer.current);
                      setWorkspace(emptyWorkspace);
                      closeModal();
                      initialOpen.current = false;
                      history.replaceState(null, "", "/");
                      for (const key of Object.keys(localStorage))
                        if (
                          key.startsWith("axiom:workspace:" + userId) ||
                          key.startsWith("axiom:note:" + userId) ||
                          key === "axiom:session" ||
                          key === "axiom:appearance" ||
                          key === `axiom:preferences:${userId}` ||
                          key === `axiom:editor-preferences:${userId}` ||
                          key === `axiom:editor-recovery:${userId}`
                        )
                          localStorage.removeItem(key);
                      await new Promise((resolve) => setTimeout(resolve, 100));
                      for (const database of await indexedDB.databases())
                        if (database.name?.startsWith(`axiom:${userId}:`))
                          indexedDB.deleteDatabase(database.name);
                      if (!(await finishPendingSignOut()))
                        setToast(
                          "Signed out on this device. Reconnect to finish server-session revocation.",
                        );
                    })
                  }
                >
                  Sign out
                </button>
              </div>
            </>
          )}
          {modal === "import" && (
            <>
              <label>
                Markdown file or ZIP archive
                <input
                  type="file"
                  accept=".md,.zip"
                  onChange={(e) => {
                    setImportPreview(null);
                    setImportFile(e.target.files?.[0] ?? null);
                  }}
                />
              </label>
              {importPreview && (
                <>
                  <p className="muted">{importPreview.warning}</p>
                  <div className="import-preview">
                    {importPreview.notes.map((n: any, i: number) => (
                      <div key={i}>
                        <FileText size={15} />
                        <span>{n.title}</span>
                        <small>
                          {n.characters.toLocaleString()} characters
                        </small>
                      </div>
                    ))}
                  </div>
                </>
              )}
              <div className="dialog-footer">
                <button
                  className="button primary"
                  disabled={!importFile || busy}
                  onClick={() =>
                    void run(async () => {
                      const form = new FormData();
                      form.append("file", importFile!);
                      const data = await api(
                        `import?groupId=${groupId}${importPreview ? "" : "&preview=true"}`,
                        { method: "POST", body: form },
                      );
                      if (importPreview) {
                        await loadWorkspace();
                        closeModal();
                        setToast(`Imported ${data.imported} notes.`);
                      } else setImportPreview(data);
                    })
                  }
                >
                  {importPreview ? "Import notes" : "Preview import"}
                  <ArrowRight size={15} />
                </button>
              </div>
            </>
          )}
          {modal === "notifications" && (
            <>
              <div className="notification-list">
                {workspace.notifications.map((n) => (
                  <button
                    key={n.id}
                    onClick={() => {
                      if (n.note_id) void openNote(n.note_id);
                      closeModal();
                    }}
                  >
                    <MessageSquare size={17} />
                    <span>
                      {n.message}
                      <small>{timeAgo(n.created_at)}</small>
                    </span>
                    {!n.read_at && <i className="unread-dot" />}
                  </button>
                ))}
                {!workspace.notifications.length && (
                  <p className="muted">
                    You’re all caught up. New discussions will appear here.
                  </p>
                )}
              </div>
              <button
                className="button secondary small"
                onClick={() =>
                  void run(async () => {
                    await post("notifications");
                    await loadWorkspace();
                  })
                }
              >
                <CheckCheck size={15} />
                Mark all as read
              </button>
            </>
          )}
          {modal === "help" && (
            <div className="writing-guide">
              <p>
                Write naturally in live preview, or switch to Source for the
                full Markdown document. Both views update together for every
                collaborator.
              </p>
              <table>
                <tbody>
                  {[
                    ["Heading", "## A section"],
                    ["Bold / italic", "**important** · *emphasis*"],
                    ["Inline math", "$E = mc^2$"],
                    [
                      "Display math",
                      "$$ on separate lines around your equation",
                    ],
                    [
                      "Equation reference",
                      "\\label{energy} inside math; \\eqref{energy} in text",
                    ],
                    ["Link a note", "[[Note title]] or choose Link a note"],
                    ["Citation", "[@author2026]"],
                    ["Footnote", "[^key] and [^key]: supporting detail"],
                    ["Theorem / proof", "> [!THEOREM] Title · > [!PROOF]"],
                    ["Diagram", "A fenced code block with language mermaid"],
                    ["Task", "- [ ] Something to investigate"],
                    ["Slash commands", "Type / in an empty paragraph"],
                    [
                      "Source mode",
                      keysFor(
                        "source",
                        editorSettings.effective,
                        shortcutPlatform(),
                      )
                        .map((k) => shortcutLabel(k, shortcutPlatform()))
                        .join(" / "),
                    ],
                  ].map(([label, example]) => (
                    <tr key={label}>
                      <th>{label}</th>
                      <td>
                        <code>{example}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="muted">
                Open notes remain available offline. New notes, attachments,
                membership changes, and server history need a connection.
              </p>
              <button
                className="button secondary"
                onClick={() => workspaceCommand("shortcuts")}
              >
                Customize keyboard shortcuts
              </button>
              <div className="shortcut-guide">
                {editorCommands
                  .filter(
                    (c) =>
                      keysFor(
                        c.id,
                        editorSettings.effective,
                        shortcutPlatform(),
                      ).length,
                  )
                  .map((c) => (
                    <div key={c.id}>
                      <span>{c.label}</span>
                      <kbd>
                        {keysFor(
                          c.id,
                          editorSettings.effective,
                          shortcutPlatform(),
                        )
                          .map((k) => shortcutLabel(k, shortcutPlatform()))
                          .join(" / ")}
                      </kbd>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </Dialog>
      )}
    </DialogFocusBoundary>
  );
}
function AtomIcon() {
  return <span className="group-glyph">∴</span>;
}
function TemplateIcon({ id, size = 20 }: { id: string; size?: number }) {
  const Icon =
    (
      {
        blank: FileText,
        paper: BookOpen,
        derivation: Sigma,
        experiment: FlaskConical,
        proposal: Sparkles,
        meeting: Users,
      } as any
    )[id] ?? FileText;
  return <Icon size={size} strokeWidth={1.4} />;
}
function Empty({
  icon,
  title,
  description,
  action,
  label,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: () => void;
  label?: string;
}) {
  return (
    <div className="empty-state">
      <div>{icon}</div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action && (
        <button className="button primary small" onClick={action}>
          {label}
          <Plus size={14} />
        </button>
      )}
    </div>
  );
}
function modalTitle(modal: string) {
  return (
    (
      {
        "new-note": "A new page of possibility",
        project: "New research project",
        groups: "Your research groups",
        search: "Find a thread",
        "link-note": "Connect a note",
        equation: "Write an equation",
        insert: "Add to your note",
        commands: "Commands",
        "insert-table": "Insert a table",
        share: "Share & collaborate",
        "note-actions": "Note details",
        "trash-confirm": "Move note to trash",
        history: "Version history",
        "restore-confirm": "Restore a saved version",
        reference: "Add a reference",
        settings: "Appearance",
        "workspace-settings": "Account & group administration",
        "research-data": "Offline files & reading data",
        "remove-member": "Remove group member",
        password: "Change your password",
        logout: "Sign out",
        import: "Import your notes",
        notifications: "Your inbox",
        pdf: "Paper reader",
        help: "A guide to writing in Axiom",
      } as Record<string, string>
    )[modal] ?? "Axiom"
  );
}
