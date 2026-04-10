import { test, expect } from "@playwright/test";

test.describe("Annotation lifecycle", () => {
  test("extension injects content script on page load", async ({ page }) => {
    await page.goto("https://example.com");

    // Wait for content script to inject the root element
    const root = page.locator("#mo-marker-root");
    await expect(root).toBeAttached({ timeout: 5000 });
  });

  test("toggle annotation mode via keyboard", async ({ page }) => {
    await page.goto("https://example.com");
    await page.waitForSelector("#mo-marker-root", { state: "attached", timeout: 5000 });

    // Toggle annotation mode
    await page.keyboard.press("Control+Shift+M");

    // Verify mode activated
    await expect(page.locator('#mo-marker-root[data-mode="annotate"]')).toBeAttached({ timeout: 3000 });

    // Toggle off
    await page.keyboard.press("Control+Shift+M");
    await expect(page.locator('#mo-marker-root[data-mode="idle"]')).toBeAttached({ timeout: 3000 });
  });
});
