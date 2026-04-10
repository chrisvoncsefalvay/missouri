#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DIST_ROOT = path.join(ROOT, "dist", "skills");
const SOURCE_SKILL = path.join(ROOT, "SKILL.md");
const SKILL_NAME = "missouri";

const PROVIDERS = [
  { id: "claude-code", configDir: ".claude", publishToRepo: true },
  { id: "cursor", configDir: ".cursor", publishToRepo: true },
  { id: "gemini", configDir: ".gemini", publishToRepo: true },
  { id: "codex", configDir: ".codex", publishToRepo: false },
  { id: "agents", configDir: ".agents", publishToRepo: true },
  { id: "github-copilot", configDir: ".github", publishToRepo: true },
  { id: "kiro", configDir: ".kiro", publishToRepo: true },
  { id: "opencode", configDir: ".opencode", publishToRepo: true },
  { id: "pi", configDir: ".pi", publishToRepo: true },
  { id: "trae", configDir: ".trae", publishToRepo: true },
  { id: "trae-cn", configDir: ".trae-cn", publishToRepo: true },
];

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content);
}

function canCreateDirectory(targetPath) {
  if (!fs.existsSync(targetPath)) {
    return true;
  }

  return fs.statSync(targetPath).isDirectory();
}

function skillInstallPath(basePath, configDir) {
  return path.join(basePath, configDir, "skills", SKILL_NAME, "SKILL.md");
}

function buildRepoBundles(skillContent) {
  const published = [];
  const skipped = [];

  for (const provider of PROVIDERS) {
    if (!provider.publishToRepo) {
      skipped.push({
        provider: provider.id,
        reason: "repo publication disabled",
      });
      continue;
    }

    const targetRoot = path.join(ROOT, provider.configDir);
    if (!canCreateDirectory(targetRoot)) {
      skipped.push({
        provider: provider.id,
        reason: `${provider.configDir} is an existing file`,
      });
      continue;
    }

    writeFile(skillInstallPath(ROOT, provider.configDir), skillContent);
    published.push({
      provider: provider.id,
      path: path.relative(ROOT, skillInstallPath(ROOT, provider.configDir)),
    });
  }

  return { published, skipped };
}

function buildDistBundles(skillContent) {
  fs.rmSync(DIST_ROOT, { recursive: true, force: true });

  const bundlePaths = [];
  for (const provider of PROVIDERS) {
    const providerSkillPath = skillInstallPath(
      path.join(DIST_ROOT, provider.id),
      provider.configDir,
    );
    writeFile(providerSkillPath, skillContent);
    bundlePaths.push({
      provider: provider.id,
      path: path.relative(ROOT, providerSkillPath),
    });
  }

  const universalDir = path.join(DIST_ROOT, "universal");
  ensureDir(universalDir);
  for (const provider of PROVIDERS) {
    const sourceDir = path.join(DIST_ROOT, provider.id, provider.configDir);
    const targetDir = path.join(universalDir, provider.configDir);
    fs.cpSync(sourceDir, targetDir, { recursive: true });
  }

  const manifest = {
    name: SKILL_NAME,
    source: "https://github.com/chrisvoncsefalvay/missouri",
    skillFile: "https://github.com/chrisvoncsefalvay/missouri/blob/main/SKILL.md",
    install: {
      command: "npx skills add chrisvoncsefalvay/missouri",
      note: "The repository root is kept in sync with provider-specific skill directories so npx skills add can detect the right harness layout.",
    },
    providers: PROVIDERS.map((provider) => ({
      id: provider.id,
      configDir: provider.configDir,
      bundlePath: `${provider.id}/${provider.configDir}/skills/${SKILL_NAME}/SKILL.md`,
      publishedToRepo: provider.publishToRepo,
    })),
  };

  writeFile(path.join(DIST_ROOT, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFile(
    path.join(universalDir, "README.txt"),
    [
      "Missouri skill universal bundle",
      "",
      "Extract the folder for your coding agent into your project root or user-level skills directory.",
      "",
      "Included harness layouts:",
      ...PROVIDERS.map((provider) => `- ${provider.configDir}/skills/${SKILL_NAME}/SKILL.md`),
      "",
      "Primary repo install command:",
      "npx skills add chrisvoncsefalvay/missouri",
      "",
    ].join("\n"),
  );

  return bundlePaths;
}

function main() {
  if (!fs.existsSync(SOURCE_SKILL)) {
    throw new Error(`Missing source skill: ${SOURCE_SKILL}`);
  }

  const skillContent = fs.readFileSync(SOURCE_SKILL, "utf8");
  const args = new Set(process.argv.slice(2));
  const buildRoot = args.size === 0 || args.has("--root");
  const buildDist = args.size === 0 || args.has("--dist");

  const result = {
    root: null,
    dist: null,
  };

  if (buildRoot) {
    result.root = buildRepoBundles(skillContent);
  }

  if (buildDist) {
    result.dist = buildDistBundles(skillContent);
  }

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main();