import { defineConfig } from "@playwright/test";
import { resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30000,
  use: {
    headless: false, // Extensions require headed mode
  },
  projects: [
    {
      name: "chromium",
      use: {
        launchOptions: {
          args: [
            `--disable-extensions-except=${resolve(__dirname, "dist")}`,
            `--load-extension=${resolve(__dirname, "dist")}`,
          ],
        },
      },
    },
  ],
});
