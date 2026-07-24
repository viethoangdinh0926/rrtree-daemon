import type { BodyPayload } from "./types.js";

export const BODY_MAX_BYTES = 256 * 1024;

/** Resource types where a text response body is usually useful. */
const TEXTISH_TYPES = new Set([
  "Document",
  "XHR",
  "Fetch",
  "Script",
  "Stylesheet",
  "Manifest",
  "TextTrack",
  "CSPViolationReport",
]);

/** Skip fetching large binary payloads. */
const BINARY_TYPES = new Set(["Image", "Media", "Font", "WebSocket"]);

export function shouldCaptureResponseBody(
  resourceType: string,
  mimeType?: string,
): boolean {
  if (BINARY_TYPES.has(resourceType)) return false;
  if (TEXTISH_TYPES.has(resourceType)) return true;
  if (!mimeType) return false;
  return (
    mimeType.startsWith("text/") ||
    mimeType.includes("json") ||
    mimeType.includes("javascript") ||
    mimeType.includes("xml") ||
    mimeType.includes("svg")
  );
}

export function truncateBody(
  text: string,
  base64Encoded: boolean,
  maxBytes = BODY_MAX_BYTES,
): BodyPayload {
  const size = base64Encoded
    ? Buffer.byteLength(text, "base64")
    : Buffer.byteLength(text, "utf8");

  if (base64Encoded) {
    // Keep a short base64 preview for binary-ish payloads that slipped through.
    const truncated = text.length > maxBytes;
    return {
      base64Encoded: true,
      base64: truncated ? text.slice(0, maxBytes) : text,
      size,
      truncated,
      text: undefined,
    };
  }

  if (size <= maxBytes) {
    return { text, size, truncated: false, base64Encoded: false };
  }

  // Truncate by characters approximating byte cap for UTF-8 text.
  let end = Math.min(text.length, maxBytes);
  while (end > 0 && Buffer.byteLength(text.slice(0, end), "utf8") > maxBytes) {
    end = Math.floor(end * 0.9);
  }
  return {
    text: text.slice(0, end),
    size,
    truncated: true,
    base64Encoded: false,
  };
}

export function bodyFromPostData(
  postData: string | undefined,
  maxBytes = BODY_MAX_BYTES,
): BodyPayload | undefined {
  if (postData == null || postData === "") return undefined;
  return truncateBody(postData, false, maxBytes);
}
