import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("manager team access", () => {
  it("authorises a manager before sending an invitation", () => {
    const action = source("src/actions/team.ts");
    expect(action).toContain('assertRole("manager")');
    expect(action).toContain("inviteUserByEmail");
    expect(action.indexOf('assertRole("manager")')).toBeLessThan(action.indexOf("inviteUserByEmail"));
  });

  it("whitelists account roles and stamps the manager's tenant onto the invitation", () => {
    const action = source("src/actions/team.ts");
    expect(action).toContain("APP_ROLES.some");
    expect(action).toContain("tenant_id: manager.tenant_id");
  });

  it("exposes team management only from the manager settings page", () => {
    const settingsPage = source("src/app/manager/settings/page.tsx");
    expect(settingsPage).toContain('requireRole("manager")');
    expect(settingsPage).toContain("<TeamSettings");
  });
});
