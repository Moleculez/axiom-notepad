import { z } from "zod";
const anchorSchema = z.object({
  start: z.array(z.number().int().min(0).max(255)).max(200),
  end: z.array(z.number().int().min(0).max(255)).max(200),
  quote: z.string().max(100000),
  generation: z.number().int().positive(),
});
const bridgeSchema = z.object({
  projectId: z.uuid(),
  noteId: z.uuid(),
  noteTitle: z.string().max(500),
  anchor: anchorSchema,
  before: z.string().max(10000),
  after: z.string().max(10000),
  prefix: z.string().max(1000),
  ending: z.enum(["\n", "\r\n"]),
  result: z.string().max(30000).optional(),
});
export type MathNoteBridge = z.infer<typeof bridgeSchema>;
const prefix = (user: string) => `axiom:${user}:math-note-bridge:`;
export function storeMathBridge(user: string, bridge: MathNoteBridge) {
  sessionStorage.setItem(
    prefix(user) + bridge.projectId,
    JSON.stringify(bridgeSchema.parse(bridge)),
  );
}
export function readMathBridge(
  user: string,
  project: string,
): MathNoteBridge | null {
  try {
    const parsed = bridgeSchema.safeParse(
      JSON.parse(sessionStorage.getItem(prefix(user) + project) ?? "null"),
    );
    return parsed.success && parsed.data.projectId === project
      ? parsed.data
      : null;
  } catch {
    return null;
  }
}
export function pendingMathBridge(user: string, note: string) {
  for (let i = 0; i < sessionStorage.length; i++) {
    const key = sessionStorage.key(i)!;
    if (!key.startsWith(prefix(user))) continue;
    const bridge = readMathBridge(user, key.slice(prefix(user).length));
    if (bridge?.noteId === note && bridge.result !== undefined) return bridge;
  }
  return null;
}
export function mathBridgeReplacement(bridge: MathNoteBridge) {
  if (bridge.result === undefined)
    throw new Error("There is no equation result to apply.");
  return (
    bridge.before +
    bridge.result.replace(/\r?\n/g, bridge.ending + bridge.prefix) +
    bridge.after
  );
}
