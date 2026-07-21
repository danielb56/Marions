import { expect, test } from "@playwright/test";
test("sign-in is secure and usable on desktop and mobile", async ({ page }) => { await page.goto("/sign-in"); await expect(page.getByRole("heading", { name: "Sign in to Marion" })).toBeVisible(); await expect(page.getByText("No public sign-up")).toBeVisible(); await expect(page.locator("body")).not.toContainText("$2,200"); });
