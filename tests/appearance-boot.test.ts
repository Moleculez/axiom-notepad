import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { appearanceBootScript } from "../packages/shared/src/appearance-boot";
import {
  appearanceVariables,
  defaults,
} from "../packages/shared/src/appearance";
import {
  interfaceStyleIds,
  interfaceStyleVariables,
} from "../packages/shared/src/interface-styles";

function boot(
  cache?: Record<string, unknown>,
  {
    signedIn = true,
    signOut = false,
    systemDark = false,
    brokenStorage = false,
  } = {},
) {
  const variables: Record<string, string> = {};
  const root = {
    dataset: {} as Record<string, string>,
    style: {
      colorScheme: "",
      setProperty: (key: string, value: string) => {
        variables[key] = value;
      },
    },
  };
  const local = new Map([
    [
      "axiom:session",
      JSON.stringify(signedIn ? { user: { id: "fixture-account" } } : null),
    ],
    ["axiom:appearance", JSON.stringify(cache ?? null)],
    ["axiom:pending-signout", signOut ? "true" : ""],
  ]);
  runInNewContext(appearanceBootScript(), {
    document: { documentElement: root },
    localStorage: {
      getItem: (key: string) => {
        if (brokenStorage) throw new Error("Storage unavailable");
        return local.get(key) ?? null;
      },
    },
    matchMedia: () => ({ matches: systemDark }),
  });
  return { root, variables };
}

function cache(interfaceStyle: string) {
  return {
    userId: "fixture-account",
    mode: "light",
    themePack: "default",
    interfaceStyle,
    light: appearanceVariables(
      { ...defaults, radius: 0, uiSize: 22, shadows: "none" },
      false,
    ),
    dark: appearanceVariables(
      { ...defaults, radius: 0, uiSize: 22, shadows: "none" },
      true,
    ),
    motion: "none",
    density: "compact",
    focus: "false",
    documentDecorations: "latex",
  };
}

describe("account-scoped appearance before hydration", () => {
  it("derives every first-paint recipe from the current registry without changing user values", () => {
    for (const id of interfaceStyleIds) {
      const result = boot(cache(id));
      expect(result.root.dataset.interfaceStyle).toBe(id);
      expect(result.variables).toMatchObject(interfaceStyleVariables(id));
      expect(result.variables["--radius"]).toBe("0px");
      expect(result.variables["--shadow"]).toBe("none");
      expect(result.variables["--size-ui"]).toBe("1.375rem");
      expect(result.root.dataset).toMatchObject({
        density: "compact",
        motion: "none",
        documentDecorations: "latex",
      });
    }
  });
  it("normalizes historical cache identities before first paint and ignores stale recipe drawing", () => {
    for (const [old, id] of [
      ["material", "contour"],
      ["fluent", "vector"],
      ["editorial", "folio"],
      ["macos", "harbor"],
    ] as const) {
      const saved = cache(old);
      const result = boot({
        ...saved,
        light: { ...saved.light, ...interfaceStyleVariables("axiom") },
      });
      expect(result.root.dataset.interfaceStyle).toBe(id);
      expect(result.variables).toMatchObject(interfaceStyleVariables(id));
      expect(result.variables["--radius"]).toBe("0px");
    }
  });
  it("keeps theme packs independent of recipes and selects cached dark values", () => {
    const result = boot(
      { ...cache("cutline"), mode: "system", themePack: "botanical" },
      { systemDark: true },
    );
    expect(result.root.dataset).toMatchObject({
      theme: "dark",
      themePack: "botanical",
      interfaceStyle: "cutline",
    });
    expect(result.variables["--paper"]).toBe(
      defaults.darkColors.paper ??
        appearanceVariables(defaults, true)["--paper"],
    );
  });
  it("never reveals another account's cache or a signing-out account's preferences", () => {
    for (const options of [{ signedIn: false }, { signOut: true }]) {
      const result = boot(cache("cutline"), options);
      expect(result.root.dataset.interfaceStyle).toBe("axiom");
      expect(result.variables["--radius"]).toBe("12px");
    }
    const result = boot({ ...cache("cutline"), userId: "other-account" });
    expect(result.root.dataset.interfaceStyle).toBe("axiom");
  });
  it("rejects unknown identities and executable cached values without storage writes", () => {
    const result = boot({
      ...cache("not-a-style"),
      light: {
        "--paper": "url(https://bad.test)",
        "--text": "<script>",
        "--size-ui": "1.4rem",
      },
    });
    expect(result.root.dataset.interfaceStyle).toBe("axiom");
    expect(result.variables).not.toHaveProperty("--paper");
    expect(result.variables).not.toHaveProperty("--text");
    expect(result.variables["--size-ui"]).toBe("1.4rem");
    const unavailable = boot(cache("cutline"), {
      brokenStorage: true,
      systemDark: true,
    });
    expect(unavailable.root.dataset).toMatchObject({
      interfaceStyle: "axiom",
      theme: "dark",
    });
    expect(unavailable.variables["--paper"]).toBe(
      appearanceVariables(defaults, true)["--paper"],
    );
  });
});
