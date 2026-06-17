export interface LinkInfo {
  href: string;
  text: string;
}

export interface ContentBlock {
  text: string;
  tag: string;
  bold: boolean;
  boldSegments: string[];
  links: LinkInfo[];
}

export function extractLinksFromNode(node: DocumentFragment | Element): LinkInfo[] {
  const container = document.createElement('div');
  container.appendChild(node.cloneNode(true));
  return Array.from(container.querySelectorAll('a[href]'))
    .map((anchor) => ({
      href: (anchor as HTMLAnchorElement).href,
      text: anchor.textContent?.trim() ?? '',
    }))
    .filter((link) => link.text.length > 0);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getLiText(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll(':scope > ul, :scope > ol').forEach((list) => list.remove());
  return clone.textContent?.trim() ?? '';
}

export function getBlockTextFromElement(el: Element): string {
  if (el.tagName === 'LI') return getLiText(el);
  return el.textContent?.trim() ?? '';
}

function extractBoldSegments(el: Element): string[] {
  const segments = new Set<string>();
  el.querySelectorAll('strong, b').forEach((node) => {
    const text = node.textContent?.trim();
    if (text && text.length > 1) segments.add(text);
  });
  return Array.from(segments).sort((a, b) => b.length - a.length);
}

function hasSignificantBold(el: Element): boolean {
  const full = el.textContent?.trim() ?? '';
  if (!full) return false;
  const boldText = extractBoldSegments(el).join(' ');
  return boldText.length >= full.length * 0.4;
}

export function elementToContentBlock(el: Element): ContentBlock {
  const tag = el.tagName.toLowerCase();
  const isHeading = /^h[1-6]$/.test(tag);

  return {
    text: getBlockTextFromElement(el),
    tag,
    bold: isHeading || hasSignificantBold(el),
    boldSegments: extractBoldSegments(el),
    links: extractLinksFromNode(el),
  };
}

export function extractBlocksFromFragment(fragment: DocumentFragment): ContentBlock[] {
  const container = document.createElement('div');
  container.appendChild(fragment.cloneNode(true));

  const blockSelector = 'h1,h2,h3,h4,h5,h6,p,li,blockquote,figcaption';
  const all = Array.from(container.querySelectorAll(blockSelector));

  const topLevel = all.filter((el) => {
    const parent = el.parentElement;
    if (!parent || parent === container) return true;
    return !parent.closest(blockSelector);
  });

  if (topLevel.length > 0) {
    return topLevel.map((el) => elementToContentBlock(el));
  }

  const text = container.textContent?.trim() ?? '';
  if (!text) return [];

  const parts = text.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length > 1) {
    return parts.map((part) => ({
      text: part,
      tag: 'p',
      bold: false,
      boldSegments: [],
      links: [],
    }));
  }

  return [
    {
      text,
      tag: 'span',
      bold: container.querySelector('strong, b') !== null,
      boldSegments: extractBoldSegments(container),
      links: extractLinksFromNode(container),
    },
  ];
}

function reapplyBoldSegments(html: string, segments: string[]): string {
  let result = html;
  for (const segment of segments) {
    const escaped = escapeHtml(segment);
    if (!escaped || result.includes(`<strong>${escaped}</strong>`)) continue;
    if (result.includes(escaped)) {
      result = result.replace(escaped, `<strong>${escaped}</strong>`);
    }
  }
  return result;
}

export function buildInnerHtml(text: string, block: ContentBlock): string {
  const clean = text.trim();
  let html =
    block.links.length > 0 ? mergeLinksIntoHtml(clean, block.links) : escapeHtml(clean).replace(/\n/g, ' ');

  if (block.boldSegments.length > 0) {
    html = reapplyBoldSegments(html, block.boldSegments);
  }

  if (block.bold && !html.includes('<strong>')) {
    html = `<strong>${html}</strong>`;
  }

  return html;
}

export function mergeLinksIntoHtml(text: string, links: LinkInfo[]): string {
  if (links.length === 0) return escapeHtml(text).replace(/\n/g, ' ');

  let html = escapeHtml(text);
  const sorted = [...links].sort((a, b) => b.text.length - a.text.length);

  for (const link of sorted) {
    const escaped = escapeHtml(link.text);
    const safeHref = escapeHtml(link.href);
    const anchor = `<a href="${safeHref}" class="medlens-preserved-link" target="_blank" rel="noopener">${escaped}</a>`;
    if (html.includes(escaped)) {
      html = html.replace(escaped, anchor);
    }
  }

  return html.replace(/\n/g, ' ');
}

export function wrapBlockHtml(innerHtml: string, tag: string): string {
  if (tag === 'span') return innerHtml;
  return `<${tag}>${innerHtml}</${tag}>`;
}

export function buildAdaptedBlocksHtml(blocks: ContentBlock[], texts: string[]): string {
  return blocks
    .map((block, index) => {
      const inner = buildInnerHtml(texts[index] ?? block.text, block);
      if (block.tag === 'span') return inner;
      return wrapBlockHtml(inner, block.tag);
    })
    .join('');
}
