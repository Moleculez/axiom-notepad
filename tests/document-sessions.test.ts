import { afterEach, describe, expect, it } from "vitest";
import {
  acquireDocument,
  closeDocument,
  discardDocuments,
  documentsSavedLocally,
  releaseDocument,
} from "../apps/web/lib/document-sessions";

const account = "document-session-durability-test";
const key = `${account}:document:1`;
afterEach(() => {
  discardDocuments(account);
  releaseDocument(key);
});

describe("document session durability guards", () => {
  it("allows a pristine document to close", () => {
    acquireDocument(key);
    expect(documentsSavedLocally()).toBe(true);
    expect(closeDocument(account, "document")).toBe(true);
  });

  it("retains a pending text deletion even when no visible content remains", () => {
    const session = acquireDocument(key);
    const source = session.doc.getText("markdown");
    source.insert(0, "Remove all of this");
    source.delete(0, source.length);
    expect(source.length).toBe(0);
    expect(documentsSavedLocally()).toBe(false);
    expect(closeDocument(account, "document")).toBe(false);
    session.persisted = true;
    expect(documentsSavedLocally()).toBe(true);
    expect(closeDocument(account, "document")).toBe(true);
  });

  it("retains a pending deletion of every canvas entry", () => {
    const session = acquireDocument(key);
    const canvas = session.doc.getMap("canvas");
    canvas.set("card", "Research result");
    canvas.clear();
    expect(canvas.size).toBe(0);
    expect(documentsSavedLocally()).toBe(false);
    expect(closeDocument(account, "document")).toBe(false);
  });
});
