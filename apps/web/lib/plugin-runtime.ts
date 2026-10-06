"use client";
import {
  pluginInputValuesSchema,
  pluginLimits,
  pluginPermissionActive,
  pluginMethods,
  validatePluginPanel,
  type PluginContext,
  type PluginManifest,
  type PluginMethod,
  type PluginPanel,
} from "@axiom/shared/plugins";
import { api } from "./client";
import { decodePluginMessage } from "@axiom/shared/plugin-transport";

export type PluginRuntimeStart = {
  bundle: string;
  manifest: PluginManifest;
  grantId: string;
  grantRevision: number;
  packageHash: string;
  expiresAt: string;
  context: PluginContext;
};
export type PluginRuntimeOptions = {
  onPanel: (panel: PluginPanel) => void;
  onState: (
    state: "loading" | "running" | "idle" | "stopped" | "error",
    message?: string,
  ) => void;
};
/** Lazy, one-workspace runtime. No eval/import of package code in the app. */
export class PluginRuntime {
  private frame: HTMLIFrameElement;
  private port: MessagePort | null = null;
  private abort = new AbortController();
  private disposed = false;
  private loaded = false;
  private busy = true;
  private nonce = crypto.randomUUID();
  private inFlight = new Set<number>();
  private seen = new Set<number>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private expiryTimer: ReturnType<typeof setTimeout> | undefined;
  private ready: (event: MessageEvent) => void;
  constructor(
    readonly start: PluginRuntimeStart,
    private options: PluginRuntimeOptions,
  ) {
    options.onState("loading");
    this.frame = document.createElement("iframe");
    this.frame.className = "plugin-sandbox-frame";
    this.frame.setAttribute("sandbox", "allow-scripts");
    this.frame.setAttribute("aria-hidden", "true");
    this.frame.tabIndex = -1;
    this.frame.title = "Isolated extension worker";
    this.frame.referrerPolicy = "no-referrer";
    this.ready = (event) => {
      if (
        this.disposed ||
        this.port ||
        event.source !== this.frame.contentWindow ||
        event.origin !== "null" ||
        event.data?.type !== "axiom-plugin-ready" ||
        event.data?.nonce !== this.nonce
      )
        return;
      const channel = new MessageChannel();
      this.port = channel.port1;
      this.port.onmessage = (e) => void this.receive(e.data);
      this.port.onmessageerror = () =>
        this.fail("Extension sent an invalid message.");
      this.port.start();
      this.frame.contentWindow!.postMessage(
        { type: "axiom-plugin-connect", nonce: this.nonce },
        "*",
        [channel.port2],
      );
      window.removeEventListener("message", this.ready);
    };
    window.addEventListener("message", this.ready);
    this.frame.src = "/plugin-sandbox?nonce=" + this.nonce;
    document.body.append(this.frame);
    this.expiryDeadline();
    this.deadline();
  }
  private deadline() {
    clearTimeout(this.timer);
    if (this.disposed) return;
    this.timer = setTimeout(
      () =>
        this.fail(
          "Extension timed out. Your editor and saved files were not changed.",
        ),
      20000,
    );
  }
  private expiryDeadline() {
    if (this.disposed || !this.permissionActive()) return;
    const remaining = new Date(this.start.expiresAt).valueOf() - Date.now();
    this.expiryTimer = setTimeout(
      () => this.expiryDeadline(),
      Math.min(remaining, 2_147_483_647),
    );
  }
  private permissionActive() {
    if (pluginPermissionActive(this.start.expiresAt)) return true;
    if (!this.disposed)
      this.fail(
        "Extension permissions expired. Renew access, then restart explicitly. Your files and drafts remain available.",
      );
    return false;
  }
  private reply(id: number, result: unknown, error?: string) {
    if (!this.disposed)
      this.port?.postMessage({ type: "response", id, result, error });
  }
  private async receive(raw: unknown) {
    if (this.disposed || !this.permissionActive()) return;
    let value: any;
    try {
      value = decodePluginMessage(raw);
      if (!value || typeof value !== "object")
        throw new Error("Invalid extension message.");
      if (value.type === "heartbeat") return;
      if (value.type === "connected") {
        this.port!.postMessage({
          type: "init",
          bundle: this.start.bundle,
          context: this.start.context,
        });
        return;
      }
      if (value.type === "loaded") {
        if (this.loaded) throw new Error("Unexpected extension activation.");
        this.loaded = true;
        this.busy = false;
        this.run(this.start.context.command, {});
        return;
      }
      if (value.type === "done") {
        this.busy = false;
        clearTimeout(this.timer);
        this.options.onState("idle");
        return;
      }
      if (value.type === "error") {
        this.fail(
          typeof value.message === "string"
            ? value.message.slice(0, 2000)
            : "Extension failed.",
        );
        return;
      }
      if (
        !["call", "render"].includes(value.type) ||
        !Number.isSafeInteger(value.id) ||
        value.id < 1 ||
        this.seen.has(value.id)
      )
        throw new Error("Invalid or repeated extension request.");
      if (
        this.inFlight.size >= pluginLimits.concurrentCalls ||
        this.seen.size >= 1000
      )
        throw new Error("Extension request budget exceeded.");
      this.seen.add(value.id);
      this.inFlight.add(value.id);
      if (value.type === "render") {
        // Host-native UI only, with its own app ownership chrome.
        this.options.onPanel(
          validatePluginPanel(value.panel, this.start.manifest),
        );
        this.reply(value.id, null);
        return;
      }
      if (
        !(pluginMethods as readonly unknown[]).includes(value.method) ||
        !value.args ||
        typeof value.args !== "object" ||
        Array.isArray(value.args)
      )
        throw new Error("Undeclared extension method.");
      const result = await this.request(value.method, value.args);
      this.reply(value.id, result);
    } catch (error) {
      if (this.disposed) return;
      if (Number.isSafeInteger(value?.id))
        this.reply(
          value.id,
          null,
          error instanceof Error ? error.message : "Extension request failed.",
        );
      else
        this.fail(
          error instanceof Error ? error.message : "Extension request failed.",
        );
    } finally {
      if (value?.id) this.inFlight.delete(value.id);
    }
  }
  async request<T = unknown>(
    method: PluginMethod,
    args: Record<string, unknown> = {},
  ) {
    if (this.disposed) throw new Error("Extension is stopped.");
    if (!this.permissionActive())
      throw new Error("Extension permissions expired.");
    return api<T>("plugins/rpc", {
      method: "POST",
      signal: this.abort.signal,
      body: JSON.stringify({ ...this.authority(), method, args }),
    });
  }
  authority() {
    return {
      grantId: this.start.grantId,
      grantRevision: this.start.grantRevision,
      packageHash: this.start.packageHash,
    };
  }
  async validate() {
    await api("plugins/runtime/validate", {
      method: "POST",
      signal: this.abort.signal,
      body: JSON.stringify(this.authority()),
    });
  }
  run(command: string, inputs: Record<string, string | number | boolean>) {
    if (!this.permissionActive())
      throw new Error("Extension permissions expired.");
    if (this.disposed || !this.loaded || this.busy)
      throw new Error("Wait for the current extension command to finish.");
    if (!this.start.manifest.commands.some((c) => c.id === command))
      throw new Error("Undeclared extension command.");
    const values = pluginInputValuesSchema.parse(inputs);
    this.busy = true;
    this.deadline();
    this.options.onState("running");
    this.port!.postMessage({
      type: "run",
      context: { ...this.start.context, command, inputs: values },
    });
  }
  private fail(message: string) {
    this.dispose();
    this.options.onState("error", message);
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.busy = false;
    clearTimeout(this.timer);
    clearTimeout(this.expiryTimer);
    this.abort.abort();
    window.removeEventListener("message", this.ready);
    this.port?.postMessage({ type: "stop" });
    this.port?.close();
    this.port = null;
    this.frame.remove();
    this.inFlight.clear();
    this.options.onState("stopped");
  }
}
