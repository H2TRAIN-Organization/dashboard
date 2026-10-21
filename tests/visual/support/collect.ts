import type { Page } from '@playwright/test';

export interface SnapshotNode {
  tag: string;
  id: string;
  cls: string;
  role: string;
  testid: string;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
}

export interface ChartSnapshot {
  index: number;
  box: { x: number; y: number; w: number; h: number };
  svg: boolean;
  lines: number;
  areas: number;
  bars: number;
  sectors: number;
  dots: number;
  legendItems: number;
  ticks: number;
  texts: number;
}

export interface VisualSnapshot {
  url: string;
  title: string;
  viewport: { width: number; height: number };
  devicePixelRatio: number;
  scroll: { width: number; height: number; clientWidth: number; clientHeight: number };
  bodyTextLength: number;
  textHash: string;
  domHash: string;
  nodeCount: number;
  nodes: SnapshotNode[];
  classes: Record<string, number>;
  charts: ChartSnapshot[];
  headings: Array<{ level: string; text: string; box: { x: number; y: number; w: number; h: number } }>;
  counts: {
    buttons: number;
    links: number;
    inputs: number;
    selects: number;
    tables: number;
    images: number;
    svgs: number;
    canvases: number;
  };
  bodyChildren: Array<{ tag: string; cls: string; box: { x: number; y: number; w: number; h: number } }>;
  fonts: { body: string; heading: string };
  clockNow: number;
  language: string | null;
}

export async function collectVisualSnapshot(page: Page): Promise<VisualSnapshot> {
  return page.evaluate(() => {
    const normalize = (value: string | null | undefined) =>
      (value ?? '').replace(/\s+/g, ' ').trim();

    const round = (value: number) => Math.round(value * 10) / 10;

    const fnv1a = (value: string) => {
      let hash = 0x811c9dc5;
      for (let i = 0; i < value.length; i += 1) {
        hash ^= value.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
      }
      return (hash >>> 0).toString(16).padStart(8, '0');
    };

    const box = (el: Element) => {
      const rect = el.getBoundingClientRect();
      return {
        x: round(rect.left + window.scrollX),
        y: round(rect.top + window.scrollY),
        w: round(rect.width),
        h: round(rect.height),
      };
    };

    const isVisible = (el: Element) => {
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' && el.getClientRects().length > 0;
    };

    const classOf = (el: Element) =>
      Array.from(el.classList)
        .filter((token) => !token.startsWith('__'))
        .sort()
        .join(' ');

    const allElements = Array.from(document.body.querySelectorAll('*')).filter(
      (el) => !el.closest('nextjs-portal') && isVisible(el),
    );

    const nodes: SnapshotNode[] = allElements.map((el) => {
      const tag = el.tagName.toLowerCase();
      const ownText = normalize(
        Array.from(el.childNodes)
          .filter((child) => child.nodeType === Node.TEXT_NODE)
          .map((child) => child.textContent ?? '')
          .join(' '),
      );
      const labelTags = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'button', 'a', 'label', 'option', 'th', 'td']);
      const label = labelTags.has(tag) ? normalize((el as HTMLElement).innerText).slice(0, 180) : '';
      const text = [ownText, label].filter(Boolean).join(' | ').slice(0, 240);
      return {
        tag,
        id: el.id,
        cls: classOf(el),
        role: el.getAttribute('role') ?? '',
        testid: el.getAttribute('data-testid') ?? '',
        ...box(el),
        text,
      };
    });

    const classes: Record<string, number> = {};
    for (const el of allElements) {
      for (const token of Array.from(el.classList)) {
        if (!token.startsWith('__')) classes[token] = (classes[token] ?? 0) + 1;
      }
    }

    const chartNodes = Array.from(document.querySelectorAll('.recharts-responsive-container')).filter(isVisible);
    const charts: ChartSnapshot[] = chartNodes.map((el, index) => ({
      index,
      box: box(el),
      svg: Boolean(el.querySelector('svg.recharts-surface')),
      lines: el.querySelectorAll('path.recharts-line-curve').length,
      areas: el.querySelectorAll('path.recharts-area-area').length,
      bars: el.querySelectorAll('rect.recharts-bar-rectangle').length,
      sectors: el.querySelectorAll('path.recharts-sector').length,
      dots: el.querySelectorAll('.recharts-dot').length,
      legendItems: el.querySelectorAll('.recharts-legend-item').length,
      ticks: el.querySelectorAll('.recharts-cartesian-axis-tick').length,
      texts: el.querySelectorAll('text').length,
    }));

    const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'))
      .filter(isVisible)
      .map((el) => ({
        level: el.tagName.toLowerCase(),
        text: normalize((el as HTMLElement).innerText).slice(0, 240),
        box: box(el),
      }));

    const counts = {
      buttons: document.querySelectorAll('button').length,
      links: document.querySelectorAll('a').length,
      inputs: document.querySelectorAll('input').length,
      selects: document.querySelectorAll('select').length,
      tables: document.querySelectorAll('table').length,
      images: document.querySelectorAll('img').length,
      svgs: document.querySelectorAll('svg').length,
      canvases: document.querySelectorAll('canvas').length,
    };

    const bodyChildren = Array.from(document.body.children)
      .filter(isVisible)
      .map((el) => ({ tag: el.tagName.toLowerCase(), cls: classOf(el), box: box(el) }));

    const skeleton = nodes
      .map((node) => `${node.tag}|${node.id}|${node.cls}|${node.role}|${node.x},${node.y},${node.w},${node.h}`)
      .join('\n');
    const bodyText = normalize(document.body.innerText);

    const bodyStyle = window.getComputedStyle(document.body);
    const headingEl = document.querySelector('h1,h2,h3');
    const headingStyle = headingEl ? window.getComputedStyle(headingEl) : null;

    return {
      url: location.href,
      title: document.title,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      devicePixelRatio: window.devicePixelRatio,
      scroll: {
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
        clientWidth: document.documentElement.clientWidth,
        clientHeight: document.documentElement.clientHeight,
      },
      bodyTextLength: bodyText.length,
      textHash: fnv1a(bodyText),
      domHash: fnv1a(skeleton),
      nodeCount: nodes.length,
      nodes,
      classes,
      charts,
      headings,
      counts,
      bodyChildren,
      fonts: {
        body: bodyStyle.fontFamily,
        heading: headingStyle?.fontFamily ?? '',
      },
      clockNow: Date.now(),
      language: localStorage.getItem('language'),
    };
  });
}
