import { beforeEach, describe, expect, it, vi } from "vitest";
import { query, transaction } from "../packages/shared/src/db";
import {
  APPEARANCE_SCHEMA,
  APPEARANCE_SCHEMA_HEADER,
  defaults,
} from "../packages/shared/src/appearance";
import { editorDefaults } from "../packages/shared/src/editor";
import { preferencesApi } from "../packages/shared/src/preferences-api";
import { preferencesBundleApi } from "../packages/shared/src/preferences-bundle-api";

vi.mock("../packages/shared/src/db", () => ({
  query: vi.fn(),
  transaction: vi.fn(),
}));
const mockQuery = vi.mocked(query);
const mockTransaction = vi.mocked(transaction);
beforeEach(() => {
  mockQuery.mockReset();
  mockTransaction.mockReset();
});

describe("appearance schema write boundary", () => {
  it.each([10, 11])(
    "refuses a schema %i appearance writer before database access",
    async (schemaVersion) => {
      const response = await preferencesApi(
        new Request("http://localhost", {
          method: "PATCH",
          body: JSON.stringify({
            preferences: { ...defaults, schemaVersion },
            version: 1,
            mutationId: "00000000-0000-4000-8000-000000000001",
          }),
        }),
        "fixture-account",
      );
      expect(response.status).toBe(426);
      expect(mockQuery).not.toHaveBeenCalled();
      expect(mockTransaction).not.toHaveBeenCalled();
    },
  );
  it.each([10, 11])(
    "refuses a schema %i bundle writer before database access",
    async (schemaVersion) => {
      const response = await preferencesBundleApi(
        new Request("http://localhost", {
          method: "PATCH",
          body: JSON.stringify({
            appearance: {
              preferences: { ...defaults, schemaVersion },
              version: 1,
            },
            editor: { preferences: editorDefaults, version: 1 },
            mutationId: "00000000-0000-4000-8000-000000000001",
          }),
        }),
        "fixture-account",
      );
      expect(response.status).toBe(426);
      expect(mockQuery).not.toHaveBeenCalled();
      expect(mockTransaction).not.toHaveBeenCalled();
    },
  );
  it("upgrades old stored records and returns safe v11 aliases without mutating storage", async () => {
    const saved = {
      preferences: { ...defaults, schemaVersion: 11, interfaceStyle: "macos" },
      previousPreferences: {
        ...defaults,
        schemaVersion: 10,
        interfaceStyle: "material",
      },
      version: 3,
    };
    mockQuery.mockResolvedValue([saved]);
    const current = await preferencesApi(
      new Request("http://localhost", {
        headers: { [APPEARANCE_SCHEMA_HEADER]: String(APPEARANCE_SCHEMA) },
      }),
      "fixture-account",
    );
    expect(await current.json()).toMatchObject({
      preferences: { schemaVersion: 12, interfaceStyle: "harbor" },
      previousPreferences: { schemaVersion: 12, interfaceStyle: "contour" },
    });
    const old = await preferencesApi(
      new Request("http://localhost", {
        headers: { [APPEARANCE_SCHEMA_HEADER]: "11" },
      }),
      "fixture-account",
    );
    expect(await old.json()).toMatchObject({
      ...saved,
      previousPreferences: { ...saved.previousPreferences, schemaVersion: 11 },
    });
    for (const [statement] of mockQuery.mock.calls)
      expect(statement).toMatch(/^SELECT /);
  });
  it("answers upgrade-required when either the account or restore point has new features", async () => {
    for (const value of [
      { interfaceStyle: "signal" },
      { themePack: "spectrum" },
    ]) {
      mockQuery.mockResolvedValue([
        {
          preferences: defaults,
          previousPreferences: { ...defaults, ...value },
          version: 3,
        },
      ]);
      const response = await preferencesApi(
        new Request("http://localhost", {
          headers: { [APPEARANCE_SCHEMA_HEADER]: "11" },
        }),
        "fixture-account",
      );
      expect(response.status).toBe(426);
    }
  });
  it("requires canonical identities even from a current-schema writer", async () => {
    for (const interfaceStyle of ["material", "unknown-style"]) {
      await expect(
        preferencesApi(
          new Request("http://localhost", {
            method: "PATCH",
            body: JSON.stringify({
              preferences: { ...defaults, interfaceStyle },
              version: 1,
              mutationId: "00000000-0000-4000-8000-000000000001",
            }),
          }),
          "fixture-account",
        ),
      ).rejects.toThrow();
    }
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });
});
