#!/usr/bin/env node
/**
 * Compares a captured candidate run against the isolated baseline run.
 * Structural snapshots/classes/charts are always compared. Pixel metrics are
 * added when sharp is available. Static JSX login evidence is supplemental,
 * never a substitute for a missing pixel comparison.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

function parseArgs(argv) {
  const result = { pixelThreshold: 0.01, meanAbsThreshold: 4, classThreshold: 0.95 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--baseline') result.baseline = path.resolve(argv[++i]);
    else if (arg === '--candidate') result.candidate = path.resolve(argv[++i]);
    else if (arg === '--out') result.out = path.resolve(argv[++i]);
    else if (arg === '--pixel-threshold') result.pixelThreshold = Number(argv[++i]);
    else if (arg === '--mean-abs-threshold') result.meanAbsThreshold = Number(argv[++i]);
    else if (arg === '--class-threshold') result.classThreshold = Number(argv[++i]);
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node compare.mjs --baseline DIR --candidate DIR --out DIR [--pixel-threshold 0.01] [--class-threshold 0.95]');
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  for (const required of ['baseline', 'candidate', 'out']) {
    if (!result[required]) {
      console.error(`Missing required --${required} DIR.\nUsage: node compare.mjs --baseline DIR --candidate DIR --out DIR`);
      process.exit(2);
    }
  }
  return result;
}

const options = parseArgs(process.argv.slice(2));

function readJson(filePath) {
  return fs.readFile(filePath, 'utf8').then(JSON.parse);
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findSourceCommit(baseDir, projects) {
  for (const project of projects) {
    const projectDir = path.join(baseDir, project);
    if (!(await exists(projectDir))) continue;
    const files = (await fs.readdir(projectDir)).filter((file) => file.endsWith('.network.json')).sort();
    for (const file of files) {
      try {
        const network = await readJson(path.join(projectDir, file));
        if (network?.sourceCommit) return network.sourceCommit;
      } catch {
        // Ignore a malformed network artifact and keep looking.
      }
    }
  }
  return null;
}

function jaccard(left, right) {
  const a = new Set(left);
  const b = new Set(right);
  let intersection = 0;
  for (const value of a) if (b.has(value)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

function classSet(snapshot) {
  return Object.keys(snapshot.classes ?? {});
}

function classSignatureSet(snapshot) {
  return (snapshot.nodes ?? []).map((node) => `${node.tag}.${(node.cls ?? '').split(' ').filter(Boolean).sort().join('.')}`);
}

function layoutSignatureSet(snapshot) {
  return (snapshot.nodes ?? []).map((node) => {
    const cls = (node.cls ?? '').split(' ').filter(Boolean).sort().join('.');
    return `${node.tag}.${cls}|${Math.round(node.w / 4)}x${Math.round(node.h / 4)}`;
  });
}

function chartSummary(snapshot) {
  const charts = snapshot.charts ?? [];
  return {
    chartCount: charts.length,
    lines: charts.reduce((sum, chart) => sum + chart.lines, 0),
    areas: charts.reduce((sum, chart) => sum + chart.areas, 0),
    bars: charts.reduce((sum, chart) => sum + chart.bars, 0),
    sectors: charts.reduce((sum, chart) => sum + chart.sectors, 0),
    dots: charts.reduce((sum, chart) => sum + chart.dots, 0),
    svgCharts: charts.filter((chart) => chart.svg).length,
  };
}

function headingsEqual(left, right) {
  const a = (left.headings ?? []).map((heading) => `${heading.level}:${heading.text}`);
  const b = (right.headings ?? []).map((heading) => `${heading.level}:${heading.text}`);
  return JSON.stringify(a) === JSON.stringify(b);
}

async function pixelDiff(leftPath, rightPath, sharp, diffOutputPath) {
  const [leftMeta, rightMeta] = await Promise.all([sharp(leftPath).metadata(), sharp(rightPath).metadata()]);
  const width = Math.min(leftMeta.width ?? 0, rightMeta.width ?? 0);
  const height = Math.min(leftMeta.height ?? 0, rightMeta.height ?? 0);

  const [left, right] = await Promise.all([
    sharp(leftPath).extract({ left: 0, top: 0, width, height }).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(rightPath).extract({ left: 0, top: 0, width, height }).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);

  const pixels = width * height;
  let mismatched = 0;
  let absoluteDifference = 0;
  const diffData = Buffer.alloc(pixels * 4);
  const cellSize = 48;
  const hotspots = new Map();

  for (let offset = 0; offset < left.data.length; offset += 4) {
    const pixelIndex = offset / 4;
    let pixelMismatch = false;
    let gray = 0;
    for (let channel = 0; channel < 3; channel += 1) {
      const difference = Math.abs(left.data[offset + channel] - right.data[offset + channel]);
      absoluteDifference += difference;
      gray += left.data[offset + channel] / 3;
      if (difference > 16) pixelMismatch = true;
    }

    if (pixelMismatch) {
      mismatched += 1;
      diffData[offset] = 255;
      diffData[offset + 1] = 0;
      diffData[offset + 2] = 200;
      diffData[offset + 3] = 255;

      const x = pixelIndex % width;
      const y = Math.floor(pixelIndex / width);
      const key = `${Math.floor(x / cellSize)}:${Math.floor(y / cellSize)}`;
      hotspots.set(key, (hotspots.get(key) ?? 0) + 1);
    } else {
      const dim = Math.round(gray * 0.35);
      diffData[offset] = dim;
      diffData[offset + 1] = dim;
      diffData[offset + 2] = dim;
      diffData[offset + 3] = 255;
    }
  }

  await sharp(diffData, { raw: { width, height, channels: 4 } }).png().toFile(diffOutputPath);

  const rankedHotspots = Array.from(hotspots.entries())
    .map(([key, count]) => {
      const [cellX, cellY] = key.split(':').map(Number);
      const x = cellX * cellSize;
      const y = cellY * cellSize;
      const w = Math.min(cellSize, width - x);
      const h = Math.min(cellSize, height - y);
      return { x, y, w, h, mismatchedPixels: count, mismatchRatio: count / (w * h) };
    })
    .sort((a, b) => b.mismatchedPixels - a.mismatchedPixels)
    .slice(0, 8);

  return {
    dimensionsMatch: leftMeta.width === rightMeta.width && leftMeta.height === rightMeta.height,
    width: leftMeta.width,
    height: leftMeta.height,
    candidateWidth: rightMeta.width,
    candidateHeight: rightMeta.height,
    widthDelta: (rightMeta.width ?? 0) - (leftMeta.width ?? 0),
    heightDelta: (rightMeta.height ?? 0) - (leftMeta.height ?? 0),
    comparisonWidth: width,
    comparisonHeight: height,
    mismatchRatio: mismatched / pixels,
    meanAbsDiff: absoluteDifference / (pixels * 3),
    hotspots: rankedHotspots,
    diffImage: diffOutputPath,
  };
}

async function writeHotspotCrops(pageResult, sharp, outputDir) {
  if (!pageResult.pixels?.hotspots?.length || !sharp) return [];
  const crops = [];
  const margin = 50;
  for (let index = 0; index < Math.min(3, pageResult.pixels.hotspots.length); index += 1) {
    const spot = pageResult.pixels.hotspots[index];
    const base = `${pageResult.project}--${pageResult.page}--hotspot-${index + 1}`;
    for (const side of ['baseline', 'candidate']) {
      const source = side === 'baseline' ? pageResult.paths.baseline : pageResult.paths.candidate;
      const meta = await sharp(source).metadata();
      const left = Math.max(0, spot.x - margin);
      const top = Math.max(0, spot.y - margin);
      const width = Math.min((meta.width ?? 0) - left, spot.w + margin * 2);
      const height = Math.min((meta.height ?? 0) - top, spot.h + margin * 2);
      if (width <= 0 || height <= 0) continue;
      const target = path.join(outputDir, 'crops', `${base}--${side}.png`);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await sharp(source).extract({ left, top, width, height }).toFile(target);
      crops.push({ hotspot: index + 1, side, file: target, box: { x: left, y: top, w: width, h: height } });
    }
  }
  return crops;
}

function networkHasViolations(network) {
  const state = network?.state ?? {};
  return (state.unmocked?.length ?? 0) > 0 || (state.writeAttempts?.length ?? 0) > 0 || (state.external?.length ?? 0) > 0;
}

async function compareRenderedPage(project, pageName, sharp, warnings) {
  const baselineDir = path.join(options.baseline, project);
  const candidateDir = path.join(options.candidate, project);
  const baselineSnapshot = await readJson(path.join(baselineDir, `${pageName}.snapshot.json`));
  const candidateSnapshot = await readJson(path.join(candidateDir, `${pageName}.snapshot.json`));
  const baselineNetwork = await readJson(path.join(baselineDir, `${pageName}.network.json`));
  const candidateNetwork = await readJson(path.join(candidateDir, `${pageName}.network.json`));

  const paths = {
    baseline: path.join(baselineDir, `${pageName}.png`),
    candidate: path.join(candidateDir, `${pageName}.png`),
  };
  const diffDir = path.join(options.out, 'diffs');
  await fs.mkdir(diffDir, { recursive: true });

  let pixels = null;
  if (sharp) {
    try {
      pixels = await pixelDiff(
        paths.baseline,
        paths.candidate,
        sharp,
        path.join(diffDir, `${project}--${pageName}.diff.png`),
      );
    } catch (error) {
      warnings.push(`${project}/${pageName}: pixel comparison failed: ${error.message}`);
    }
  } else {
    warnings.push(`${project}/${pageName}: sharp unavailable, pixel comparison skipped`);
  }

  const classJaccard = jaccard(classSet(baselineSnapshot), classSet(candidateSnapshot));
  const classSignatureJaccard = jaccard(classSignatureSet(baselineSnapshot), classSignatureSet(candidateSnapshot));
  const layoutJaccard = jaccard(layoutSignatureSet(baselineSnapshot), layoutSignatureSet(candidateSnapshot));
  const baselineCharts = chartSummary(baselineSnapshot);
  const candidateCharts = chartSummary(candidateSnapshot);
  const chartsEqual = JSON.stringify(baselineCharts) === JSON.stringify(candidateCharts);
  const textEqual = baselineSnapshot.textHash === candidateSnapshot.textHash;
  const headingsMatch = headingsEqual(baselineSnapshot, candidateSnapshot);
  const nodeDelta = candidateSnapshot.nodeCount - baselineSnapshot.nodeCount;
  const networkClean = !networkHasViolations(baselineNetwork) && !networkHasViolations(candidateNetwork);

  const pixelPass =
    pixels !== null &&
    pixels.dimensionsMatch &&
    pixels.mismatchRatio <= options.pixelThreshold &&
    pixels.meanAbsDiff <= options.meanAbsThreshold;
  const structuralPass = classJaccard >= options.classThreshold && chartsEqual && headingsMatch && textEqual;
  const pass = pixelPass && structuralPass && networkClean;

  const reasons = [];
  if (!pixels) reasons.push('pixel proof unavailable');
  else if (!pixels.dimensionsMatch) reasons.push(`screenshot dimensions differ (${pixels.widthDelta >= 0 ? '+' : ''}${pixels.widthDelta}w / ${pixels.heightDelta >= 0 ? '+' : ''}${pixels.heightDelta}h)`);
  else if (!pixelPass) reasons.push('pixel ratio/mean diff above threshold');
  if (classJaccard < options.classThreshold) reasons.push('CSS class Jaccard below threshold');
  if (!chartsEqual) reasons.push('chart primitive counts differ');
  if (!headingsMatch) reasons.push('heading text differs');
  if (!textEqual) reasons.push('normalized text hash differs');
  if (!networkClean) reasons.push('unmocked API, write attempt or external request recorded');

  const result = {
    project,
    page: pageName,
    verdict: pass ? 'PASS' : 'REVIEW',
    reasons,
    paths,
    pixels,
    dom: {
      baselineNodes: baselineSnapshot.nodeCount,
      candidateNodes: candidateSnapshot.nodeCount,
      nodeDelta,
      classJaccard,
      classSignatureJaccard,
      layoutJaccard,
      textEqual,
      headingsMatch,
      bodyTextLength: [baselineSnapshot.bodyTextLength, candidateSnapshot.bodyTextLength],
      scroll: { baseline: baselineSnapshot.scroll, candidate: candidateSnapshot.scroll },
    },
    charts: { baseline: baselineCharts, candidate: candidateCharts, equal: chartsEqual },
    networkClean,
  };
  result.crops = await writeHotspotCrops(result, sharp, options.out).catch((error) => {
    warnings.push(`${project}/${pageName}: crop generation failed: ${error.message}`);
    return [];
  });
  return result;
}

async function compareStructuralPages() {
  const baselineStructuralDir = path.join(options.baseline, 'structural');
  const candidateStructuralDir = path.join(options.candidate, 'structural');
  if (!(await exists(baselineStructuralDir))) return [];

  const files = (await fs.readdir(baselineStructuralDir)).filter((file) => file.endsWith('.structural.json'));
  const results = [];

  for (const file of files) {
    const candidateFile = path.join(candidateStructuralDir, file);
    if (!(await exists(candidateFile))) {
      results.push({ file, verdict: 'MISSING', reason: 'candidate structural snapshot missing' });
      continue;
    }
    const baseline = await readJson(path.join(baselineStructuralDir, file));
    const candidate = await readJson(candidateFile);
    const baselineRecords = baseline.jsx?.records ?? [];
    const candidateRecords = candidate.jsx?.records ?? [];
    const staticClasses = (records) => records.flatMap((record) => (record.className ?? '').split(/\s+/).filter(Boolean));
    const classJaccard = jaccard(staticClasses(baselineRecords), staticClasses(candidateRecords));
    const tagCountsEqual = JSON.stringify(baseline.jsx?.tagCounts ?? {}) === JSON.stringify(candidate.jsx?.tagCounts ?? {});
    const elementCountEqual = baseline.jsx?.elementCount === candidate.jsx?.elementCount;
    const pass = tagCountsEqual && elementCountEqual && classJaccard >= options.classThreshold;
    results.push({
      file,
      page: baseline.page?.id,
      verdict: pass ? 'STRUCTURAL MATCH (independent evidence)' : 'REVIEW',
      baselineHttpStatus: baseline.httpProbe?.status,
      candidateHttpStatus: candidate.httpProbe?.status,
      baselineElements: baseline.jsx?.elementCount,
      candidateElements: candidate.jsx?.elementCount,
      classJaccard,
      tagCountsEqual,
      elementCountEqual,
      limitation: 'Static JSX evidence only. Visual/pixel verdict is reported separately in the rendered table when both sides rendered.',
    });
  }
  return results;
}

async function main() {
  const warnings = [];
  let sharp = null;
  try {
    strict: {
      const imported = await import('sharp');
      sharp = imported.default ?? imported;
    }
  } catch (error) {
    warnings.push(`sharp import failed: ${error.message}`);
  }

  if (!(await exists(options.baseline))) throw new Error(`Baseline directory not found: ${options.baseline}`);
  if (!(await exists(options.candidate))) throw new Error(`Candidate directory not found: ${options.candidate}`);

  const projectEntries = await fs.readdir(options.baseline, { withFileTypes: true });
  const projects = projectEntries
    .filter((entry) => entry.isDirectory() && entry.name !== 'structural' && entry.name !== '_test-results')
    .map((entry) => entry.name)
    .sort();

  const renderedResults = [];
  for (const project of projects) {
    const files = (await fs.readdir(path.join(options.baseline, project)))
      .filter((file) => file.endsWith('.png') && !file.endsWith('.blocked.png'))
      .sort();
    for (const file of files) {
      const pageName = file.replace(/\.png$/, '');
      const candidatePng = path.join(options.candidate, project, file);
      if (!(await exists(candidatePng))) {
        renderedResults.push({ project, page: pageName, verdict: 'MISSING', reasons: ['candidate screenshot missing'] });
        continue;
      }
      try {
        renderedResults.push(await compareRenderedPage(project, pageName, sharp, warnings));
      } catch (error) {
        renderedResults.push({ project, page: pageName, verdict: 'ERROR', reasons: [error.message] });
      }
    }
  }

  const structuralResults = await compareStructuralPages();
  const renderedPass = renderedResults.length > 0 && renderedResults.every((result) => result.verdict === 'PASS');
  const overall = renderedPass && structuralResults.every((result) => result.verdict.includes('MATCH')) ? 'PASS' : 'REVIEW';
  const report = {
    generatedAt: new Date().toISOString(),
    baseline: options.baseline,
    candidate: options.candidate,
    thresholds: {
      pixelMismatchRatio: options.pixelThreshold,
      meanAbsDiff: options.meanAbsThreshold,
      classJaccard: options.classThreshold,
    },
    baselineSourceCommit: await findSourceCommit(options.baseline, projects),
    overall,
    renderedResults,
    structuralResults,
    warnings,
    disclaimer:
      'PASS means measured similarity for pages rendered on both sides. Static JSX records are independent evidence and never substitute for a missing pixel comparison. No pixel equivalence is claimed for any page that did not render on either side.',
  };

  await fs.mkdir(options.out, { recursive: true });
  await fs.writeFile(path.join(options.out, 'comparison.json'), JSON.stringify(report, null, 2));

  const lines = [
    '# T-013 visual comparison',
    '',
    `- Baseline: \`${options.baseline}\``,
    `- Candidate: \`${options.candidate}\``,
    `- Overall: **${overall}**`,
    `- Generated: ${report.generatedAt}`,
    '',
    '| Project | Page | Verdict | Pixel mismatch (overlap) | Height delta | Mean abs | Class Jaccard | Layout Jaccard | Charts | Network clean | Reasons |',
    '|---|---|---|---:|---:|---:|---:|---:|---|---|---|',
  ];

  for (const result of renderedResults) {
    const pixel = result.pixels;
    lines.push(
      `| ${result.project} | ${result.page} | ${result.verdict} | ${pixel?.mismatchRatio != null ? (pixel.mismatchRatio * 100).toFixed(3) + '%' : 'n/a'} | ${pixel?.heightDelta != null ? (pixel.heightDelta >= 0 ? '+' : '') + pixel.heightDelta + 'px' : 'n/a'} | ${pixel?.meanAbsDiff != null ? pixel.meanAbsDiff.toFixed(3) : 'n/a'} | ${result.dom?.classJaccard != null ? result.dom.classJaccard.toFixed(4) : 'n/a'} | ${result.dom?.layoutJaccard != null ? result.dom.layoutJaccard.toFixed(4) : 'n/a'} | ${result.charts?.equal ?? 'n/a'} | ${result.networkClean ?? 'n/a'} | ${(result.reasons ?? []).join('; ') || '-'} |`,
    );
  }

  const evidenceRows = renderedResults.filter((result) => result.verdict !== 'PASS' && result.pixels?.diffImage);
  if (evidenceRows.length > 0) {
    lines.push('', '## Pixel evidence', '');
    for (const result of evidenceRows) {
      const crops = (result.crops ?? []).map((crop) => crop.file).join(', ');
      lines.push(`- ${result.project}/${result.page}: diff \`${result.pixels.diffImage}\`${crops ? `; crops: ${crops}` : ''}`);
    }
  }

  lines.push('', '## Structural-only legacy pages', '');
  for (const result of structuralResults) {
    lines.push(`- ${result.page ?? result.file}: **${result.verdict}** (baseline HTTP ${result.baselineHttpStatus}, candidate HTTP ${result.candidateHttpStatus}, class Jaccard ${result.classJaccard?.toFixed?.(4) ?? 'n/a'}). ${result.limitation ?? result.reason ?? ''}`);
  }

  if (warnings.length) {
    lines.push('', '## Warnings', '', ...warnings.map((warning) => `- ${warning}`));
  }

  lines.push('', '## Limitations', '', report.disclaimer);
  await fs.writeFile(path.join(options.out, 'comparison.md'), `${lines.join('\n')}\n`);

  console.log(`Overall: ${overall}`);
  console.log(`Report: ${path.join(options.out, 'comparison.md')}`);
  if (overall !== 'PASS') process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
