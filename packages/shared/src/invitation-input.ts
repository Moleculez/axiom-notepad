/** Accept only an invitation token or an app-origin invitation URL. */
export function invitationToken(value: string, origin: string): string | null {
  const text = value.trim();
  if (/^[a-zA-Z0-9_-]{32,200}$/.test(text)) return text;
  try {
    const url = new URL(text, origin);
    if (url.origin !== new URL(origin).origin) return null;
    const token = url.searchParams.get("invite");
    return token && /^[a-zA-Z0-9_-]{32,200}$/.test(token) ? token : null;
  } catch {
    return null;
  }
}
