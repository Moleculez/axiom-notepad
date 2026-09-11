import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PHASE_DEVELOPMENT_SERVER,
  PHASE_PRODUCTION_BUILD,
  PHASE_PRODUCTION_SERVER,
} from "next/constants";
import config from "../apps/web/next.config";

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_AXIOM_EDITOR_ENGINE", undefined);
  vi.stubEnv("AXIOM_DIST_DIR", undefined);
  vi.stubEnv("AXIOM_DEV_DIST_DIR", undefined);
});
afterEach(() => vi.unstubAllEnvs());

describe("development editor deployment", () => {
  it("serves the latest editor in ordinary npm run dev", () => {
    expect(
      config(PHASE_DEVELOPMENT_SERVER).env?.NEXT_PUBLIC_AXIOM_EDITOR_ENGINE,
    ).toBe("milkdown");
  });

  it.each([PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER])(
    "uses the same current editor in production during %s",
    (phase) => {
      expect(config(phase).env?.NEXT_PUBLIC_AXIOM_EDITOR_ENGINE).toBe(
        "milkdown",
      );
    },
  );

  it.each(["native", "milkdown"])("honors the explicit %s engine", (engine) => {
    vi.stubEnv("NEXT_PUBLIC_AXIOM_EDITOR_ENGINE", engine);
    for (const phase of [PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD])
      expect(config(phase).env?.NEXT_PUBLIC_AXIOM_EDITOR_ENGINE).toBe(engine);
  });

  it("does not reuse retained release assets for development", () => {
    vi.stubEnv("AXIOM_DIST_DIR", ".next/retained-release");
    expect(config(PHASE_DEVELOPMENT_SERVER).distDir).toBe(".next/dev-8080");
    expect(config(PHASE_PRODUCTION_BUILD).distDir).toBe(
      ".next/retained-release",
    );
    expect(config(PHASE_PRODUCTION_SERVER).distDir).toBe(
      ".next/retained-release",
    );
  });

  it("supports a separate development directory without changing the release", () => {
    vi.stubEnv("AXIOM_DEV_DIST_DIR", ".next/isolated-dev");
    expect(config(PHASE_DEVELOPMENT_SERVER).distDir).toBe(".next/isolated-dev");
    expect(config(PHASE_PRODUCTION_BUILD).distDir).toBe(".next");
  });
});
