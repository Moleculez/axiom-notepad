"use client";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Folder } from "lucide-react";
import type {
  Resource,
  Space,
  SpaceLifecycleAction,
} from "@axiom/shared/workspace";
import { shortcutLabel, shortcutPlatform } from "@axiom/shared/editor";
import { openContextMenu, type ContextAction } from "../../lib/context-menu";
import type { ActionIconName } from "../../lib/icons/actions";
import { post } from "../../lib/client";
import { droppedFiles } from "../../lib/folder-drop";
import Dialog from "../Dialog";
import NewFileDialog from "./NewFileDialog";
import { fileTypes, type FileType } from "@axiom/shared/file-types";
import { fileRoute } from "@axiom/shared/file-routes";
import { pinOffline } from "../../lib/offline-files";
import type { FolderTarget } from "./FileOperations";
const CreateGroupDialog = dynamic(() =>
  import("./GroupsHub").then((module) => module.CreateGroupDialog),
);
const FileOperationDialog = dynamic(() =>
  import("./FileOperations").then((module) => module.FileOperationDialog),
);
const ShortcutDialog = dynamic(() =>
  import("./FileOperations").then((module) => module.ShortcutDialog),
);
import {
  folderColors,
  type FileOperationInput,
} from "@axiom/shared/file-workflows";
const CreateResource = dynamic(() =>
  import("./Explorer").then((module) => module.CreateResource),
);
const NameDialog = dynamic(() =>
  import("./Explorer").then((module) => module.NameDialog),
);
const MoveResource = dynamic(() =>
  import("./Explorer").then((module) => module.MoveResource),
);
const TransferResource = dynamic(() =>
  import("./Explorer").then((module) => module.TransferResource),
);
const FileSafetyDialog = dynamic(() =>
  import("./Explorer").then((module) => module.FileSafetyDialog),
);
const ResourceInspector = dynamic(() =>
  import("./Explorer").then((module) => module.ResourceInspector),
);
import {
  bytes,
  ErrorNotice,
  mutate,
  useAction,
  useData,
  useWorkspace,
} from "./ui";

type ResourceCommand =
  | "open"
  | "split"
  | "rename"
  | "copyTo"
  | "move"
  | "transfer"
  | "duplicate"
  | "copy"
  | "cut"
  | "favorite"
  | "link"
  | "export"
  | "versions"
  | "properties"
  | "trash"
  | "restore"
  | "purge";
const resourceIcons = {
  open: "open",
  split: "split",
  rename: "rename",
  copyTo: "copyTo",
  move: "move",
  transfer: "transfer",
  duplicate: "duplicate",
  copy: "copy",
  cut: "cut",
  favorite: "star",
  link: "link",
  export: "download",
  versions: "history",
  properties: "info",
  trash: "trash",
  restore: "restore",
  purge: "purge",
} as const satisfies Record<ResourceCommand, ActionIconName>;
const lifecycleIcons = {
  archive: "archive",
  unarchive: "restore",
  trash: "trash",
  restore: "restore",
  purge: "purge",
} as const satisfies Record<SpaceLifecycleAction, ActionIconName>;
type SelectionOptions = {
  properties?: (item: Resource) => void;
  completed?: (ids: string[]) => void;
};
type Target = { spaceId: string; parentId: string | null };
type MenuEvent =
  React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>;
type ResourceOperation = {
  command: ResourceCommand;
  items: Resource[];
  options: SelectionOptions;
};
type Modal =
  | { kind: "newFile"; type: FileType; target: Target }
  | {
      kind: "files";
      command: FileOperationInput["command"];
      items: Resource[];
      target?: FolderTarget;
    }
  | { kind: "shortcut"; item: Resource }
  | { kind: "color"; items: Resource[] }
  | { kind: "resource"; operation: ResourceOperation }
  | { kind: "paste"; target: Target }
  | { kind: "create"; resourceKind: "note" | "folder"; target: Target }
  | { kind: "newWorkspace" }
  | { kind: "newProject"; space: Space }
  | { kind: "renameSpace"; space: Space }
  | { kind: "lifecycle"; space: Space; action: SpaceLifecycleAction }
  | { kind: "leave"; space: Space };
type Management = {
  execute: (
    command: ResourceCommand,
    items: Resource[],
    options?: SelectionOptions,
  ) => void;
  resourceMenu: (
    event: MenuEvent,
    items: Resource[],
    options?: SelectionOptions,
  ) => void;
  resourceKey: (
    event: React.KeyboardEvent<HTMLElement>,
    items: Resource[],
    options?: SelectionOptions,
    target?: Target,
  ) => void;
  workspaceMenu: (event: MenuEvent, space: Space) => void;
  backgroundMenu: (event: MenuEvent, target?: Target) => void;
  createMenu: (event: MenuEvent, target: Target) => void;
  manage: () => void;
  fileActivity: () => void;
  beginDrag: (event: React.DragEvent<HTMLElement>, items: Resource[]) => void;
  dragOver: (
    event: React.DragEvent<HTMLElement>,
    target: Target,
    hover?: () => void,
  ) => void;
  dragLeave: (event: React.DragEvent<HTMLElement>) => void;
  drop: (event: React.DragEvent<HTMLElement>, target: Target) => void;
};
const Context = createContext<Management | null>(null);
export function useManagement() {
  const value = useContext(Context);
  if (!value) throw new Error("Management actions are unavailable.");
  return value;
}
function place(event: MenuEvent, items: ContextAction[], label: string) {
  event.preventDefault();
  event.stopPropagation();
  const owner = event.currentTarget;
  const box = owner.getBoundingClientRect();
  const pointer =
    "clientX" in event && (event.clientX !== 0 || event.clientY !== 0);
  openContextMenu({
    owner,
    x: pointer ? event.clientX : box.left + 16,
    y: pointer ? event.clientY : box.bottom,
    items,
    label,
    restore: () => owner.focus({ preventScroll: true }),
  });
}
const keys = (key: string) => shortcutLabel("Mod-" + key, shortcutPlatform());
function resourceUrl(item: Resource) {
  return fileRoute(item);
}

export function ManagementProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { spaces, refresh, navigate, open, upload, notify, session } =
    useWorkspace();
  const liveSpaces = useRef(spaces);
  liveSpaces.current = spaces;
  const [modal, setModal] = useState<Modal | null>(null);
  const dragged = useRef<Resource[]>([]),
    hoverDrop = useRef<{
      key: string;
      timer: ReturnType<typeof setTimeout>;
    } | null>(null);
  const clearDrag = () => {
    if (hoverDrop.current) clearTimeout(hoverDrop.current.timer);
    hoverDrop.current = null;
    document
      .querySelectorAll("[data-drop-target]")
      .forEach((e) => e.removeAttribute("data-drop-target"));
  };
  useEffect(() => {
    const end = () => {
      dragged.current = [];
      clearDrag();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") end();
    };
    window.addEventListener("dragend", end);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("dragend", end);
      window.removeEventListener("keydown", key);
      clearDrag();
    };
  }, []);
  const [clipboard, setClipboard] = useState<{
    cut: boolean;
    items: Resource[];
  } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null),
    uploadTarget = useRef<Target | null>(null);
  const done = (ids: string[] = [], options: SelectionOptions = {}) => {
    refresh();
    options.completed?.(ids);
    setModal(null);
  };
  const report = (work: () => Promise<void>) => {
    void work().catch((error) =>
      notify(
        error instanceof Error
          ? error.message
          : "This action could not be completed.",
      ),
    );
  };
  const writable = (item: Resource) => {
    const space = spaces.find((s) => s.id === item.space_id);
    return (
      (space?.effective_status ?? "active") === "active" &&
      (item.role ?? space?.role) === "editor"
    );
  };
  const execute: Management["execute"] = (command, items, options = {}) => {
    if (!items.length) return;
    const first = items[0];
    const live = items.every((item) => !item.deleted_at),
      editable = items.every(writable);
    if (!navigator.onLine && ["rename", "move", "trash"].includes(command)) {
      if (!editable || !live) {
        notify("Download editable, active files before changing them offline.");
        return;
      }
      if (items.length > 1 && command !== "trash") {
        notify("Change one item at a time while offline.");
        return;
      }
      setModal({ kind: "resource", operation: { command, items, options } });
      return;
    }
    if (
      ["move", "transfer", "copyTo", "duplicate", "trash", "restore"].includes(
        command,
      ) ||
      (command === "rename" && items.length > 1)
    ) {
      if (command !== "copyTo" && !editable) {
        notify("This action requires editor access to an active workspace.");
        return;
      }
      if (command !== "restore" && !live) {
        notify("Restore these items first.");
        return;
      }
      setModal({
        kind: "files",
        command:
          command === "copyTo" || command === "duplicate"
            ? "copy"
            : command === "transfer"
              ? "move"
              : (command as FileOperationInput["command"]),
        items: items.map((r) => ({ ...r })),
        ...(command === "duplicate"
          ? { target: { spaceId: first.space_id, parentId: first.parent_id } }
          : {}),
      });
      return;
    }
    if (
      !live &&
      !["properties", "versions", "restore", "purge"].includes(command)
    ) {
      notify("Restore these items before using this action.");
      return;
    }
    if (
      items.length !== 1 &&
      [
        "open",
        "split",
        "rename",
        "move",
        "transfer",
        "copyTo",
        "link",
        "properties",
        "versions",
        "purge",
      ].includes(command)
    ) {
      notify(
        "Choose one item for this action. Use Copy/Cut and Paste to move a selection.",
      );
      return;
    }
    if (
      ["rename", "move", "transfer", "cut", "trash", "restore"].includes(
        command,
      ) &&
      !editable
    ) {
      notify("This action requires editor access to an active workspace.");
      return;
    }
    if (["copy", "cut"].includes(command)) {
      setClipboard({
        cut: command === "cut",
        items: items.map((item) => ({ ...item })),
      });
      notify(
        `${items.length} item${items.length === 1 ? "" : "s"} ready to ${command === "cut" ? "move" : "copy"}. Choose a folder and Paste.`,
      );
      return;
    }
    if (command === "open") {
      if (first.kind === "folder") navigate(resourceUrl(first));
      else open(first);
      return;
    }
    if (command === "split") {
      open(first, true);
      return;
    }
    if (command === "properties" && options.properties) {
      options.properties(first);
      return;
    }
    if (command === "favorite") {
      report(async () => {
        for (const item of items)
          await post(`resources/${item.id}/favorite`, {
            favorite: !first.favorite,
          });
        refresh();
      });
      return;
    }
    if (command === "link") {
      report(async () => {
        await navigator.clipboard.writeText(
          location.origin + "/workbench" + resourceUrl(first),
        );
        notify("Link copied. Existing access permissions still apply.");
      });
      return;
    }
    if (command === "export") {
      report(async () => {
        if (!items.every((item) => item.space_id === first.space_id))
          throw new Error("Export one workspace at a time.");
        await mutate("exports", {
          spaceId: first.space_id,
          resourceIds: items.map((item) => item.id),
        });
        navigate("/settings/exports");
      });
      return;
    }
    if (command === "duplicate") {
      report(async () => {
        for (const item of items)
          await mutate(`resources/${item.id}/copy`, {
            version: item.version,
            destinationSpaceId: item.space_id,
            parentId: item.parent_id,
            confirmAudience: false,
          });
        refresh();
        notify("Copies created. Originals and their history are unchanged.");
      });
      return;
    }
    setModal({
      kind: "resource",
      operation: {
        command,
        items: items.map((item) => ({ ...item })),
        options,
      },
    });
  };
  const resourceItems = (
    items: Resource[],
    options: SelectionOptions = {},
  ): ContextAction[] => {
    const first = items[0];
    if (!first) return [];
    const single = items.length === 1,
      live = items.every((item) => !item.deleted_at),
      trash = items.every((item) => !!item.deleted_at),
      edit = items.every(writable);
    const item = (
      id: ResourceCommand,
      label: string,
      disabled = false,
      group = "",
      shortcut?: string,
    ): ContextAction => ({
      id,
      icon: id === "favorite" && first.favorite ? "starOff" : resourceIcons[id],
      label,
      disabled,
      hidden:
        disabled ||
        (!single &&
          ["open", "split", "link", "properties", "versions", "purge"].includes(
            id,
          )),
      group,
      shortcut,
      disabledReason:
        !single &&
        [
          "rename",
          "move",
          "transfer",
          "copyTo",
          "properties",
          "versions",
        ].includes(id)
          ? "Choose one item, or use Copy/Cut and Paste for a selection."
          : "Your access or the workspace state does not allow this action.",
      tone: ["trash", "purge"].includes(id) ? "danger" : undefined,
      action: () => execute(id, items, options),
    });
    if (trash)
      return [
        item("restore", "Restore", !edit, "Recovery"),
        item("properties", "Properties…", !single),
        item(
          "purge",
          "Delete permanently…",
          !single || !spaces.find((s) => s.id === first.space_id)?.can_manage,
          "Permanent removal",
        ),
      ];
    const actions: ContextAction[] = [
      item("open", "Open", !single || !live, "Open"),
      {
        id: "offline",
        label: "Available offline",
        icon: "download",
        disabled: !live || !navigator.onLine,
        action: () => {
          notify("Preparing selected work for this device…");
          void (async () => {
            for (const item of items)
              await pinOffline(session.user.id, item.id);
            notify(
              "Selected work is available offline. Manage downloads in Settings → Offline research.",
            );
          })().catch((e) => notify(e.message));
        },
      },
      ...(single && first.kind !== "folder"
        ? [item("split", "Open beside")]
        : []),
      ...(single && first.kind === "folder"
        ? newItems({ spaceId: first.space_id, parentId: first.id })
        : []),
      item(
        "rename",
        single ? "Rename…" : "Rename selected…",
        !edit,
        "Organize",
        "F2",
      ),
      item("copy", "Copy", !live, undefined, keys("C")),
      item("cut", "Cut", !live || !edit, undefined, keys("X")),
      item("move", "Move to…", !edit),
      item("copyTo", "Copy to…", !live),
      item(
        "transfer",
        "Move to workspace…",
        !edit || !spaces.find((s) => s.id === first.space_id)?.can_manage,
      ),
      item("duplicate", "Duplicate", !live || !edit),
      ...(single && first.kind !== "shortcut"
        ? [
            {
              label: "Create shortcut…",
              id: "shortcut",
              icon: "shortcut" as const,
              disabled: !edit,
              hidden: !edit,
              action: () => setModal({ kind: "shortcut", item: first }),
            },
          ]
        : []),
      ...(items.every((r) => r.kind === "folder")
        ? [
            {
              label: "Folder color…",
              id: "folder-color",
              hidden: !edit,
              icon: "palette" as const,
              action: () => setModal({ kind: "color", items }),
            },
          ]
        : []),
      item(
        "favorite",
        first.favorite ? "Remove from favorites" : "Add to favorites",
        false,
        "Access",
      ),
      item("link", "Copy link", !single),
      item(
        "export",
        "Download / export…",
        !live || !items.every((r) => r.space_id === first.space_id),
      ),
      ...(single && first.kind === "file"
        ? [item("versions", "Version history…")]
        : []),
      item("properties", "Properties…", !single),
      item(
        "trash",
        `Move ${single ? "to trash" : `${items.length} items to trash`}…`,
        !edit,
        "Recovery",
        "Delete",
      ),
    ];
    const category = (
      label: string,
      icon: ActionIconName,
      ids: string[],
    ): ContextAction => ({
      id: `resource:${label}`,
      label,
      icon,
      action: () => {},
      children: actions.filter((action) => ids.includes(action.id ?? "")),
    });
    return [
      ...actions.filter((action) =>
        ["open", "split", "rename"].includes(action.id ?? ""),
      ),
      ...(single && first.kind === "folder"
        ? [
            {
              id: "resource:new",
              label: "New",
              icon: "plus" as ActionIconName,
              action: () => {},
              children: newItems({
                spaceId: first.space_id,
                parentId: first.id,
              }),
            },
          ]
        : []),
      category("Organize", "folder", [
        "cut",
        "move",
        "transfer",
        "duplicate",
        "shortcut",
        "folder-color",
        "favorite",
      ]),
      category("Copy & export", "copy", [
        "copy",
        "copyTo",
        "link",
        "export",
        "offline",
      ]),
      category("Details", "info", ["versions", "properties"]),
      ...actions.filter((action) => action.id === "trash"),
    ];
  };
  const newItems = (
    target: Target,
    createActions: ContextAction[] = [],
  ): ContextAction[] => {
    const space = spaces.find((s) => s.id === target.spaceId),
      enabled = space?.role === "editor" && space.effective_status === "active";
    return [
      ...["markdown", "canvas", "math", "image", "text"].map((id) => {
        const type = fileTypes.find((type) => type.id === id)!;
        return {
          label: `New ${type.id === "markdown" ? "note" : type.label.toLowerCase()}…`,
          icon: type.icon as ActionIconName,
          group: "Create",
          disabled: !enabled,
          hidden: !enabled,
          action: () => setModal({ kind: "newFile", type: type.id, target }),
        };
      }),
      {
        label: "New folder…",
        group: "Folders & uploads",
        icon: "newFolder",
        disabled: !enabled,
        hidden: !enabled,
        action: () =>
          setModal({ kind: "create", resourceKind: "folder", target }),
      },
      {
        label: "Upload files…",
        icon: "upload",
        disabled: !enabled,
        hidden: !enabled,
        action: () => {
          uploadTarget.current = target;
          fileInput.current?.click();
        },
      },
      ...["Text & data", "Office"].map((group) => ({
        label: group === "Research" ? "Research file" : group,
        icon: (group === "Research"
          ? "canvas"
          : group === "Office"
            ? "file"
            : "source") as ActionIconName,
        disabled: !enabled,
        hidden: !enabled,
        action: () => {},
        children: fileTypes
          .filter(
            (t) =>
              t.group === group &&
              !["markdown", "canvas", "math", "image", "text"].includes(t.id),
          )
          .map((type) => ({
            label: type.label,
            icon: type.icon as ActionIconName,
            action: () => setModal({ kind: "newFile", type: type.id, target }),
          })),
      })),
      ...createActions,
      {
        label: "Paste",
        icon: "paste",
        shortcut: keys("V"),
        disabled: !enabled || !clipboard?.items.length,
        group: "Clipboard",
        action: () =>
          clipboard &&
          setModal({
            kind: "files",
            command: clipboard.cut ? "move" : "copy",
            items: clipboard.items,
            target,
          }),
      },
    ];
  };
  const workspaceItems = (space: Space): ContextAction[] => [
    {
      label: "Open workspace",
      icon: "open",
      disabled: ["trashed", "purging"].includes(space.effective_status),
      action: () => navigate(`/workspaces/${space.id}`),
    },
    {
      id: "workspace:new",
      label: "New",
      icon: "newFolder",
      action: () => {},
      children: newItems({ spaceId: space.id, parentId: null }),
      hidden: space.role !== "editor" || space.effective_status !== "active",
    },
    ...(space.kind !== "personal"
      ? [
          {
            label: "Rename workspace…",
            icon: "rename" as const,
            disabled: !space.can_manage || space.effective_status !== "active",
            hidden: !space.can_manage || space.effective_status !== "active",
            group: "Workspace",
            action: () => setModal({ kind: "renameSpace", space }),
          },
          {
            icon: "users" as const,
            label: space.can_manage
              ? space.project_id
                ? "Workspace members and settings…"
                : "Members and invitations…"
              : "Workspace members…",
            action: () =>
              navigate(
                space.can_manage
                  ? space.project_id
                    ? `/workspaces/${space.id}/settings/people`
                    : `/admin/${space.group_id}/members`
                  : `/people?groupId=${space.group_id}`,
              ),
          },
        ]
      : []),
    {
      label: "Storage settings…",
      icon: "storage",
      group: "Workspace",
      action: () => navigate(`/settings/storage?space=${space.id}`),
    },
    ...(space.lifecycle_actions ?? []).map((action) => ({
      id: action,
      icon: lifecycleIcons[action],
      label: {
        archive: "Archive workspace…",
        unarchive: "Unarchive workspace",
        trash: "Move workspace to trash…",
        restore:
          space.status === "purging"
            ? "Cancel permanent deletion…"
            : "Restore workspace",
        purge: "Delete workspace permanently…",
      }[action],
      tone: ["trash", "purge"].includes(action)
        ? ("danger" as const)
        : undefined,
      group: "Lifecycle",
      action: () => setModal({ kind: "lifecycle", space, action }),
    })),
    ...(space.kind === "team"
      ? [
          space.group_role === "owner"
            ? {
                label: "Transfer ownership…",
                icon: "owner" as const,
                group: "Membership",
                action: () => navigate(`/admin/${space.group_id}`),
              }
            : {
                label: "Leave workspace…",
                icon: "leave" as const,
                group: "Membership",
                tone: "danger" as const,
                action: () => setModal({ kind: "leave", space }),
              },
        ]
      : []),
    {
      label: "Manage workspace",
      icon: "settings",
      group: "All workspaces",
      action: () => navigate(`/workspaces/${space.id}/settings/general`),
    },
  ];
  const management: Management = {
    execute,
    fileActivity: () => navigate("/audit?view=operations"),
    beginDrag: (event, items) => {
      dragged.current = items.filter((r) => !r.deleted_at);
      event.dataTransfer.setData(
        "application/x-axiom-resources",
        dragged.current.map((r) => r.id).join(","),
      );
      event.dataTransfer.effectAllowed = "copyMove";
    },
    dragOver: (event, target, hover) => {
      const space = liveSpaces.current.find((s) => s.id === target.spaceId);
      if (
        space?.role !== "editor" ||
        space.effective_status !== "active" ||
        dragged.current.some((r) => r.id === target.parentId) ||
        !(dragged.current.length || event.dataTransfer.types.includes("Files"))
      ) {
        event.dataTransfer.dropEffect = "none";
        clearDrag();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect =
        event.altKey || !dragged.current.length ? "copy" : "move";
      event.currentTarget.dataset.dropTarget = "true";
      const box = event.currentTarget.closest<HTMLElement>(
        ".ws-sidebar-scroll,.ws-explorer-main",
      );
      if (box) {
        const rect = box.getBoundingClientRect();
        if (event.clientY < rect.top + 45) box.scrollBy(0, -18);
        else if (event.clientY > rect.bottom - 45) box.scrollBy(0, 18);
      }
      const key = target.spaceId + target.parentId;
      if (hover && hoverDrop.current?.key !== key) {
        if (hoverDrop.current) clearTimeout(hoverDrop.current.timer);
        hoverDrop.current = { key, timer: setTimeout(hover, 750) };
      }
    },
    dragLeave: (event) => {
      if (
        event.relatedTarget instanceof Node &&
        event.currentTarget.contains(event.relatedTarget)
      )
        return;
      event.currentTarget.removeAttribute("data-drop-target");
      if (hoverDrop.current) clearTimeout(hoverDrop.current.timer);
      hoverDrop.current = null;
    },
    drop: (event, target) => {
      clearDrag();
      const space = liveSpaces.current.find((s) => s.id === target.spaceId);
      if (space?.role !== "editor" || space.effective_status !== "active")
        return;
      if (dragged.current.length) {
        event.preventDefault();
        event.stopPropagation();
        const items = dragged.current;
        dragged.current = [];
        if (items.some((r) => r.id === target.parentId)) {
          notify("An item cannot be moved into itself.");
          return;
        }
        setModal({
          kind: "files",
          command: event.altKey ? "copy" : "move",
          items,
          target,
        });
      } else if (event.dataTransfer.files.length) {
        event.preventDefault();
        event.stopPropagation();
        const files = droppedFiles(event.dataTransfer);
        report(async () => {
          upload(await files, target.spaceId, target.parentId);
        });
      }
    },
    manage: () => navigate("/workspaces"),
    resourceMenu: (event, items, options) =>
      place(
        event,
        resourceItems(items, options),
        items.length === 1
          ? `Actions for ${items[0].name}`
          : `Actions for ${items.length} items`,
      ),
    workspaceMenu: (event, space) =>
      place(
        event,
        workspaceItems(space),
        `Workspace actions for ${space.name}`,
      ),
    createMenu: (event, target) =>
      place(event, newItems(target), "Create a file"),
    backgroundMenu: (event, target) =>
      place(
        event,
        [
          ...(target ? newItems(target) : []),
          {
            label: "Manage workspaces…",
            icon: "settings",
            action: () => navigate("/workspaces"),
          },
        ],
        "Explorer actions",
      ),
    resourceKey: (event, items, options, target) => {
      if (
        (event.target as Element).closest(
          'input,textarea,select,[contenteditable="true"],dialog',
        )
      )
        return;
      const mod = event.metaKey || event.ctrlKey,
        key = event.key.toLowerCase();
      if (
        event.key === "ContextMenu" ||
        (event.shiftKey && event.key === "F10")
      ) {
        management.resourceMenu(event, items, options);
        return;
      }
      let command: ResourceCommand | undefined;
      if (event.key === "F2") command = "rename";
      else if (event.key === "Delete" || event.key === "Backspace")
        command = "trash";
      else if (mod && key === "c") command = "copy";
      else if (mod && key === "x") command = "cut";
      else if (mod && key === "v" && target && clipboard) {
        event.preventDefault();
        event.stopPropagation();
        setModal({
          kind: "files",
          command: clipboard.cut ? "move" : "copy",
          items: clipboard.items,
          target,
        });
        return;
      }
      if (command && items.length) {
        event.preventDefault();
        event.stopPropagation();
        execute(command, items, options);
      }
    },
  };
  const resourceModal = modal?.kind === "resource" ? modal.operation : null;
  const item = resourceModal?.items[0];
  const closed = () => setModal(null);
  const completed = () =>
    done(
      resourceModal?.items.map((item) => item.id),
      resourceModal?.options,
    );
  return (
    <Context.Provider value={management}>
      {children}
      {modal?.kind === "files" && (
        <FileOperationDialog
          command={modal.command}
          items={modal.items}
          target={modal.target}
          onClose={closed}
          onQueued={(id) => {
            closed();
            notify(
              `File operation queued. Follow progress or undo unchanged items in Audit → Operations. Reference: ${id.slice(0, 8)}.`,
            );
            if (clipboard?.cut) setClipboard(null);
            refresh();
          }}
        />
      )}
      {modal?.kind === "shortcut" && (
        <ShortcutDialog item={modal.item} onClose={closed} />
      )}
      {modal?.kind === "color" && (
        <Dialog
          title="Personal folder color"
          subtitle="Synced to your account. Other collaborators keep their own colors."
          onClose={closed}
        >
          <div className="folder-color-choices">
            {[null, ...folderColors].map((color) => (
              <button
                key={color ?? "default"}
                className="button secondary"
                data-folder-color={color}
                onClick={() =>
                  report(async () => {
                    for (const item of modal.items)
                      await post(`resources/${item.id}/color`, { color });
                    done();
                  })
                }
              >
                <Folder size={24} />
                {color ?? "Default"}
              </button>
            ))}
          </div>
        </Dialog>
      )}
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          const target = uploadTarget.current;
          if (target && event.target.files)
            upload(
              Array.from(event.target.files),
              target.spaceId,
              target.parentId,
            );
          event.target.value = "";
        }}
      />
      {modal?.kind === "newFile" && (
        <NewFileDialog
          type={modal.type}
          target={modal.target}
          onClose={closed}
        />
      )}
      {modal?.kind === "create" &&
        spaces.find((s) => s.id === modal.target.spaceId) && (
          <CreateResource
            kind={modal.resourceKind}
            space={spaces.find((s) => s.id === modal.target.spaceId)!}
            parentId={modal.target.parentId}
            onClose={closed}
            onCreated={(resource) => {
              done();
              if (resource.kind === "note") open(resource);
            }}
          />
        )}
      {modal?.kind === "newWorkspace" && (
        <CreateGroupDialog
          onClose={closed}
          onCreated={async (id) => {
            window.dispatchEvent(new Event("axiom:session"));
            done();
            navigate(`/admin/${id}/overview`);
          }}
        />
      )}
      {modal?.kind === "newProject" && (
        <NameDialog
          title="Create a workspace"
          label="Workspace name"
          onClose={closed}
          onSave={async (name) => {
            const project = await mutate("spaces", {
              groupId: modal.space.group_id,
              name,
              audience: "restricted",
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            });
            done();
            navigate(`/workspaces/${project.space_id}/overview`);
          }}
        />
      )}
      {modal?.kind === "renameSpace" && (
        <NameDialog
          title="Rename workspace"
          label="Workspace name"
          initial={modal.space.name}
          onClose={closed}
          onSave={async (name) => {
            await mutate(
              `spaces/${modal.space.id}`,
              { version: modal.space.version, name },
              "PATCH",
            );
            done();
          }}
        />
      )}
      {modal?.kind === "lifecycle" && (
        <LifecycleDialog
          key={modal.space.id + modal.action}
          space={modal.space}
          operation={modal.action}
          onClose={closed}
          onDone={() => {
            done();
            notify(
              modal.action === "purge"
                ? "Permanent deletion queued with a 30-second cancellation window. Check progress or cancel in Workspaces → Lifecycle."
                : "Workspace updated.",
            );
          }}
        />
      )}
      {modal?.kind === "leave" && (
        <ConfirmAction
          title="Leave this workspace?"
          description={`You will lose access to ${modal.space.name} and its projects. Your personal notes and files remain yours.`}
          label="Leave workspace"
          onClose={closed}
          onConfirm={async () => {
            await post(`group-admin/${modal.space.group_id}/leave`, {});
            done();
            navigate("/home");
          }}
        />
      )}
      {item && resourceModal?.command === "rename" && (
        <NameDialog
          title="Rename item"
          label="Name"
          initial={item.name}
          onClose={closed}
          onSave={async (name) => {
            await mutate(
              `resources/${item.id}`,
              { version: item.version, name },
              "PATCH",
            );
            completed();
          }}
        />
      )}
      {item && resourceModal?.command === "move" && (
        <MoveResource resource={item} onClose={closed} onMoved={completed} />
      )}
      {item &&
        resourceModal &&
        ["copyTo", "transfer"].includes(resourceModal.command) && (
          <TransferResource
            resource={item}
            moving={resourceModal.command === "transfer"}
            onClose={closed}
            onDone={completed}
          />
        )}
      {item && resourceModal?.command === "purge" && (
        <FileSafetyDialog
          resource={item}
          operation={null}
          onClose={closed}
          onDone={completed}
        />
      )}
      {item &&
        resourceModal &&
        ["properties", "versions"].includes(resourceModal.command) && (
          <Dialog
            title={
              resourceModal.command === "versions"
                ? "Version history"
                : "Item properties"
            }
            onClose={closed}
          >
            <div className="ws-properties-dialog">
              <ResourceInspector
                resource={item}
                initialTab={
                  resourceModal.command === "versions" ? "versions" : "details"
                }
                onClose={closed}
                onChanged={refresh}
              />
            </div>
          </Dialog>
        )}
      {item &&
        resourceModal &&
        ["trash", "restore"].includes(resourceModal.command) && (
          <BulkResourceAction
            operation={resourceModal}
            onClose={closed}
            onDone={closed}
          />
        )}
      {modal?.kind === "paste" && clipboard && (
        <PasteDialog
          target={modal.target}
          clipboard={clipboard}
          onClose={closed}
          onDone={(ids) => {
            if (clipboard.cut)
              setClipboard((previous) =>
                previous
                  ? {
                      ...previous,
                      items: previous.items.filter(
                        (item) => !ids.includes(item.id),
                      ),
                    }
                  : null,
              );
            done();
          }}
        />
      )}
    </Context.Provider>
  );
}

function ConfirmAction({
  title,
  description,
  label,
  onClose,
  onConfirm,
}: {
  title: string;
  description: string;
  label: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const action = useAction();
  return (
    <Dialog
      title={title}
      onClose={() => !action.busy && onClose()}
      size="compact"
    >
      <p>{description}</p>
      <ErrorNotice message={action.error} />
      <div className="dialog-footer">
        <button
          className="button secondary"
          disabled={action.busy}
          onClick={onClose}
        >
          Cancel
        </button>
        <button
          className="button danger"
          disabled={action.busy}
          onClick={() => void action.run(onConfirm)}
        >
          {action.busy ? "Working…" : label}
        </button>
      </div>
    </Dialog>
  );
}
function BulkResourceAction({
  operation,
  onClose,
  onDone,
}: {
  operation: ResourceOperation;
  onClose: () => void;
  onDone: () => void;
}) {
  const { refresh, notify } = useWorkspace();
  const [remaining, setRemaining] = useState(operation.items),
    action = useAction();
  const restoring = operation.command === "restore";
  return (
    <Dialog
      title={`${restoring ? "Restore" : "Move to trash"}: ${remaining.length} item${remaining.length === 1 ? "" : "s"}`}
      onClose={() => !action.busy && onClose()}
    >
      <p>
        {restoring
          ? "These items will return to their original folders where possible."
          : "Selected items and nested contents remain recoverable in Trash."}
      </p>
      <ul className="ws-operation-items">
        {remaining.map((item) => (
          <li key={item.id}>{item.name}</li>
        ))}
      </ul>
      <ErrorNotice message={action.error} />
      <div className="dialog-footer">
        <button
          className="button secondary"
          disabled={action.busy}
          onClick={onClose}
        >
          Cancel
        </button>
        <button
          className={`button ${restoring ? "primary" : "danger"}`}
          disabled={action.busy}
          onClick={() =>
            void action.run(async () => {
              const done: string[] = [],
                failed: Resource[] = [],
                errors: string[] = [];
              for (const item of remaining)
                try {
                  await mutate(
                    `resources/${item.id}/${restoring ? "restore" : "trash"}`,
                    { version: item.version },
                  );
                  done.push(item.id);
                } catch (error) {
                  failed.push(item);
                  errors.push(
                    `${item.name}: ${error instanceof Error ? error.message : "Failed"}`,
                  );
                }
              refresh();
              operation.options.completed?.(done);
              setRemaining(failed);
              notify(
                `${done.length} item${done.length === 1 ? "" : "s"} ${restoring ? "restored" : "moved to trash"}.`,
              );
              if (errors.length) throw new Error(errors.join(" · "));
              onDone();
            })
          }
        >
          {action.busy
            ? "Working…"
            : restoring
              ? "Restore items"
              : "Move to trash"}
        </button>
      </div>
    </Dialog>
  );
}
function PasteDialog({
  target,
  clipboard,
  onClose,
  onDone,
}: {
  target: Target;
  clipboard: { cut: boolean; items: Resource[] };
  onClose: () => void;
  onDone: (ids: string[]) => void;
}) {
  const { spaces, refresh } = useWorkspace(),
    action = useAction();
  const [confirmed, setConfirmed] = useState(false),
    [remaining, setRemaining] = useState(clipboard.items),
    completed = useRef<string[]>([]);
  const crossing = remaining.some((item) => item.space_id !== target.spaceId),
    destination = spaces.find((space) => space.id === target.spaceId);
  const close = () => {
    if (action.busy) return;
    if (completed.current.length) onDone(completed.current);
    else onClose();
  };
  return (
    <Dialog
      title={`${clipboard.cut ? "Move" : "Copy"} ${remaining.length} item${remaining.length === 1 ? "" : "s"}`}
      onClose={close}
    >
      <p>
        Destination: <strong>{destination?.name ?? "Workspace"}</strong>
        {target.parentId ? " · selected folder" : " · root folder"}
      </p>
      <ul className="ws-operation-items">
        {remaining.map((item) => (
          <li key={item.id}>{item.name}</li>
        ))}
      </ul>
      {crossing && (
        <label className="ws-checkbox ws-note">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          <span>
            I understand that these items and their linked evidence will use the
            destination workspace’s permissions.{" "}
            {clipboard.cut
              ? "Existing links will follow the new permissions."
              : "Original permissions will not change."}
          </span>
        </label>
      )}
      <ErrorNotice message={action.error} />
      <div className="dialog-footer">
        <button
          className="button secondary"
          disabled={action.busy}
          onClick={close}
        >
          Cancel
        </button>
        <button
          className="button primary"
          disabled={
            action.busy ||
            !destination ||
            destination.role !== "editor" ||
            destination.effective_status !== "active" ||
            (crossing && !confirmed)
          }
          onClick={() =>
            void action.run(async () => {
              const failed: Resource[] = [],
                errors: string[] = [];
              for (const item of remaining)
                try {
                  if (clipboard.cut && item.space_id === target.spaceId)
                    await mutate(
                      `resources/${item.id}`,
                      { version: item.version, parentId: target.parentId },
                      "PATCH",
                    );
                  else
                    await mutate(
                      `resources/${item.id}/${clipboard.cut ? "transfer" : "copy"}`,
                      {
                        version: item.version,
                        destinationSpaceId: target.spaceId,
                        parentId: target.parentId,
                        confirmAudience: confirmed,
                      },
                    );
                  completed.current.push(item.id);
                } catch (error) {
                  failed.push(item);
                  errors.push(
                    `${item.name}: ${error instanceof Error ? error.message : "Failed"}`,
                  );
                }
              refresh();
              setRemaining(failed);
              if (errors.length) throw new Error(errors.join(" · "));
              onDone(completed.current);
            })
          }
        >
          {action.busy ? "Working…" : clipboard.cut ? "Move here" : "Copy here"}
        </button>
      </div>
    </Dialog>
  );
}
export function LifecycleDialog({
  space,
  operation,
  onClose,
  onDone,
}: {
  space: Space;
  operation: SpaceLifecycleAction;
  onClose: () => void;
  onDone: () => void;
}) {
  const action = useAction(),
    data = useData<{
      counts: Record<string, number>;
      blockers: { label: string; count: number }[];
      job?: { status: string; error?: string };
    }>(`spaces/${space.id}/lifecycle`);
  const [confirmation, setConfirmation] = useState("");
  const destructive = operation === "trash" || operation === "purge",
    purge = operation === "purge";
  const title = {
    archive: "Archive workspace",
    unarchive: "Unarchive workspace",
    trash: "Move workspace to trash",
    restore:
      space.status === "purging"
        ? "Cancel permanent deletion"
        : "Restore workspace",
    purge: "Delete workspace permanently",
  }[operation];
  return (
    <Dialog title={title} onClose={() => !action.busy && onClose()}>
      <p>
        <strong>{space.name}</strong>
        {space.kind === "team" ? " and its projects" : ""}
      </p>
      <p>
        {operation === "archive"
          ? "Members can continue reading and exporting. Editing, uploads, invitations, and scheduled work pause until restored."
          : operation === "trash"
            ? "Content will disappear from normal navigation and collaboration. It remains recoverable indefinitely; nothing is permanently removed."
            : purge
              ? "This removes the workspace, its owned contents, and eligible stored versions. Personal work and files owned elsewhere remain untouched. Retained research evidence can block removal."
              : "Existing permissions and independently archived projects or trashed items are preserved."}
      </p>
      {data.data && (
        <div className="ws-impact-summary">
          <span>{data.data.counts.projects} projects</span>
          <span>{data.data.counts.notes} notes</span>
          <span>{data.data.counts.files} files</span>
          <span>{bytes(data.data.counts.bytes)} stored</span>
        </div>
      )}
      {data.data?.job?.error && (
        <p className="ws-note">Last removal attempt: {data.data.job.error}</p>
      )}
      {purge && !!data.data?.blockers.length && (
        <div className="ws-note">
          <strong>
            Keep this workspace recoverable until these are resolved:
          </strong>
          <ul>
            {data.data.blockers.map((item) => (
              <li key={item.label}>
                {item.label}: {item.count}
              </li>
            ))}
          </ul>
        </div>
      )}
      {destructive && (
        <label>
          Type {space.name} to confirm
          <input
            autoComplete="off"
            spellCheck={false}
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </label>
      )}
      <ErrorNotice
        message={action.error || data.error}
        retry={data.error ? data.reload : undefined}
      />
      <div className="dialog-footer">
        <button
          className="button secondary"
          disabled={action.busy}
          onClick={onClose}
        >
          Cancel
        </button>
        <button
          className={`button ${destructive ? "danger" : "primary"}`}
          disabled={
            action.busy ||
            !data.data ||
            (destructive && confirmation !== space.name) ||
            (purge && !!data.data?.blockers.length)
          }
          onClick={() =>
            void action.run(async () => {
              await mutate(`spaces/${space.id}/${operation}`, {
                version: space.version,
                confirmation,
              });
              onDone();
            })
          }
        >
          {action.busy ? "Working…" : title}
        </button>
      </div>
    </Dialog>
  );
}
