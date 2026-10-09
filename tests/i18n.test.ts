import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import {
  createTranslator,
  resolveLocale,
  localeDirection,
  formatDate,
  formatNumber,
  formatRelativeTime,
  locales,
  englishMessages,
  type Catalog,
} from "../packages/i18n/src/index";
import { LocaleRuntime } from "../packages/i18n/src/client";
import {
  validateCatalog,
  validateTranslationCoverage,
} from "../scripts/verify/i18n-contract";
import { requiredTranslations } from "../packages/i18n/src/translation-coverage";
import { accessRoleMessage } from "../apps/web/lib/interface-labels";
describe("locale matching and formatting", () => {
  it("provides the ten chosen languages and autonyms", () => {
    expect(locales.map((locale) => locale.id)).toEqual([
      "en",
      "zh-Hans",
      "es",
      "fr",
      "ar",
      "hi",
      "pt-BR",
      "ru",
      "bn",
      "id",
    ]);
    expect(new Set(locales.map((locale) => locale.name)).size).toBe(10);
  });
  it.each([
    [["zh-CN"], "zh-Hans"],
    [["zh_SG"], "zh-Hans"],
    [["zh-Hans-CN"], "zh-Hans"],
    [["zh-TW"], "en"],
    [["zh-Hant", "es-MX"], "es"],
    [["de-DE", "fr-CA"], "fr"],
    [["pt-PT"], "pt-BR"],
    [["ar-EG"], "ar"],
    [["hi-IN"], "hi"],
    [["ru-RU"], "ru"],
    [["bn-BD"], "bn"],
    [["id-ID"], "id"],
    [[], "en"],
  ])("matches %j safely", (languages, expected) => {
    expect(resolveLocale("auto", languages)).toBe(expected);
  });
  it("an explicit selection wins; unsupported browser languages fall back", () => {
    expect(resolveLocale("en", ["ar"])).toBe("en");
    expect(localeDirection("ar")).toBe("rtl");
    expect(localeDirection("bn")).toBe("ltr");
  });
  it("formats visible values without changing their stored values", () => {
    expect(formatNumber("es", 1234567)).toContain("1.234.567");
    expect(
      formatDate("fr", "2026-10-09T12:00:00Z", {
        dateStyle: "long",
        timeZone: "UTC",
      }),
    ).toContain("octobre");
    expect(formatRelativeTime("es", Date.now() - 120000)).toContain(
      "2 minutos",
    );
    expect(formatDate("bn", "not-a-date")).toBe("—");
  });
});
describe("reviewed catalog contracts", () => {
  it.each(locales)(
    "validates $id keys and all ICU parameters",
    async ({ id }) => {
      const catalog = JSON.parse(
        await readFile(`packages/i18n/src/messages/${id}.json`, "utf8"),
      );
      expect(validateCatalog(id, catalog)).toEqual([]);
      expect(validateTranslationCoverage(id, catalog)).toEqual([]);
      const translate = createTranslator(id, catalog);
      expect(translate("Save")).toBeTruthy();
      expect(
        translate("Automatic — {language}", { language: "日本語" }),
      ).toContain("日本語");
      for (const count of [0, 1, 2, 5, 11, 21, 103])
        expect(
          translate("{count, plural, one {# file} other {# files}}", { count }),
        ).not.toContain("plural");
    },
  );
  it("uses English for a missing message, not a blank label", () => {
    expect(createTranslator("es", { Save: "Guardar" })("Cancel")).toBe(
      "Cancel",
    );
  });
  it("rejects missing IDs and mismatched ICU parameters", () => {
    const bad = {
      ...englishMessages,
      "Automatic — {language}": "Automatic {secret}",
    };
    expect(validateCatalog("en", bad)).toContainEqual(
      expect.objectContaining({
        message: "ICU parameters or parameter types changed",
      }),
    );
    delete (bad as Partial<typeof bad>).Save;
    expect(validateCatalog("en", bad)).toContainEqual(
      expect.objectContaining({ id: "Save", message: "Missing message" }),
    );
  });
  it("rejects English fallback regressions in completed UI increments", () => {
    const catalog = Object.fromEntries(
      Object.keys(englishMessages).map((id) => [id, `translated: ${id}`]),
    );
    expect(validateTranslationCoverage("es", catalog)).toEqual([]);
    catalog["Save profile"] = englishMessages["Save profile"];
    delete catalog["Search Trash"];
    expect(validateTranslationCoverage("es", catalog)).toEqual([
      expect.objectContaining({ id: "Save profile" }),
      expect.objectContaining({ id: "Search Trash" }),
    ]);
    expect(validateTranslationCoverage("en", englishMessages)).toEqual([]);
    const matching = {
      ...catalog,
      "Save profile": "Guardar perfil",
      "Search Trash": "Buscar",
      "{used, number} / {limit, number} links":
        englishMessages["{used, number} / {limit, number} links"],
    };
    expect(validateTranslationCoverage("pt-BR", matching)).toEqual([]);
    expect(validateTranslationCoverage("es", matching)).toContainEqual(
      expect.objectContaining({ id: "{used, number} / {limit, number} links" }),
    );
    delete (matching as Record<string, string>)[
      "{used, number} / {limit, number} links"
    ];
    expect(validateTranslationCoverage("pt-BR", matching)).toContainEqual(
      expect.objectContaining({ id: "{used, number} / {limit, number} links" }),
    );
    const ids = Object.values(requiredTranslations).flat();
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("maps only canonical access roles, not arbitrary authored labels", () => {
    expect(accessRoleMessage("admin")).toBe("Administrator");
    expect(accessRoleMessage("commenter")).toBe("Commenter");
    for (const authored of [
      "Settings",
      "member of the lab",
      "toString",
      "__proto__",
    ])
      expect(accessRoleMessage(authored)).toBeUndefined();
  });
  it.each(locales)(
    "preserves authored values and canonical confirmation tokens in $id messages",
    async ({ id }) => {
      const catalog = JSON.parse(
        await readFile(`packages/i18n/src/messages/${id}.json`, "utf8"),
      );
      const t = createTranslator(id, catalog);
      const name = "Settings — α研究 {draft}";
      expect(t("Leave {group}?", { group: name })).toContain(name);
      expect(
        t(
          "Permanently deleted {name} and removed the confirmed protection. This cannot be undone.",
          { name },
        ),
      ).toContain(name);
      expect(
        t(
          "Type {confirmation} to remove the protection above and permanently delete this file.",
          { confirmation: "DELETE FOREVER" },
        ),
      ).toContain("DELETE FOREVER");
      for (const count of [0, 1, 2, 5, 11, 21, 103]) {
        const message = t(
          "Page {page, number} · {count, plural, one {# item shown} other {# items shown}}",
          { page: 3, count },
        );
        expect(message).not.toMatch(/\{(?:page|count)/);
        expect(message).not.toContain("plural");
      }
    },
  );
});
describe("atomic client preview", () => {
  it("ignores stale language loads and retains current UI while loading", async () => {
    let spanish!: (catalog: Partial<Catalog>) => void;
    const runtime = new LocaleRuntime((locale) =>
      locale === "es"
        ? new Promise((resolve) => {
            spanish = resolve;
          })
        : Promise.resolve({ Save: "Enregistrer" }),
    );
    await runtime.choose("en");
    const slow = runtime.choose("es");
    expect(runtime.snapshot()).toMatchObject({ locale: "en", loading: true });
    await runtime.choose("fr");
    spanish({ Save: "Guardar" });
    expect(await slow).toBe(false);
    expect(runtime.snapshot().translate("Save")).toBe("Enregistrer");
  });
  it("failed catalogs do not change the applied locale or choice", async () => {
    const runtime = new LocaleRuntime(async () => {
      throw new Error("Offline");
    });
    await runtime.choose("en");
    expect(await runtime.choose("bn")).toBe(false);
    expect(runtime.snapshot()).toMatchObject({
      locale: "en",
      choice: "en",
      ready: true,
      loading: false,
    });
  });
  it("cancel fences an outstanding preview without unmounting consumers", async () => {
    let finish!: (catalog: Partial<Catalog>) => void;
    const runtime = new LocaleRuntime(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await runtime.choose("en");
    const preview = runtime.choose("ar");
    await runtime.choose("en");
    finish({ Save: "حفظ" });
    expect(await preview).toBe(false);
    expect(runtime.snapshot().locale).toBe("en");
  });
});
