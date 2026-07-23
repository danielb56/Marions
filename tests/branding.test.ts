import { describe, expect, it } from "vitest";
import { APP_NAME, APP_SHORT_NAME, brandNotificationBody } from "@/lib/brand";

describe("REME branding", () => {
  it("exposes the current company identity", () => {
    expect(APP_NAME).toBe("REME Painting Group");
    expect(APP_SHORT_NAME).toBe("REME");
  });

  it("updates legacy queued notification prefixes without changing normal content", () => {
    expect(brandNotificationBody("Marion: new work assigned.")).toBe("REME: new work assigned.");
    expect(brandNotificationBody("Your schedule was updated.")).toBe("Your schedule was updated.");
  });
});
