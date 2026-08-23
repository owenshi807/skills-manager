import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const skinsDir = path.join(root, "src/styles/skins");

const coreTokens = [
  "--font-sans",
  "--font-mono",
  "--tracking-body",
  "--color-bg",
  "--color-bg-secondary",
  "--color-surface",
  "--color-surface-hover",
  "--color-surface-active",
  "--color-border",
  "--color-border-subtle",
  "--color-border-faint",
  "--color-text-primary",
  "--color-text-secondary",
  "--color-text-tertiary",
  "--color-text-muted",
  "--color-text-faint",
  "--color-text-on-accent",
  "--color-accent",
  "--color-accent-light",
  "--color-accent-dark",
  "--color-accent-bg",
  "--color-accent-border",
  "--color-danger",
  "--color-warning",
  "--color-success",
  "--color-info",
  "--color-feature",
  "--radius-xs",
  "--radius-sm",
  "--radius-control",
  "--radius-panel",
  "--radius-dialog",
  "--radius-pill",
  "--shadow-card",
  "--shadow-card-hover",
  "--shadow-dialog",
  "--duration-fast",
  "--duration-standard",
  "--duration-slow",
  "--ease-standard",
  "--ease-smooth-out",
];

const compatibilityTokens = ["success", "warning", "danger", "info", "feature"]
  .flatMap((role) => ["weak", "soft", "", "strong", "deep"].map((level) => `--tone-${role}${level ? `-${level}` : ""}`))
  .concat("--tone-overlay");

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(absolute)));
    else files.push(absolute);
  }
  return files;
}

const errors = [];
const skinFiles = (await readdir(skinsDir))
  .filter((name) => name.endsWith(".css"))
  .map((name) => path.join(skinsDir, name));

if (skinFiles.length === 0) errors.push("No skin CSS files found.");

const sourceFiles = (await walk(path.join(root, "src"))).filter((file) =>
  /\.(css|ts|tsx)$/.test(file) && !file.startsWith(skinsDir)
);
const tailwindPath = path.join(root, "tailwind.config.js");
const consumerSources = await Promise.all(
  [...sourceFiles, tailwindPath].map(async (file) => ({ file, source: await readFile(file, "utf8") }))
);
const consumedTokens = new Set();
for (const { source } of consumerSources) {
  for (const match of source.matchAll(/var\((--[a-z0-9-]+)/gi)) {
    if (!match[1].endsWith("-")) consumedTokens.add(match[1]);
  }
}
const requiredTokens = [...new Set([...coreTokens, ...compatibilityTokens, ...consumedTokens])].sort();

for (const file of skinFiles) {
  const css = await readFile(file, "utf8");
  for (const token of requiredTokens) {
    if (!css.includes(`${token}:`)) {
      errors.push(`${path.relative(root, file)} is missing ${token}`);
    }
  }
  if (!css.includes("[data-design-skin=")) {
    errors.push(`${path.relative(root, file)} does not declare a data-design-skin selector`);
  }
}

for (const { file, source } of consumerSources.filter(({ file }) => file !== tailwindPath)) {
  const lines = source.split("\n");
  lines.forEach((line, index) => {
    const hasQuotedHex = /["'`]#[0-9a-fA-F]{3,8}\b/.test(line);
    const hasFunctionalColor = /\b(?:rgb|rgba|hsl|hsla)\s*\(/.test(line);
    if (hasQuotedHex || hasFunctionalColor) {
      errors.push(`${path.relative(root, file)}:${index + 1} contains a visual literal; move it into a skin token`);
    }
  });
}

const tailwind = await readFile(tailwindPath, "utf8");
for (const requiredAlias of ["semanticRamp('success')", "semanticRamp('warning')", "semanticRamp('danger')", "semanticRamp('info')", "semanticRamp('feature')"]) {
  if (!tailwind.includes(requiredAlias)) errors.push(`tailwind.config.js is missing ${requiredAlias}`);
}

if (errors.length > 0) {
  console.error("Design system contract failed:\n");
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

console.log(`Design system contract passed (${skinFiles.length} skin, ${requiredTokens.length} required tokens).`);
