const AUTH_REDIRECTS = new Set(["/", "/update-password"]);

export function safeAuthRedirect(value: string | null): string {
  return value && AUTH_REDIRECTS.has(value) ? value : "/";
}
