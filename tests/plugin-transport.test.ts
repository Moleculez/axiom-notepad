import { describe, expect, it } from "vitest";
import { createContext, runInContext } from "node:vm";
import {
  decodePluginMessage,
  pluginTransportSource,
} from "../packages/shared/src/plugin-transport";
import { pluginLimits } from "../packages/shared/src/plugins";
import { pluginSandboxDocument } from "../packages/shared/src/plugin-sandbox";

function relay(limits: Record<string, number> = {}) {
  let now = 0;
  const context = createContext({
    TextEncoder,
    performance: { now: () => now },
    limits: { ...pluginLimits, ...limits },
    input: "",
  });
  runInContext(
    pluginTransportSource + ";const transport=createTransport(limits);",
    context,
  );
  return {
    send(value: unknown, worker = true) {
      context.input = JSON.stringify(value);
      return runInContext(
        `transport.serialize(JSON.parse(input),${worker})`,
        context,
      ) as string;
    },
    raw(expression: string) {
      return runInContext(expression, context);
    },
    advance(ms: number) {
      now += ms;
    },
    reset() {
      runInContext("transport.reset()", context);
    },
  };
}
describe("trusted extension relay", () => {
  it("serializes bounded JSON before the native app receives it and supports optional context fields", () => {
    const r = relay(),
      wire = r.send({
        type: "call",
        id: 1,
        method: "documents.read",
        args: {},
      });
    expect(decodePluginMessage(wire)).toMatchObject({ type: "call", id: 1 });
    expect(
      r.raw(
        "transport.serialize({type:'init',context:{resourceId:undefined}},false)",
      ),
    ).toBe('{"type":"init","context":{}}');
    expect(() => decodePluginMessage({ type: "render" })).toThrow(/relay/);
    expect(() => decodePluginMessage("[]")).toThrow(/invalid/);
    expect(() => decodePluginMessage("null")).toThrow(/invalid/);
    expect(() => decodePluginMessage("{")).toThrow();
  });
  it("rejects excessive depth, cycles, accessors, prototypes, functions and unsafe keys before stringify", () => {
    for (const expression of [
      "(()=>{let a={};a.self=a;return a;})()",
      "new Date()",
      "new Uint8Array(10)",
      "{get type(){throw new Error('getter must not run');}}",
      "{type:'heartbeat',callback:()=>1}",
      "JSON.parse('{\"__proto__\":{}}')",
      "{type:'heartbeat',number:NaN}",
    ])
      expect(() =>
        relay().raw(`transport.serialize(${expression},true)`),
      ).toThrow(/cyclic|plain JSON|accessors|JSON values|Unsafe|finite/);
    let value: unknown = { type: "heartbeat" };
    for (let i = 0; i < 34; i++) value = { nested: value };
    expect(() => relay().send(value)).toThrow(/structure/);
    expect(() =>
      relay({ protocolNodes: 12 }).send({
        type: "render",
        id: 1,
        panel: Array(15).fill(1),
      }),
    ).toThrow(/structure/);
    expect(() =>
      relay().raw(
        "transport.serialize({type:'render',id:1,panel:new Array(1000000000)},true)",
      ),
    ).toThrow(/array/);
    // Aliased objects are JSON-safe, unlike ancestor cycles.
    expect(
      relay().raw(
        "(()=>{const a={x:1};return transport.serialize({type:'init',a,b:a},false);})()",
      ),
    ).toContain('"b":{"x":1}');
  });
  it("bounds both message bytes and aggregate transfers across responses and renders", () => {
    const r = relay({ messageBytes: 200, commandTransferBytes: 250 });
    r.send({ type: "error", message: "a".repeat(90) });
    expect(() =>
      r.send({ type: "error", message: "a".repeat(90) }),
    ).not.toThrow();
    expect(() => r.send({ type: "loaded" })).toThrow(/transfer budget/);
    r.reset();
    expect(() => r.send({ type: "loaded" })).not.toThrow();
    expect(() =>
      relay({ messageBytes: 100 }).send({
        type: "error",
        message: "x".repeat(101),
      }),
    ).toThrow(/too large/);
    expect(() =>
      relay({ messageBytes: 100 }).send({
        type: "error",
        message: "界".repeat(30),
      }),
    ).toThrow(/too large/);
    expect(() =>
      relay({ messageBytes: 100 }).send({
        type: "error",
        message: "\u0001".repeat(30),
      }),
    ).toThrow(/too large/);
  });
  it("keeps idle health checks rate-bounded without consuming the command budget or accepting hidden payloads", () => {
    const r = relay({ commandTransferBytes: 40 });
    r.send({ type: "loaded" });
    for (let i = 0; i < 3000; i++) {
      r.send({ type: "heartbeat" });
      r.advance(1000);
    }
    r.send({ type: "loaded" });
    expect(() => r.send({ type: "loaded" })).toThrow(/transfer budget/);
    expect(() =>
      relay().send({ type: "heartbeat", payload: "hidden" }),
    ).toThrow(/cannot contain payloads/);
    expect(() =>
      relay().raw(
        "(()=>{const a=[];a.type='heartbeat';return transport.serialize(a,true);})()",
      ),
    ).toThrow(/cannot contain payloads/);
  });
  it("fences in-flight calls, duplicate requests and message floods without resetting those fences per command", () => {
    const r = relay();
    for (let id = 1; id <= 8; id++) r.send({ type: "call", id, args: {} });
    expect(() => r.send({ type: "render", id: 9 })).toThrow(/concurrent/);
    r.send({ type: "response", id: 1, result: null }, false);
    r.send({ type: "call", id: 9, args: {} });
    r.reset();
    expect(() => r.send({ type: "call", id: 1, args: {} })).toThrow(/repeated/);
    const flood = relay();
    for (let i = 0; i < 100; i++) flood.send({ type: "heartbeat" });
    expect(() => flood.send({ type: "heartbeat" })).toThrow(/rate exceeded/);
    flood.advance(1000);
    expect(() => flood.send({ type: "heartbeat" })).not.toThrow();
    flood.reset();
    expect(() => flood.send({ type: "unexpected" })).toThrow(
      /Invalid extension protocol/,
    );
  });
  it("retains lifetime request identities and fails after 1,000 calls even when all replies finish", () => {
    const r = relay();
    for (let id = 1; id <= 1000; id++) {
      r.send({ type: "call", id, args: {} });
      r.send({ type: "response", id }, false);
      r.advance(25);
    }
    r.reset();
    expect(() => r.send({ type: "call", id: 1001, args: {} })).toThrow(
      /lifetime/,
    );
  });
  it("embeds the checks in the trusted frame instead of relying on untrusted worker code", () => {
    const frame = pluginSandboxDocument(
      "fixture-nonce",
      "http://localhost:3004",
      "test-script-nonce",
    );
    expect(frame).toContain("transport.serialize(e.data,true)");
    expect(frame).toContain("port.postMessage(wire)");
    expect(frame).toContain("worker?.terminate()");
    expect(frame).toContain("transport.reset()");
  });
});
