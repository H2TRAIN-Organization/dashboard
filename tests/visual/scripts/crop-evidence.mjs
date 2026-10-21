#!/usr/bin/env node
/** Generates labelled side-by-side crops from explicit baseline/candidate/out paths. */
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--baseline') result.baseline = path.resolve(argv[++i]);
    else if (arg === '--candidate') result.candidate = path.resolve(argv[++i]);
    else if (arg === '--out') result.out = path.resolve(argv[++i]);
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node crop-evidence.mjs --baseline DIR --candidate DIR --out DIR');
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  for (const required of ['baseline', 'candidate', 'out']) {
    if (!result[required]) {
      console.error(`Missing required --${required} DIR.\nUsage: node crop-evidence.mjs --baseline DIR --candidate DIR --out DIR`);
      process.exit(2);
    }
  }
  return result;
}

const options = parseArgs(process.argv.slice(2));
const baselineRoot = options.baseline;
const candidateRoot = options.candidate;
const outputRoot = options.out;

const crops = [
  { name: 'home-desktop-metric-cards', project: 'desktop-1440', page: 'home', x: 90, y: 530, w: 1260, h: 760 },
  { name: 'home-mobile-metric-cards', project: 'mobile-375', page: 'home', x: 0, y: 760, w: 375, h: 540 },
  { name: 'admin-desktop-stats', project: 'desktop-1440', page: 'admin', x: 930, y: 140, w: 290, h: 230 },
  { name: 'data-desktop-user-card', project: 'desktop-1440', page: 'data', x: 90, y: 1160, w: 1260, h: 245 },
  { name: 'database-desktop-table-list', project: 'desktop-1440', page: 'database', x: 90, y: 580, w: 1260, h: 1100 },
  { name: 'database-mobile-table-list', project: 'mobile-375', page: 'database', x: 0, y: 1880, w: 375, h: 1450 },
];

function labelSvg(width, height) {
  return Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#0f172a"/>
    <text x="8" y="22" font-family="Segoe UI, Arial" font-size="16" font-weight="700" fill="#ffffff">BASELINE</text>
    <text x="${Math.floor(width / 2) + 8}" y="22" font-family="Segoe UI, Arial" font-size="16" font-weight="700" fill="#ffffff">CANDIDATE</text>
  </svg>`);
}

async function extract(root, crop, side) {
  const file = path.join(root, crop.project, `${crop.page}.png`);
  const meta = await sharp(file).metadata();
  const left = Math.max(0, Math.min(crop.x, (meta.width ?? 1) - 1));
  const top = Math.max(0, Math.min(crop.y, (meta.height ?? 1) - 1));
  const width = Math.min(crop.w, (meta.width ?? 0) - left);
  const height = Math.min(crop.h, (meta.height ?? 0) - top);
  const target = path.join(outputRoot, crop.name, `${side}.png`);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await sharp(file).extract({ left, top, width, height }).toFile(target);
  return { target, width, height };
}

await fs.mkdir(outputRoot, { recursive: true });
const manifest = [];
for (const crop of crops) {
  const baseline = await extract(baselineRoot, crop, 'baseline');
  const candidate = await extract(candidateRoot, crop, 'candidate');
  const width = Math.max(baseline.width, candidate.width);
  const height = Math.max(baseline.height, candidate.height);
  const gap = 20;
  const header = 36;
  const composite = await sharp({
    create: { width: width * 2 + gap, height: height + header, channels: 4, background: '#0f172a' },
  })
    .composite([
      { input: labelSvg(width * 2 + gap, header), left: 0, top: 0 },
      { input: await sharp(baseline.target).toBuffer(), left: 0, top: header },
      { input: await sharp(candidate.target).toBuffer(), left: width + gap, top: header },
    ])
    .png()
    .toFile(path.join(outputRoot, `${crop.name}-side-by-side.png`));
  manifest.push({
    name: crop.name,
    box: { x: crop.x, y: crop.y, w: width, h: height },
    baseline: baseline.target,
    candidate: candidate.target,
    sideBySide: path.join(outputRoot, `${crop.name}-side-by-side.png`),
    width: composite.width,
    height: composite.height,
  });
}

await fs.writeFile(path.join(outputRoot, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`Evidence crops: ${outputRoot}`);
