import { test, type APIRequestContext } from "@playwright/test";

/** Share the seed account without disabling the server's production rate limits. */
export async function signInOwner(request: APIRequestContext, origin: string) {
  for (let attempt = 0; ; attempt++) {
    const response = await request.post("/api/auth/sign-in/email", {
      headers: { origin },
      data: {
        email: process.env.TEST_OWNER_EMAIL ?? "researcher@axiom.local",
        password: process.env.TEST_OWNER_PASSWORD ?? "AxiomResearch2026!",
      },
    });
    if (response.status() !== 429 || attempt === 2) return response;
    const retryAfter = response.headers()["retry-after"];
    const seconds = Number(retryAfter);
    const delay = Number.isFinite(seconds)
      ? seconds * 1000
      : Date.parse(retryAfter ?? "") - Date.now();
    const wait =
      Math.min(60000, Math.max(1000, Number.isFinite(delay) ? delay : 60000)) +
      250;
    test.setTimeout(test.info().timeout + wait + 1000);
    await response.dispose();
    await new Promise<void>((resolve) => setTimeout(resolve, wait));
  }
}
