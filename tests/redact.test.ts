import { describe, expect, it, vi } from "vitest";
import { logger, redact } from "@/lib/redact";

describe("log redaction", () => {
  it("recursively removes pricing, tokens and passwords", () => {
    expect(redact({ task: { description: "Paint", unit_rate: 4400 }, total: 220000, token: "abc", safe: true })).toEqual({ task: { description: "Paint", unit_rate: "[REDACTED]" }, total: "[REDACTED]", token: "[REDACTED]", safe: true });
  });
  it("never writes sensitive values through the structured logger", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    logger.info("example", { subtotal: 200000, name: "Safe" });
    expect(spy.mock.calls[0][0]).not.toContain("200000");
    spy.mockRestore();
  });
});
