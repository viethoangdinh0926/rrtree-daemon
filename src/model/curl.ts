import type { RrNode } from "./types.js";

/** Headers kept in generated curl (case-insensitive). Everything else is dropped. */
const CRUCIAL_HEADERS = new Set([
  "authorization",
  "content-type",
  "cookie",
  "accept",
  "x-api-key",
  "x-auth-token",
  "x-csrf-token",
  "x-xsrf-token",
  "x-requested-with",
]);

function shellSingleQuote(value: string): string {
  // POSIX-safe: 'foo'\''bar'
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function headerEntries(
  headers: Record<string, string> | undefined,
): Array<[string, string]> {
  if (!headers) return [];
  const out: Array<[string, string]> = [];
  for (const [rawName, value] of Object.entries(headers)) {
    if (value == null || value === "") continue;
    const name = rawName.toLowerCase();
    if (!CRUCIAL_HEADERS.has(name)) continue;
    // Prefer canonical casing for common headers.
    const display =
      name === "content-type"
        ? "Content-Type"
        : name === "authorization"
          ? "Authorization"
          : name === "cookie"
            ? "Cookie"
            : name === "accept"
              ? "Accept"
              : rawName;
    out.push([display, value]);
  }
  // Stable order for diffs / UX.
  out.sort((a, b) => a[0].localeCompare(b[0]));
  return out;
}

/**
 * Build a minimal curl command for replaying a captured request.
 * Omits browser noise (User-Agent, sec-*, Accept-Encoding, Host, …).
 */
export function nodeToCurl(node: Pick<
  RrNode,
  "url" | "method" | "requestHeaders" | "requestBody"
>): string {
  const method = (node.method || "GET").toUpperCase();
  const parts: string[] = ["curl"];

  if (method !== "GET") {
    parts.push("-X", method);
  }

  for (const [name, value] of headerEntries(node.requestHeaders)) {
    parts.push("-H", shellSingleQuote(`${name}: ${value}`));
  }

  const bodyText = node.requestBody?.text;
  if (
    bodyText != null &&
    bodyText !== "" &&
    method !== "GET" &&
    method !== "HEAD"
  ) {
    parts.push("--data-binary", shellSingleQuote(bodyText));
  }

  parts.push(shellSingleQuote(node.url));
  return parts.join(" ");
}

export { CRUCIAL_HEADERS };
