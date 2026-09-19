const fallback = [
  "UTC",
  "Africa/Cairo",
  "Africa/Johannesburg",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/New_York",
  "America/Sao_Paulo",
  "Asia/Dubai",
  "Asia/Hong_Kong",
  "Asia/Kolkata",
  "Asia/Shanghai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Europe/Berlin",
  "Europe/London",
  "Europe/Paris",
  "Pacific/Auckland",
];

export function isTimeZone(value: string): boolean {
  if (!value || value !== value.trim()) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

/** Runtime IANA database: no network requests or hand-maintained primary catalog. */
export function timeZoneOptions(current = ""): string[] {
  let zones: string[];
  try {
    zones = Intl.supportedValuesOf("timeZone");
  } catch {
    zones = fallback;
  }
  const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return [
    ...new Set([
      "UTC",
      local,
      ...(isTimeZone(current) ? [current] : []),
      // Some Intl catalogs retain older canonical city names for compatibility.
      ...[
        "Asia/Kolkata",
        "Asia/Kathmandu",
        "Europe/Kyiv",
        "America/Nuuk",
      ].filter(isTimeZone),
      ...zones,
    ]),
  ];
}

export function filterTimeZones(zones: string[], query: string) {
  const words = query
    .trim()
    .toLowerCase()
    .replaceAll("_", " ")
    .split(/[\s/]+/)
    .filter(Boolean);
  return zones.filter((zone) =>
    words.every((word) =>
      zone.toLowerCase().replaceAll("_", " ").includes(word),
    ),
  );
}

export function timeZoneOffset(zone: string, date = new Date()) {
  try {
    return (
      new Intl.DateTimeFormat("en", {
        timeZone: zone,
        timeZoneName: "shortOffset",
      })
        .formatToParts(date)
        .find((part) => part.type === "timeZoneName")
        ?.value.replace("GMT", "UTC") ?? ""
    );
  } catch {
    return "";
  }
}
