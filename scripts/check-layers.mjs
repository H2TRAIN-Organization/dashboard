#!/usr/bin/env node
/**
 * Enforces the dependency direction of src/server:
 *   domain <- application <- infrastructure
 *                         <- http
 *                         <- composition (may import every layer)
 *
 * Run with: npm run check:layers
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const LAYERS = ["domain", "application", "infrastructure", "http", "composition"];
const ALLOWED = {
  domain: ["domain"],
  application: ["domain", "application"],
  infrastructure: ["domain", "application", "infrastructure"],
  http: ["domain", "application", "http"],
  composition: ["domain", "application", "infrastructure", "http", "composition"],
};

const IMPORT_PATTERN =
  /(?:import|export)\s+(?:type\s+)?(?:[^'"\n]*?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

async function listTypeScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listTypeScriptFiles(entryPath)));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(entryPath);
    }
  }
  return files;
}

function layerOf(filePath, serverRoot) {
  const relative = path.relative(serverRoot, filePath).split(path.sep);
  return LAYERS.includes(relative[0]) ? relative[0] : null;
}

function serverTarget(filePath, specifier, serverRoot) {
  if (specifier.startsWith("@/server/")) {
    return path.join(serverRoot, specifier.slice("@/server/".length));
  }
  if (specifier.startsWith(".")) {
    return path.resolve(path.dirname(filePath), specifier);
  }
  return null;
}

export async function checkLayers(root = process.cwd()) {
  const serverRoot = path.join(root, "src", "server");
  const files = await listTypeScriptFiles(serverRoot);
  const violations = [];

  for (const file of files) {
    const sourceLayer = layerOf(file, serverRoot);
    if (sourceLayer === null) {
      continue;
    }
    const content = await readFile(file, "utf8");
    for (const match of content.matchAll(IMPORT_PATTERN)) {
      const specifier = match[1] ?? match[2];
      if (specifier === undefined) {
        continue;
      }
      const target = serverTarget(file, specifier, serverRoot);
      if (target === null) {
        continue;
      }
      const normalizedTarget = target.replaceAll("\\", "/");
      if (normalizedTarget.includes("/infrastructure/testing/") && !sourceLayer.startsWith("test")) {
        violations.push({
          file,
          specifier,
          reason:
            "test fixtures under infrastructure/testing must only be imported by tests",
        });
        continue;
      }
      const targetLayer = LAYERS.find(
        (layer) => normalizedTarget.includes(`/server/${layer}/`),
      );
      if (targetLayer === undefined) {
        continue;
      }
      if (!ALLOWED[sourceLayer].includes(targetLayer)) {
        violations.push({
          file,
          specifier,
          reason: `${sourceLayer} must not import ${targetLayer}`,
        });
      }
    }
  }

  return violations;
}

async function main() {
  const violations = await checkLayers();
  if (violations.length === 0) {
    console.log("Layer check passed.");
    return;
  }
  for (const violation of violations) {
    const relative = path.relative(process.cwd(), violation.file);
    console.error(`${relative}: ${violation.reason} (${violation.specifier})`);
  }
  process.exitCode = 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
