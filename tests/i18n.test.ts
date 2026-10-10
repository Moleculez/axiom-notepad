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
  localeTag,
  savedLocaleChoice,
  englishMessages,
  type Catalog,
} from "../packages/i18n/src/index";
import { LocaleRuntime } from "../packages/i18n/src/client";
import {
  validateCatalog,
  validateTranslationCoverage,
} from "../scripts/verify/i18n-contract";
import { requiredTranslations } from "../packages/i18n/src/translation-coverage";
import { editorCommands } from "../packages/shared/src/editor";
import { preferenceMessages } from "../apps/web/lib/preference-messages";
import { foldKindMessages } from "../apps/web/lib/editor-vnext/fold-presentation";
import { docSections } from "../packages/shared/src/documentation";
import {
  accessRoleMessage,
  annotationColorLabel,
  evidenceKindLabel,
  providerCapabilityLabel,
  publicationKindLabel,
} from "../apps/web/lib/interface-labels";
describe("locale matching and formatting", () => {
  it("provides the twelve chosen languages and autonyms", () => {
    expect(locales.map((locale) => locale.id)).toEqual([
      "en",
      "zh-Hans",
      "es",
      "fr",
      "ja",
      "ko",
      "de",
      "hi",
      "pt-BR",
      "ru",
      "bn",
      "id",
    ]);
    expect(new Set(locales.map((locale) => locale.name)).size).toBe(12);
  });
  it.each([
    [["zh-CN"], "zh-Hans"],
    [["zh_SG"], "zh-Hans"],
    [["zh-Hans-CN"], "zh-Hans"],
    [["zh-TW"], "en"],
    [["zh-Hant", "es-MX"], "es"],
    [["it-IT", "fr-CA"], "fr"],
    [["pt-PT"], "pt-BR"],
    [["ar-EG"], "en"],
    [["ar-EG", "ja-JP"], "ja"],
    [["ko-KR"], "ko"],
    [["de-AT"], "de"],
    [["en-GB"], "en"],
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
    expect(localeDirection("ja")).toBe("ltr");
    expect(localeDirection("bn")).toBe("ltr");
  });
  it("uses American English by default and safely retires Arabic choices", () => {
    expect(localeTag("en")).toBe("en-US");
    expect(savedLocaleChoice(null)).toBe("en");
    expect(savedLocaleChoice("ar")).toBe("auto");
    expect(savedLocaleChoice("en-US")).toBe("en");
    expect(savedLocaleChoice("ko")).toBe("ko");
    expect(locales.some(({ id }) => String(id) === "ar")).toBe(false);
    expect(formatNumber("en", 1234.5)).toBe("1,234.5");
    expect(
      formatDate("en", "2026-10-09T12:00:00Z", {
        dateStyle: "short",
        timeZone: "UTC",
      }),
    ).toBe("10/9/26");
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
  it("keeps runtime preference, fold and documentation registries registered and guarded", () => {
    const reviewed = new Set(Object.values(requiredTranslations).flat());
    for (const message of [
      ...Object.values(preferenceMessages),
      ...Object.values(foldKindMessages),
      ...docSections.map(([, title]) => title),
    ]) {
      expect(Object.hasOwn(englishMessages, message), message).toBe(true);
      // Canvas retains a technical product name; all other copy is guarded.
      if (message !== "Canvas")
        expect(reviewed.has(message), message).toBe(true);
    }
  });
  it.each(locales)(
    "keeps source-backed values literal in $id runtime messages",
    async ({ id }) => {
      const catalog = JSON.parse(
        await readFile(`packages/i18n/src/messages/${id}.json`, "utf8"),
      );
      const t = createTranslator(id, catalog);
      const name = "Settings · 日本語 / \\alpha {draft}";
      for (const message of [
        "Property name: {name}",
        "Value for {name}",
      ] as const)
        expect(t(message, { name })).toContain(name);
      expect(t("Footnote {key}", { key: name })).toContain(name);
      expect(t("{language} code", { language: "Python {Beta}" })).toContain(
        "Python {Beta}",
      );
      expect(t("Next: {title}", { title: name })).toContain(name);
      expect(t("Location: {locator}.", { locator: name })).toContain(name);
      const version = "019-test-UUID";
      expect(t("File version {version}.", { version })).toContain(version);
      for (const kind of ["pdf", "document", "office", "canvas"])
        expect(
          t(
            "Captured {date} · {kind, select, pdf {Browser-extracted text, not a verified quotation} other {Submitted evidence}}",
            { date: "2026-10-10", kind },
          ),
        ).toContain("2026-10-10");
      for (const count of [0, 1, 2, 5, 21, 1001])
        for (const message of [
          "{count, plural, one {Expand # line} other {Expand # lines}}",
          "{count, plural, one {# character} other {# characters}}",
          "{count, plural, one {Remove the # personal reading record shown above} other {Remove the # personal reading records shown above}}",
        ] as const)
          expect(t(message, { count })).toContain(formatNumber(id, count));
    },
  );
  it("registers every canonical editor command and category without changing IDs", () => {
    for (const command of editorCommands) {
      expect(Object.hasOwn(englishMessages, command.label), command.label).toBe(
        true,
      );
      expect(
        Object.hasOwn(englishMessages, command.category),
        command.category,
      ).toBe(true);
      expect(command.id).toMatch(/^[a-z][A-Za-z0-9]*$/);
    }
  });
  it.each(locales)(
    "keeps authored names and technical commands literal in $id controls",
    async ({ id }) => {
      const catalog = JSON.parse(
        await readFile(`packages/i18n/src/messages/${id}.json`, "utf8"),
      );
      const t = createTranslator(id, catalog);
      const name = "Settings · 日本語 / α {draft}";
      expect(t("Delete theme {name}", { name })).toContain(name);
      expect(t("Use {name} theme family", { name })).toContain(name);
      const command = "\\require{physics}";
      expect(
        t(
          "MathJax runs locally with AMS and chemistry support. To enable physics notation, add {command} to your document. External packages and code execution are disabled.",
          { command },
        ),
      ).toContain(command);
      for (const count of [0, 1, 2, 21]) {
        for (const message of [
          "{count, plural, one {# command available} other {# commands available}}",
          "{count, plural, one {# customized command} other {# customized commands}}",
        ] as const) {
          const result = t(message, { count });
          expect(result).toContain(formatNumber(id, count));
          expect(result).not.toContain("plural");
        }
      }
      for (const mode of ["light", "dark"]) {
        expect(
          t(
            "Restore {mode, select, dark {dark} other {light}} palette defaults",
            { mode },
          ),
        ).not.toContain("select");
      }
    },
  );
  it("uses native command-count wording rather than joined English fragments", async () => {
    const translate = async (locale: "ja" | "ko" | "de") =>
      createTranslator(
        locale,
        JSON.parse(
          await readFile(`packages/i18n/src/messages/${locale}.json`, "utf8"),
        ),
      );
    const message =
      "{count, plural, one {# command available} other {# commands available}}";
    expect((await translate("ja"))(message, { count: 21 })).toBe(
      "21 件のコマンドが使えます",
    );
    expect((await translate("ko"))(message, { count: 21 })).toBe(
      "명령 21개 사용 가능",
    );
    const de = await translate("de");
    expect(de(message, { count: 1 })).toBe("1 Befehl verfügbar");
    expect(de(message, { count: 2 })).toBe("2 Befehle verfügbar");
  });
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
  it("maps only closed research enums and preserves unknown authored values", () => {
    expect(providerCapabilityLabel("math")).toBe("Mathematical assistance");
    expect(evidenceKindLabel("office")).toBe("Office document");
    expect(publicationKindLabel("post")).toBe("Post");
    expect(annotationColorLabel("yellow")).toBe("Yellow");
    for (const display of [
      providerCapabilityLabel,
      evidenceKindLabel,
      publicationKindLabel,
      annotationColorLabel,
    ])
      for (const value of [
        "Settings — α研究",
        "toString",
        "__proto__",
        "unknown future type",
      ])
        expect(display(value)).toBe(value);
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
describe("native editor terminology", () => {
  it.each([
    ["ja", "エディター", "ショートカット"],
    ["ko", "에디터", "키보드 단축키"],
    ["de", "Editor", "Tastenkürzel"],
  ] as const)(
    "names the editing surface rather than a person in %s",
    async (locale, editor, shortcuts) => {
      const catalog = JSON.parse(
        await readFile(`packages/i18n/src/messages/${locale}.json`, "utf8"),
      );
      const t = createTranslator(locale, catalog);
      expect(t("Editor")).toBe(editor);
      expect(t("Shortcuts")).toBe(shortcuts);
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
    const preview = runtime.choose("ja");
    await runtime.choose("en");
    finish({ Save: "保存" });
    expect(await preview).toBe(false);
    expect(runtime.snapshot().locale).toBe("en");
  });
});
