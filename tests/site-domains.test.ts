import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const dns = vi.hoisted(() => ({
  resolveTxt: vi.fn(),
  resolveCname: vi.fn(),
  resolve4: vi.fn(),
  resolve6: vi.fn(),
}));
vi.mock("node:dns/promises", () => dns);
import {
  verifyPublicationDomain,
  publicationHostname,
} from "../packages/shared/src/site-domains";

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("APP_URL", "https://notes.example.org");
  vi.stubEnv("PUBLISH_DOMAIN_TARGET", "sites.example.org");
  dns.resolveTxt.mockResolvedValue([["axiom-site=approved"]]);
  dns.resolveCname.mockResolvedValue([]);
  dns.resolve4.mockResolvedValue(["203.0.113.20"]);
  dns.resolve6.mockResolvedValue([]);
});
afterEach(() => vi.unstubAllEnvs());
describe("public domain ownership and routing", () => {
  it("requires a different hostname from the private application", () => {
    expect(() => publicationHostname("notes.example.org")).toThrow(
      "login domain",
    );
  });
  it("does not check routing before ownership is proven", async () => {
    dns.resolveTxt.mockResolvedValue([["wrong-token"]]);
    await expect(
      verifyPublicationDomain("lab.example.org", "approved"),
    ).rejects.toThrow("Ownership TXT");
    expect(dns.resolveCname).not.toHaveBeenCalled();
  });
  it("accepts a split TXT value and a matching case-insensitive CNAME", async () => {
    dns.resolveTxt.mockResolvedValue([["axiom-site=", "approved"]]);
    dns.resolveCname.mockResolvedValue(["Sites.Example.Org."]);
    await expect(
      verifyPublicationDomain("lab.example.org", "approved"),
    ).resolves.toBeUndefined();
    expect(dns.resolve4).not.toHaveBeenCalled();
  });
  it("accepts matching A records but rejects an extra stale IPv6 route", async () => {
    await expect(
      verifyPublicationDomain("lab.example.org", "approved"),
    ).resolves.toBeUndefined();
    dns.resolve6.mockImplementation(async (name: string) =>
      name === "lab.example.org" ? ["2001:db8::99"] : [],
    );
    await expect(
      verifyPublicationDomain("lab.example.org", "approved"),
    ).rejects.toThrow("every A/AAAA");
  });
  it("fails closed on missing DNS and unconfigured hosting", async () => {
    dns.resolveTxt.mockRejectedValue(new Error("ENOTFOUND"));
    await expect(
      verifyPublicationDomain("lab.example.org", "approved"),
    ).rejects.toThrow("Ownership TXT");
    vi.stubEnv("PUBLISH_DOMAIN_TARGET", "");
    await expect(
      verifyPublicationDomain("lab.example.org", "approved"),
    ).rejects.toThrow("administrator");
  });
});
