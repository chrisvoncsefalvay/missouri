import { build } from "vite";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { cpSync, mkdirSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const dist = resolve(root, "dist");

const entries = [
  { name: "content-script", entry: "src/content-script/index.ts" },
  { name: "background", entry: "src/background/index.ts" },
  { name: "popup", entry: "src/popup/index.ts" },
  { name: "page-api", entry: "src/page-api.ts" },
];

async function main() {
  const isWatch = process.argv.includes("--watch");

  // Build each entry as a standalone IIFE
  for (const { name, entry } of entries) {
    await build({
      root,
      configFile: false,
      build: {
        outDir: "dist",
        emptyOutDir: false,
        sourcemap: process.env.NODE_ENV === "development" ? "inline" : false,
        lib: {
          entry: resolve(root, entry),
          formats: ["iife"],
          name: name.replace(/-/g, "_"),
          fileName: () => `${name}.js`,
        },
        rollupOptions: {
          output: {
            inlineDynamicImports: true,
          },
        },
        target: "chrome120",
        minify: false,
        watch: isWatch ? {} : null,
      },
    });
  }

  // Copy static assets
  mkdirSync(dist, { recursive: true });
  for (const file of ["manifest.json", "popup.html", "popup.css", "content-styles.css"]) {
    cpSync(resolve(root, file), resolve(dist, file));
  }
  cpSync(resolve(root, "icons"), resolve(dist, "icons"), { recursive: true });
  cpSync(resolve(root, "_locales"), resolve(dist, "_locales"), { recursive: true });
  cpSync(resolve(root, "fonts"), resolve(dist, "fonts"), { recursive: true });

  console.log("Build complete → dist/");
}

main().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
