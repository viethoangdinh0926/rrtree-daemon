import { describe, expect, it } from "vitest";
import { nodeToCurl } from "./curl.js";

describe("nodeToCurl", () => {
  it("emits a simple GET without noise headers", () => {
    const cmd = nodeToCurl({
      url: "https://example.com/api/items?q=1",
      method: "GET",
      requestHeaders: {
        "User-Agent": "Mozilla/5.0",
        Accept: "application/json",
        "sec-ch-ua": '"Chromium"',
        "sec-fetch-mode": "cors",
        "Accept-Encoding": "gzip",
        Host: "example.com",
        Authorization: "Bearer tok",
      },
    });
    expect(cmd).toBe(
      "curl -H 'Accept: application/json' -H 'Authorization: Bearer tok' 'https://example.com/api/items?q=1'",
    );
  });

  it("includes method, content-type, and body for POST", () => {
    const cmd = nodeToCurl({
      url: "https://example.com/api",
      method: "POST",
      requestHeaders: {
        "content-type": "application/json",
        "User-Agent": "Chrome",
        Origin: "https://example.com",
      },
      requestBody: { text: '{"a":1}', size: 7 },
    });
    expect(cmd).toBe(
      "curl -X POST -H 'Content-Type: application/json' --data-binary '{\"a\":1}' 'https://example.com/api'",
    );
  });

  it("shell-escapes single quotes in URL and body", () => {
    const cmd = nodeToCurl({
      url: "https://example.com/a'b",
      method: "POST",
      requestHeaders: {},
      requestBody: { text: "x'y" },
    });
    expect(cmd).toContain(`'https://example.com/a'\\''b'`);
    expect(cmd).toContain(`--data-binary 'x'\\''y'`);
  });
});
