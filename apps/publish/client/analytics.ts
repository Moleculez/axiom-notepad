type Runtime = {
  enabled: boolean;
  googleMeasurementId: string;
  releaseId?: string;
  base?: string;
  static?: boolean;
  publicViews?: boolean;
  publicDownloads?: boolean;
  publicSiteTotals?: boolean;
};
type Preferences = {
  anonymous: boolean;
  google: boolean;
  googleId: string;
  savedAt: number;
};
type AnalyticsWindow = Window & {
  dataLayer?: unknown[];
  [key: `ga-disable-${string}`]: boolean | undefined;
};
export function initializeAnalytics() {
  const source = document.getElementById("axiom-site-runtime");
  if (!source) return; // Previews and normal static exports never contact a collector.
  let runtime: Runtime;
  try {
    runtime = JSON.parse(source.textContent ?? "{}");
  } catch {
    return;
  }
  if (!/^(G-[A-Z0-9]{4,20})?$/.test(runtime.googleMeasurementId ?? "")) return;
  let base: URL | null = null;
  try {
    if (runtime.base) {
      base = new URL(runtime.base.replace(/\/$/, "") + "/");
      if (base.origin !== location.origin) return;
    }
  } catch {
    return;
  }
  const w = window as unknown as AnalyticsWindow;
  const protectedVisitor =
    navigator.doNotTrack === "1" ||
    (navigator as Navigator & { globalPrivacyControl?: boolean })
      .globalPrivacyControl === true;
  const cookiePath = base?.pathname ?? new URL("../", import.meta.url).pathname;
  const key = `axiom-public-privacy:${cookiePath}`;
  let preferences: Preferences = {
    anonymous: true,
    google: false,
    googleId: "",
    savedAt: 0,
  };
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? "null");
    if (
      saved &&
      typeof saved.anonymous === "boolean" &&
      typeof saved.google === "boolean" &&
      Date.now() - saved.savedAt < 180 * 86400000
    )
      preferences = saved;
  } catch {}
  const persist = () => {
    preferences.savedAt = Date.now();
    try {
      localStorage.setItem(key, JSON.stringify(preferences));
    } catch {}
  };
  function gtag(..._args: unknown[]) {
    w.dataLayer ??= [];
    // Google's command queue consumes Arguments objects, not a nested array.
    // eslint-disable-next-line prefer-rest-params
    w.dataLayer.push(arguments);
  }
  let activeGoogle = "",
    googleLoaded = false;
  const privacyButton = document.querySelector<HTMLButtonElement>(
    "[data-site-privacy]",
  );
  const cookiePrefix =
    "axiom" + cookiePath.replace(/[^a-z0-9]/gi, "").slice(0, 60);
  function stopGoogle() {
    if (!activeGoogle) return;
    w[`ga-disable-${activeGoogle}`] = true;
    gtag("consent", "update", {
      analytics_storage: "denied",
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
    });
    for (const cookie of document.cookie.split(";")) {
      const name = cookie.split("=")[0].trim();
      if (!name.startsWith(cookiePrefix + "_")) continue;
      const path = cookiePath;
      document.cookie = `${name}=;Max-Age=0;Path=${path};SameSite=Lax`;
      document.cookie = `${name}=;Max-Age=0;Path=${path};Domain=${location.hostname};SameSite=Lax`;
    }
    activeGoogle = "";
  }
  function startGoogle() {
    const id = runtime.googleMeasurementId;
    if (
      protectedVisitor ||
      !preferences.google ||
      preferences.googleId !== id ||
      !id
    ) {
      stopGoogle();
      return;
    }
    if (activeGoogle === id) return;
    if (activeGoogle) stopGoogle();
    w[`ga-disable-${id}`] = false;
    activeGoogle = id;
    gtag("consent", "default", {
      analytics_storage: "denied",
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
    });
    gtag("consent", "update", { analytics_storage: "granted" });
    gtag("js", new Date());
    const safe = {
      page_location: location.origin + location.pathname,
      page_referrer: referrer() ? `https://${referrer()}/` : "",
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      cookie_prefix: cookiePrefix,
      cookie_path: cookiePath,
      cookie_domain: location.hostname,
    };
    gtag("config", id, { ...safe, send_page_view: false });
    gtag("event", "page_view", { ...safe, send_to: id });
    if (!googleLoaded) {
      const script = document.createElement("script");
      script.async = true;
      script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
      document.head.append(script);
      googleLoaded = true;
    }
  }
  function referrer() {
    try {
      const host = new URL(document.referrer).hostname;
      return host === location.hostname ? "" : host;
    } catch {
      return "";
    }
  }
  let privacyPanel: HTMLElement | null = null;
  const showPrivacy = () => {
    if (privacyPanel) {
      privacyPanel.querySelector("button")?.focus();
      return;
    }
    const previous = document.activeElement as HTMLElement | null;
    const panel = document.createElement("section");
    panel.className = "site-privacy";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Website privacy settings");
    const heading = document.createElement("h2");
    heading.textContent = "Your reading, your privacy";
    const description = document.createElement("p");
    description.textContent = protectedVisitor
      ? "Your browser privacy signal is respected. Visitor analytics are disabled."
      : "Anonymous first-party counts use no tracking cookies or persistent visitor identifiers. Google Analytics is optional and loads only if you accept.";
    const label = document.createElement("label"),
      checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = !protectedVisitor && preferences.anonymous;
    checkbox.disabled = protectedVisitor;
    checkbox.onchange = () => {
      preferences.anonymous = checkbox.checked;
      persist();
      if (checkbox.checked) send();
    };
    label.append(checkbox, "Allow anonymous first-party counts");
    label.hidden = !runtime.enabled || !!runtime.static;
    const actions = document.createElement("div");
    actions.className = "site-privacy-actions";
    const close = () => {
      panel.remove();
      privacyPanel = null;
      previous?.focus();
    };
    const button = (text: string, action: () => void) => {
      const b = document.createElement("button");
      b.textContent = text;
      b.onclick = action;
      actions.append(b);
      return b;
    };
    if (runtime.googleMeasurementId && !protectedVisitor) {
      button("Reject external analytics", () => {
        preferences.google = false;
        preferences.googleId = runtime.googleMeasurementId;
        persist();
        stopGoogle();
        close();
      });
      button("Accept external analytics", () => {
        preferences.google = true;
        preferences.googleId = runtime.googleMeasurementId;
        persist();
        startGoogle();
        close();
      });
    } else
      button("Save preferences", () => {
        persist();
        close();
      });
    button("Close", close);
    panel.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close();
    });
    panel.append(heading, description, label, actions);
    document.body.append(panel);
    privacyPanel = panel;
  };
  if (privacyButton) {
    privacyButton.hidden = !(runtime.enabled || runtime.googleMeasurementId);
    privacyButton.onclick = showPrivacy;
  }
  let seconds = 0,
    depth = 0,
    downloads = 0,
    citations = 0,
    outbound = 0;
  const visitId = crypto.randomUUID();
  let lastActivity = Date.now(),
    lastTick = Date.now(),
    lastSend = "",
    sending = false,
    terminal = false;
  const article =
    document.querySelector<HTMLElement>(".site-article-body") ??
    document.querySelector<HTMLElement>("main");
  const tick = () => {
    const now = Date.now();
    if (
      runtime.enabled &&
      preferences.anonymous &&
      !protectedVisitor &&
      !document.hidden &&
      now - lastActivity < 30000
    )
      seconds = Math.min(1800, seconds + Math.min(2, (now - lastTick) / 1000));
    lastTick = now;
    if (article && !document.hidden) {
      const box = article.getBoundingClientRect();
      depth = Math.max(
        depth,
        Math.min(
          100,
          Math.max(
            0,
            Math.round(
              ((innerHeight - box.top) / Math.max(1, box.height)) * 100,
            ),
          ),
        ),
      );
    }
  };
  function send(keepalive = false) {
    if (
      !base ||
      !runtime.enabled ||
      protectedVisitor ||
      !preferences.anonymous ||
      terminal ||
      sending
    )
      return;
    const body = JSON.stringify({
      releaseId: runtime.releaseId,
      page: document.body.dataset.publicPath,
      visitId,
      seconds: Math.floor(seconds),
      depth,
      downloads,
      citations,
      outbound,
      referrer: referrer(),
    });
    if (body === lastSend) return;
    sending = true;
    void fetch(new URL("_site/analytics/events", base), {
      method: "POST",
      credentials: "omit",
      keepalive,
      headers: { "content-type": "application/json" },
      body,
    })
      .then((r) => {
        if (r.ok) lastSend = body;
        if (r.status === 404 || r.status === 403) terminal = true;
      })
      .catch(() => {})
      .finally(() => {
        sending = false;
      });
  }
  for (const event of ["pointerdown", "pointermove", "keydown", "scroll"])
    addEventListener(
      event,
      () => {
        lastActivity = Date.now();
      },
      { passive: true },
    );
  document.addEventListener("click", (event) => {
    if (!runtime.enabled || protectedVisitor || !preferences.anonymous) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("[data-copy-citation]"))
      citations = Math.min(100, citations + 1);
    const anchor = target?.closest<HTMLAnchorElement>("a[href]");
    if (anchor?.hasAttribute("download") || target?.closest("[data-copy-svg]"))
      downloads = Math.min(100, downloads + 1);
    if (
      anchor &&
      /^https?:$/.test(anchor.protocol) &&
      anchor.origin !== location.origin
    )
      outbound = Math.min(100, outbound + 1);
    tick();
    send(true);
  });
  document.addEventListener("visibilitychange", () => {
    tick();
    if (document.hidden) send(true);
    else lastActivity = Date.now();
  });
  addEventListener("pagehide", () => {
    tick();
    send(true);
  });
  const refresh = async () => {
    if (!base || document.hidden || terminal) return;
    try {
      const response = await fetch(new URL("_site/analytics/config", base), {
        credentials: "omit",
        cache: "no-store",
      });
      if (!response.ok) {
        runtime.enabled = false;
        runtime.googleMeasurementId = "";
        stopGoogle();
        if (privacyButton) privacyButton.hidden = true;
        return;
      }
      const next = (await response.json()) as Runtime;
      if (next.releaseId !== runtime.releaseId) {
        runtime.enabled = false;
        runtime.googleMeasurementId = "";
        terminal = true;
        stopGoogle();
        if (privacyButton) privacyButton.hidden = true;
        return;
      }
      const previousGoogle = runtime.googleMeasurementId;
      runtime = { ...runtime, ...next };
      if (privacyButton)
        privacyButton.hidden = !(
          runtime.enabled || runtime.googleMeasurementId
        );
      startGoogle();
      void totals("site");
      void totals("article");
      if (previousGoogle !== runtime.googleMeasurementId) {
        privacyPanel?.remove();
        privacyPanel = null;
        if (
          runtime.googleMeasurementId &&
          !protectedVisitor &&
          preferences.googleId !== runtime.googleMeasurementId
        )
          showPrivacy();
      }
    } catch {
      /* Reading never depends on analytics. */
    }
  };
  let ticker: ReturnType<typeof setInterval>,
    interval: ReturnType<typeof setInterval>,
    timer: ReturnType<typeof setInterval>;
  const startTimers = () => {
    lastTick = Date.now();
    lastActivity = Date.now();
    ticker = setInterval(tick, 1000);
    interval = setInterval(() => send(), 10000);
    timer = setInterval(refresh, 60000);
  };
  startTimers();
  addEventListener("pagehide", () => {
    clearInterval(ticker);
    clearInterval(interval);
    clearInterval(timer);
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) {
      startTimers();
      void refresh();
    }
  });
  const totals = async (kind: "site" | "article") => {
    const element = document.querySelector<HTMLElement>(
      `[data-public-totals="${kind}"]`,
    );
    if (
      !element ||
      !base ||
      (!runtime.publicViews && !runtime.publicDownloads) ||
      (kind === "site" && !runtime.publicSiteTotals)
    ) {
      if (element) element.hidden = true;
      return;
    }
    const url = new URL("_site/analytics/totals", base);
    if (kind === "article") {
      if (!document.body.dataset.entryId) return;
      url.searchParams.set("entry", document.body.dataset.entryId);
    }
    try {
      const result = await fetch(url, {
        credentials: "omit",
        cache: "no-store",
      });
      if (!result.ok) return;
      const value = await result.json();
      element.textContent = [
        Number.isFinite(value.views)
          ? `${value.views.toLocaleString()} views`
          : "",
        Number.isFinite(value.downloads)
          ? `${value.downloads.toLocaleString()} download clicks`
          : "",
      ]
        .filter(Boolean)
        .join(" · ");
      element.hidden = !element.textContent;
    } catch {}
  };
  tick();
  send();
  startGoogle();
  void totals("site");
  void totals("article");
  if (
    runtime.googleMeasurementId &&
    !protectedVisitor &&
    (!preferences.savedAt ||
      preferences.googleId !== runtime.googleMeasurementId)
  )
    showPrivacy();
}
