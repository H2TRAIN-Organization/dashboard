import { expect, test } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { PAGE_DEFINITIONS } from './support/session';

const OUTPUT_DIR = process.env.VISUAL_OUTPUT_DIR || path.resolve(process.cwd(), 'tests/visual/.output');
const SOURCE_ROOT = process.env.VISUAL_SOURCE_ROOT || path.resolve(process.cwd(), '..', 'baseline-ui');

interface JsxElementRecord {
  tag: string;
  className: string | null;
  dynamicClassName: boolean;
  id: string | null;
  type: string | null;
  role: string | null;
  src: string | null;
  line: number;
}

function parseJsx(filePath: string, sourceText: string): { records: JsxElementRecord[]; parseErrors: string[] } {
  const source = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const records: JsxElementRecord[] = [];

  const literal = (attribute: ts.JsxAttribute) => {
    if (!attribute.initializer) return { value: null as string | null, dynamic: false };
    if (ts.isStringLiteral(attribute.initializer)) {
      return { value: attribute.initializer.text, dynamic: false };
    }
    return { value: null, dynamic: true };
  };

  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node;
      const attributes = new Map<string, { value: string | null; dynamic: boolean }>();
      for (const attribute of opening.attributes.properties) {
        if (ts.isJsxAttribute(attribute)) {
          attributes.set(attribute.name.getText(source), literal(attribute));
        }
      }
      const classAttribute = attributes.get('className');
      const { line } = source.getLineAndCharacterOfPosition(opening.getStart(source));
      records.push({
        tag: opening.tagName.getText(source),
        className: classAttribute?.value ?? null,
        dynamicClassName: classAttribute?.dynamic ?? false,
        id: attributes.get('id')?.value ?? null,
        type: attributes.get('type')?.value ?? null,
        role: attributes.get('role')?.value ?? null,
        src: attributes.get('src')?.value ?? null,
        line: line + 1,
      });
    }
    ts.forEachChild(node, visit);
  };

  visit(source);
  return {
    records,
    parseErrors: (source as unknown as { parseDiagnostics?: unknown[] }).parseDiagnostics?.length
      ? [(source as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics.map(String).join('\n')]
      : [],
  };
}

for (const definition of PAGE_DEFINITIONS.filter((page) => page.id === 'login' || page.id === 'app-login')) {
  test(`structural ${definition.id} - ${definition.label}`, async ({ request }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1440', 'structural evidence is viewport-independent');
    testInfo.setTimeout(60_000);
    testInfo.annotations.push({
      type: 'structural-evidence',
      description: 'Independent static JSX evidence for the login pages. Rendered screenshots are compared separately by visual.spec.ts.',
    });

    const relativeSource = path.join('src', 'app', definition.id, 'page.tsx');
    const filePath = path.join(SOURCE_ROOT, relativeSource);
    const sourceText = await fs.readFile(filePath, 'utf8');
    const { records, parseErrors } = parseJsx(filePath, sourceText);

    const response = await request.get(definition.path, { failOnStatusCode: false, maxRedirects: 0 });
    const body = await response.text().catch(() => '');
    const queryStringImage = /\/logo-horizontal\.png\?v=/.test(sourceText);
    const knownCause =
      response.status() === 500 && queryStringImage
        ? 'Legacy next/image uses a query string (/logo-horizontal.png?v=10); a mismatched Next 16 dependency rejects it through images.localPatterns. This is a dependency-version artifact, not proof about the original app.'
        : null;

    const targetDir = path.join(OUTPUT_DIR, 'structural');
    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(
      path.join(targetDir, `${definition.id}.structural.json`),
      JSON.stringify(
        {
          page: definition,
          mode: 'static-jsx-evidence',
          rendered: true,
          sourceRoot: SOURCE_ROOT,
          sourceFile: filePath,
          sourceCommit: process.env.VISUAL_SOURCE_COMMIT ?? null,
          capturedAt: new Date().toISOString(),
          httpProbe: {
            baseURL: testInfo.project.use.baseURL,
            status: response.status(),
            contentType: response.headers()['content-type'] ?? null,
            bodyBytes: Buffer.byteLength(body, 'utf8'),
            knownCause,
          },
          jsx: {
            elementCount: records.length,
            tagCounts: records.reduce<Record<string, number>>((acc, record) => {
              acc[record.tag] = (acc[record.tag] ?? 0) + 1;
              return acc;
            }, {}),
            staticClassCount: records.filter((record) => record.className).length,
            dynamicClassCount: records.filter((record) => record.dynamicClassName).length,
            records,
          },
          parseErrors,
          limitation:
            'Static JSX inspection only. It is independent evidence and cannot prove runtime layout, responsive behavior, styling or pixel equality by itself.',
        },
        null,
        2,
      ),
    );

    expect(records.length, 'login source must contain JSX elements').toBeGreaterThan(0);
    expect(parseErrors, 'TSX must parse').toEqual([]);
  });
}
