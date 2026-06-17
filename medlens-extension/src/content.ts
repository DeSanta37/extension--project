import './content.css';
import browser from 'webextension-polyfill';
import {
  buildAdaptedBlocksHtml,
  buildInnerHtml,
  elementToContentBlock,
  extractBlocksFromFragment,
  extractLinksFromNode,
  type ContentBlock,
} from './format-preserve';
import type { ContentCommand, ContentRequest } from './messages';
import { downloadTextAsPdf } from './pdf';
import { sanitizeAdaptedText } from './text-utils';
import type { AdaptationEntry, PageState, TextContext, TextScope } from './types';

interface StoredSelection {
  text: string;
  startContainerPath: number[];
  startOffset: number;
  endContainerPath: number[];
  endOffset: number;
}

interface ElementSnapshot {
  element: Element;
  originalHTML: string;
  originalText: string;
}

interface AdaptationRecord {
  id: string;
  scope: TextScope;
  adaptedText: string;
  adaptedBlocks?: string[];
  originalText: string;
  levelName: string;
  translate: boolean;
  timestamp: number;
  sourceUrl: string;
  isActive: boolean;
  type: 'selection' | 'page';
  wrapper?: HTMLElement;
  anchorElement?: HTMLElement;
  originalFragment?: DocumentFragment;
  elementSnapshots?: ElementSnapshot[];
}

let floatBtn: HTMLButtonElement | null = null;
let historyBtn: HTMLButtonElement | null = null;
let historyPanel: HTMLDivElement | null = null;
let previewModal: HTMLDivElement | null = null;
let savedRange: Range | null = null;
let savedSelection: StoredSelection | null = null;
const adaptations = new Map<string, AdaptationRecord>();
let initialized = false;
let historyPanelOpen = false;
let selectionUpdateTimer: ReturnType<typeof setTimeout> | null = null;

function getMountTarget(): HTMLElement {
  return document.body ?? document.documentElement;
}

function createAdaptationId(): string {
  return `ml-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function previewText(text: string, max = 80): string {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}…`;
}

function toEntry(record: AdaptationRecord): AdaptationEntry {
  return {
    id: record.id,
    scope: record.scope,
    adaptedText: record.adaptedText,
    adaptedBlocks: record.adaptedBlocks,
    originalText: record.originalText,
    levelName: record.levelName,
    translate: record.translate,
    timestamp: record.timestamp,
    preview: previewText(record.adaptedText),
    sourceUrl: record.sourceUrl,
    isActive: record.isActive,
  };
}

function historyStorageKey(): string {
  return `medlensHistory_${location.href}`;
}

async function persistHistory(): Promise<void> {
  const entries = getPageState().adaptations;
  await browser.storage.session.set({
    medlensAdaptationHistory: entries,
    [historyStorageKey()]: entries,
  });
}

async function loadHistoryFromStorage(): Promise<void> {
  const stored = await browser.storage.session.get(['medlensAdaptationHistory', historyStorageKey()]);
  const entries = (stored[historyStorageKey()] ?? stored.medlensAdaptationHistory) as
    | AdaptationEntry[]
    | undefined;
  if (!entries?.length) return;

  for (const entry of entries) {
    if (entry.sourceUrl && entry.sourceUrl !== location.href) continue;
    if (adaptations.has(entry.id)) continue;

    adaptations.set(entry.id, {
      id: entry.id,
      scope: entry.scope,
      adaptedText: entry.adaptedText,
      adaptedBlocks: entry.adaptedBlocks,
      originalText: entry.originalText,
      levelName: entry.levelName,
      translate: entry.translate,
      timestamp: entry.timestamp,
      sourceUrl: entry.sourceUrl || location.href,
      isActive: false,
      type: entry.scope === 'page' ? 'page' : 'selection',
    });
  }

  updateHistoryButton();
}

function createFloatButton(): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.id = 'medlens-float-btn';
  btn.type = 'button';
  btn.setAttribute('aria-label', 'Адаптировать с MedLens');
  btn.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8 12h8M12 8v8"/></svg> MedLens';
  btn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    saveCurrentSelection();
  });
  btn.addEventListener('click', onFloatButtonClick);
  return btn;
}

function createHistoryButton(): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.id = 'medlens-history-btn';
  btn.type = 'button';
  btn.setAttribute('aria-label', 'История адаптаций');
  btn.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8v4l3 3"/><circle cx="12" cy="12" r="9"/></svg> <span class="medlens-history-label">История</span>';
  btn.addEventListener('click', toggleHistoryPanel);
  return btn;
}

function createHistoryPanel(): HTMLDivElement {
  const panel = document.createElement('div');
  panel.id = 'medlens-history-panel';
  panel.innerHTML = `
    <div class="medlens-history-header">
      <span>Адаптации на странице</span>
      <button type="button" class="medlens-history-close" aria-label="Закрыть">✕</button>
    </div>
    <div class="medlens-history-list"></div>
    <button type="button" class="medlens-history-restore-all">Вернуть все оригиналы</button>
  `;
  panel.querySelector('.medlens-history-close')?.addEventListener('click', () => {
    historyPanelOpen = false;
    panel.classList.remove('visible');
  });
  panel.querySelector('.medlens-history-restore-all')?.addEventListener('click', () => {
    restoreAllAdaptations();
    renderHistoryPanel();
  });
  return panel;
}

function getPageState(): PageState {
  return { adaptations: Array.from(adaptations.values()).map(toEntry) };
}

function updateHistoryButton(): void {
  if (!historyBtn) return;
  const count = adaptations.size;
  const activeCount = Array.from(adaptations.values()).filter((r) => r.isActive).length;
  const label = historyBtn.querySelector('.medlens-history-label');
  if (label) {
    label.textContent =
      count > 0 ? `История (${activeCount > 0 ? activeCount : count})` : 'История';
  }
  historyBtn.classList.toggle('visible', count > 0);
}

function toggleHistoryPanel(): void {
  if (!historyPanel) return;
  historyPanelOpen = !historyPanelOpen;
  historyPanel.classList.toggle('visible', historyPanelOpen);
  if (historyPanelOpen) renderHistoryPanel();
}

function renderHistoryPanel(): void {
  if (!historyPanel) return;
  const list = historyPanel.querySelector('.medlens-history-list');
  if (!list) return;

  const entries = Array.from(adaptations.values()).sort((a, b) => b.timestamp - a.timestamp);
  if (entries.length === 0) {
    list.innerHTML = '<p class="medlens-history-empty">Пока нет адаптаций</p>';
    return;
  }

  list.innerHTML = entries
    .map((record) => {
      const time = new Date(record.timestamp).toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit',
      });
      const level = record.translate ? `${record.levelName} + EN→RU` : record.levelName;
      const status = record.isActive ? '' : '<span class="medlens-history-restored"> · восстановлено</span>';
      const actions = record.isActive
        ? `
          <button type="button" class="medlens-btn medlens-action-restore" data-id="${record.id}">Оригинал</button>
          <button type="button" class="medlens-btn medlens-action-pdf" data-id="${record.id}">PDF</button>
        `
        : `
          <button type="button" class="medlens-btn medlens-action-reapply" data-id="${record.id}">Адаптив</button>
          <button type="button" class="medlens-btn medlens-action-view" data-id="${record.id}">Просмотр</button>
          <button type="button" class="medlens-btn medlens-action-pdf" data-id="${record.id}">PDF</button>
        `;
      return `
        <div class="medlens-history-item" data-id="${record.id}">
          <div class="medlens-history-item-preview medlens-history-preview-click" data-id="${record.id}">${escapeHtml(previewText(record.adaptedText, 60))}</div>
          <div class="medlens-history-item-meta">${escapeHtml(level)} · ${time}${status}</div>
          <div class="medlens-history-item-actions">${actions}</div>
        </div>
      `;
    })
    .join('');

  list.querySelectorAll('.medlens-action-restore').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = (btn as HTMLElement).dataset.id;
      if (id) restoreAdaptation(id);
    });
  });

  list.querySelectorAll('.medlens-action-reapply').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = (btn as HTMLElement).dataset.id;
      if (!id) return;
      const ok = reapplyAdaptation(id);
      if (!ok) {
        window.alert('Не удалось вернуть адаптив. Обновите страницу и попробуйте снова.');
      }
    });
  });

  list.querySelectorAll('.medlens-action-view, .medlens-history-preview-click').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = (btn as HTMLElement).dataset.id;
      if (id) showAdaptationPreview(id);
    });
  });

  list.querySelectorAll('.medlens-action-pdf').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = (btn as HTMLElement).dataset.id;
      if (id) void downloadAdaptationPdf(id);
    });
  });
}

function attachBlockToolbar(wrapper: HTMLElement, id: string): void {
  if (wrapper.querySelector('.medlens-block-toolbar')) return;

  const toolbar = document.createElement('span');
  toolbar.className = 'medlens-block-toolbar';
  toolbar.contentEditable = 'false';
  toolbar.innerHTML = `
    <button type="button" class="medlens-btn medlens-block-restore" data-id="${id}">Оригинал</button>
    <button type="button" class="medlens-btn medlens-block-pdf" data-id="${id}">PDF</button>
  `;

  toolbar.querySelector('.medlens-block-restore')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    restoreAdaptation(id);
  });

  toolbar.querySelector('.medlens-block-pdf')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    void downloadAdaptationPdf(id);
  });

  wrapper.appendChild(toolbar);
}

function ensurePreviewModal(): HTMLDivElement {
  if (previewModal) return previewModal;

  previewModal = document.createElement('div');
  previewModal.id = 'medlens-preview-modal';
  previewModal.innerHTML = `
    <div class="medlens-preview-backdrop"></div>
    <div class="medlens-preview-dialog">
      <div class="medlens-preview-header">
        <span>Сохранённая адаптация</span>
        <button type="button" class="medlens-preview-close" aria-label="Закрыть">✕</button>
      </div>
      <div class="medlens-preview-meta"></div>
      <p class="medlens-preview-hint">Текст ниже сохранён в истории. Чтобы снова подставить его на страницу, нажмите «Адаптив».</p>
      <div class="medlens-preview-section">
        <div class="medlens-preview-label">Оригинал</div>
        <div class="medlens-preview-original"></div>
      </div>
      <div class="medlens-preview-section">
        <div class="medlens-preview-label">Адаптив</div>
        <div class="medlens-preview-body"></div>
      </div>
      <div class="medlens-preview-actions">
        <button type="button" class="medlens-btn medlens-preview-pdf">Скачать PDF</button>
      </div>
    </div>
  `;

  previewModal.querySelector('.medlens-preview-close')?.addEventListener('click', closeAdaptationPreview);
  previewModal.querySelector('.medlens-preview-backdrop')?.addEventListener('click', closeAdaptationPreview);
  getMountTarget().appendChild(previewModal);
  return previewModal;
}

function showAdaptationPreview(id: string): void {
  const record = adaptations.get(id);
  if (!record) return;

  const modal = ensurePreviewModal();
  const level = record.translate ? `${record.levelName} + EN→RU` : record.levelName;
  const time = new Date(record.timestamp).toLocaleString('ru-RU');

  const metaEl = modal.querySelector('.medlens-preview-meta');
  const originalEl = modal.querySelector('.medlens-preview-original');
  const bodyEl = modal.querySelector('.medlens-preview-body');
  if (metaEl) {
    metaEl.innerHTML = `${escapeHtml(level)} · ${escapeHtml(time)} · <a href="${escapeHtml(record.sourceUrl)}" target="_blank" rel="noopener">ссылка на страницу</a>`;
  }
  if (originalEl) originalEl.textContent = record.originalText;
  if (bodyEl) bodyEl.textContent = record.adaptedText;

  const pdfBtn = modal.querySelector('.medlens-preview-pdf');
  pdfBtn?.replaceWith(pdfBtn.cloneNode(true));
  modal.querySelector('.medlens-preview-pdf')?.addEventListener('click', () => {
    void downloadAdaptationPdf(id);
  });

  modal.classList.add('visible');
}

function closeAdaptationPreview(): void {
  previewModal?.classList.remove('visible');
}

async function downloadAdaptationPdf(id: string): Promise<void> {
  const record = adaptations.get(id);
  if (!record?.adaptedText?.trim()) return;

  const level = record.translate ? `${record.levelName} + EN→RU` : record.levelName;
  await downloadTextAsPdf(record.adaptedText, `medlens-${id.slice(-8)}.pdf`, {
    level,
    date: new Date(record.timestamp).toLocaleDateString('ru-RU'),
  });
}

function getNodePath(node: Node): number[] {
  const path: number[] = [];
  let current: Node | null = node;

  while (current && current !== document.body) {
    const parent: ParentNode | null = current.parentNode;
    if (!parent) break;
    path.unshift(Array.from(parent.childNodes).indexOf(current as ChildNode));
    current = parent;
  }

  return path;
}

function getNodeByPath(path: number[]): Node | null {
  let current: Node = document.body;

  for (const index of path) {
    if (!current.childNodes[index]) return null;
    current = current.childNodes[index];
  }

  return current;
}

function persistSelection(snapshot: StoredSelection): void {
  savedSelection = snapshot;
  void browser.storage.session.set({ medlensLastSelection: snapshot });
}

async function loadPersistedSelection(): Promise<StoredSelection | null> {
  if (savedSelection?.text?.trim()) return savedSelection;

  const stored = await browser.storage.session.get('medlensLastSelection');
  const last = stored.medlensLastSelection as StoredSelection | undefined;
  if (last?.text?.trim()) {
    savedSelection = last;
    return last;
  }

  return null;
}

function saveCurrentSelection(): boolean {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0 || !selection.toString().trim()) {
    return false;
  }

  const range = selection.getRangeAt(0).cloneRange();

  if (range.commonAncestorContainer instanceof Element) {
    if (range.commonAncestorContainer.closest('.medlens-adapted, [data-medlens-id]')) return false;
  } else if (range.commonAncestorContainer.parentElement?.closest('.medlens-adapted, [data-medlens-id]')) {
    return false;
  }

  savedRange = range;

  persistSelection({
    text: selection.toString(),
    startContainerPath: getNodePath(range.startContainer),
    startOffset: range.startOffset,
    endContainerPath: getNodePath(range.endContainer),
    endOffset: range.endOffset,
  });

  return true;
}

function restoreRangeFromSnapshot(): Range | null {
  if (savedRange) {
    try {
      return savedRange.cloneRange();
    } catch {
      savedRange = null;
    }
  }

  if (!savedSelection) return null;

  const start = getNodeByPath(savedSelection.startContainerPath);
  const end = getNodeByPath(savedSelection.endContainerPath);
  if (!start || !end) return null;

  const range = document.createRange();
  try {
    range.setStart(start, savedSelection.startOffset);
    range.setEnd(end, savedSelection.endOffset);
    return range;
  } catch {
    return null;
  }
}

function collectTextNodes(root: Element): Text[] {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = (node as Text).parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (
        parent.closest(
          '#medlens-float-btn, #medlens-history-btn, #medlens-history-panel, .medlens-adapted, .medlens-block-toolbar, script, style, noscript',
        )
      ) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let current: Node | null;
  while ((current = walker.nextNode())) {
    nodes.push(current as Text);
  }

  return nodes;
}

function rangeFromTextOffsets(textNodes: Text[], start: number, end: number): Range | null {
  let pos = 0;
  let startNode: Text | null = null;
  let startOffset = 0;
  let endNode: Text | null = null;
  let endOffset = 0;

  for (const node of textNodes) {
    const len = node.data.length;
    if (!startNode && pos + len > start) {
      startNode = node;
      startOffset = start - pos;
    }
    if (!endNode && pos + len >= end) {
      endNode = node;
      endOffset = end - pos;
      break;
    }
    pos += len;
  }

  if (!startNode || !endNode) return null;

  const range = document.createRange();
  try {
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
    return range;
  } catch {
    return null;
  }
}

function findFuzzyTextMatch(combined: string, query: string): { start: number; end: number } | null {
  const normalized = query.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;

  for (let start = 0; start < combined.length; start++) {
    let ci = start;
    let qi = 0;

    while (qi < normalized.length) {
      if (ci >= combined.length) break;

      if (/\s/.test(normalized[qi])) {
        if (!/\s/.test(combined[ci])) break;
        while (ci < combined.length && /\s/.test(combined[ci])) ci++;
        qi++;
        while (qi < normalized.length && /\s/.test(normalized[qi])) qi++;
        continue;
      }

      if (combined[ci] !== normalized[qi]) break;
      ci++;
      qi++;
    }

    if (qi === normalized.length) {
      while (ci < combined.length && /\s/.test(combined[ci])) ci++;
      return { start, end: ci };
    }
  }

  return null;
}

function findTextRangeCompact(textNodes: Text[], query: string): Range | null {
  const compactQuery = query.replace(/\s+/g, '');
  if (compactQuery.length < 8) return null;

  let fullCombined = '';
  const charToFullIndex: number[] = [];

  for (const node of textNodes) {
    for (let offset = 0; offset < node.data.length; offset++) {
      const char = node.data[offset];
      fullCombined += char;
      if (!/\s/.test(char)) {
        charToFullIndex.push(fullCombined.length - 1);
      }
    }
  }

  const compactCombined = charToFullIndex.map((fullIdx) => fullCombined[fullIdx]).join('');
  const startCompact = compactCombined.indexOf(compactQuery);
  if (startCompact === -1) return null;

  const endCompact = startCompact + compactQuery.length - 1;
  const startFull = charToFullIndex[startCompact];
  const endFull = charToFullIndex[endCompact] + 1;

  return rangeFromTextOffsets(textNodes, startFull, endFull);
}

function findTextRange(searchText: string): Range | null {
  const query = searchText.trim();
  if (!query) return null;

  const root = getContentRoot();
  const textNodes = collectTextNodes(root);
  const combined = textNodes.map((node) => node.data).join('');

  let startIdx = combined.indexOf(query);
  let endIdx = startIdx === -1 ? -1 : startIdx + query.length;

  if (startIdx === -1) {
    const fuzzy = findFuzzyTextMatch(combined, query);
    if (fuzzy) {
      startIdx = fuzzy.start;
      endIdx = fuzzy.end;
    }
  }

  if (startIdx === -1) {
    return findTextRangeCompact(textNodes, query);
  }

  return rangeFromTextOffsets(textNodes, startIdx, endIdx);
}

function showFloatButton(rect: DOMRect): void {
  if (!floatBtn) return;
  floatBtn.style.top = `${rect.bottom + window.scrollY + 8}px`;
  floatBtn.style.left = `${Math.min(rect.left + window.scrollX, window.innerWidth - 120)}px`;
  floatBtn.classList.add('visible');
}

function hideFloatButton(): void {
  floatBtn?.classList.remove('visible');
}

async function safeRuntimeMessage<T>(message: object): Promise<T | null> {
  try {
    return (await browser.runtime.sendMessage(message)) as T;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (
      msg.includes('Receiving end does not exist') ||
      msg.includes('Extension context invalidated')
    ) {
      return null;
    }
    console.error('[MedLens] runtime.sendMessage error:', err);
    return null;
  }
}

async function onFloatButtonClick(): Promise<void> {
  saveCurrentSelection();
  const persisted = await loadPersistedSelection();
  const text = persisted?.text?.trim() ?? '';
  if (!text) return;

  const context: TextContext = {
    text: text.trim(),
    scope: 'selection',
    charCount: text.trim().length,
    fromSelection: true,
  };

  await safeRuntimeMessage({ type: 'SET_CONTEXT', context });
  hideFloatButton();

  const result = await safeRuntimeMessage<{ ok?: boolean }>({ type: 'OPEN_POPUP' });
  if (!result?.ok) {
    await safeRuntimeMessage({ type: 'OPEN_POPUP_FALLBACK', context });
  }
}

function getContentRoot(): Element {
  return (
    document.querySelector('article') ??
    document.querySelector('main') ??
    document.querySelector('[role="main"]') ??
    document.body
  );
}

function isSkippedElement(el: Element): boolean {
  return Boolean(
    el.closest(
      '#medlens-float-btn, #medlens-history-btn, #medlens-history-panel, nav, footer, header, [role="navigation"], .navbox, .mw-editsection',
    ) ||
      el.hasAttribute('data-medlens-skip') ||
      el.closest('[data-medlens-replaced]'),
  );
}

function getBlockText(el: Element): string {
  if (el.tagName === 'LI') {
    const clone = el.cloneNode(true) as Element;
    clone.querySelectorAll(':scope > ul, :scope > ol').forEach((list) => list.remove());
    return clone.textContent?.trim() ?? '';
  }
  return el.textContent?.trim() ?? '';
}

function getPageBlocks(): { element: Element; text: string; tag: string }[] {
  const root = getContentRoot();
  const selector = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, figcaption';
  const candidates = Array.from(root.querySelectorAll(selector));

  const blocks = candidates
    .filter((el) => {
      if (isSkippedElement(el)) return false;
      if (el.tagName === 'P' && el.closest('li, td, th, blockquote')) return false;
      const text = getBlockText(el);
      return text.length >= 8;
    })
    .map((el) => ({
      element: el,
      text: getBlockText(el),
      tag: el.tagName.toLowerCase(),
    }));

  if (blocks.length > 0) return blocks;

  return Array.from(root.children)
    .filter((el) => !isSkippedElement(el) && (el.textContent?.trim().length ?? 0) >= 8)
    .map((el) => ({
      element: el,
      text: el.textContent?.trim() ?? '',
      tag: el.tagName.toLowerCase(),
    }));
}

function getPageElements(): Element[] {
  return getPageBlocks().map((block) => block.element);
}

function extractPageText(): string {
  return getPageBlocks()
    .map((block) => block.text)
    .join('\n\n');
}

function extractPageBlockTexts(): string[] {
  return getPageBlocks().map((block) => block.text);
}

async function extractSelectionText(): Promise<string> {
  saveCurrentSelection();
  const live = window.getSelection()?.toString().trim();
  if (live) return live;

  const persisted = await loadPersistedSelection();
  return persisted?.text?.trim() ?? savedSelection?.text?.trim() ?? '';
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function resolveAdaptedBlockTexts(
  adaptedBlocks: string[] | undefined,
  adaptedText: string,
  blockCount: number,
  fallbackTexts: string[],
): string[] {
  if (adaptedBlocks?.length === blockCount) {
    return adaptedBlocks.map((part, index) => sanitizeAdaptedText(part) || fallbackTexts[index]);
  }

  const parts = sanitizeAdaptedText(adaptedText)
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (parts.length === blockCount) return parts;
  return fallbackTexts.map((text, index) => parts[index] ?? text);
}

function assignTextToBlock(el: Element, text: string): void {
  const innerHtml = buildInnerHtml(sanitizeAdaptedText(text), elementToContentBlock(el));

  if (el.tagName === 'LI') {
    const nestedLists = Array.from(el.querySelectorAll(':scope > ul, :scope > ol'));
    Array.from(el.childNodes).forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        child.remove();
      } else if (child instanceof Element && !nestedLists.includes(child)) {
        child.remove();
      }
    });

    const content = document.createElement('span');
    content.className = 'medlens-li-content';
    content.innerHTML = innerHtml;

    const firstList = el.querySelector(':scope > ul, :scope > ol');
    if (firstList) el.insertBefore(content, firstList);
    else el.insertBefore(content, el.firstChild);
    return;
  }

  el.innerHTML = innerHtml;
}

function getSelectionBlocksFromRange(): ReturnType<typeof extractBlocksFromFragment> {
  const range = restoreRangeFromSnapshot();
  if (!range) return [];
  return extractBlocksFromFragment(range.cloneContents());
}

function extractSelectionBlockTexts(): string[] {
  saveCurrentSelection();
  const structuralBlocks = getSelectionBlocksFromRange();
  if (structuralBlocks.length > 0) {
    return structuralBlocks.map((block) => block.text);
  }

  const text =
    window.getSelection()?.toString().trim() ||
    savedSelection?.text?.trim() ||
    '';

  if (!text) return [];

  const parts = text.split(/\n\n+/).map((part) => part.trim()).filter(Boolean);
  return parts.length > 1 ? parts : [text];
}

async function applyToSelection(
  adaptedText: string,
  originalText: string | undefined,
  meta: { levelName: string; translate: boolean },
  adaptedBlocks?: string[],
): Promise<{ ok: boolean; id?: string }> {
  await loadPersistedSelection();

  const fallbackOriginal = originalText?.trim() || savedSelection?.text?.trim() || '';
  let range = restoreRangeFromSnapshot();

  if (!range && fallbackOriginal) {
    range = findTextRange(fallbackOriginal);
  }

  if (!range) return { ok: false };

  const id = createAdaptationId();
  const originalFragment = range.cloneContents();
  const structuralBlocks = extractBlocksFromFragment(originalFragment);
  const fallbackText = fallbackOriginal || originalFragment.textContent?.trim() || '';

  if (structuralBlocks.length === 0 && fallbackText) {
    structuralBlocks.push({
      text: fallbackText,
      tag: 'span',
      bold: originalFragment.querySelector('strong, b') !== null,
      boldSegments: [],
      links: extractLinksFromNode(originalFragment),
    });
  }

  const texts = resolveAdaptedBlockTexts(
    adaptedBlocks,
    adaptedText,
    structuralBlocks.length,
    structuralBlocks.map((block) => block.text),
  );

  const wrapper = document.createElement('span');
  wrapper.className = 'medlens-adapted';
  wrapper.setAttribute('data-medlens-id', id);
  wrapper.setAttribute('data-medlens-replaced', 'selection');
  wrapper.innerHTML = buildAdaptedBlocksHtml(structuralBlocks, texts);

  range.deleteContents();
  range.insertNode(wrapper);
  attachBlockToolbar(wrapper, id);

  const record: AdaptationRecord = {
    id,
    scope: 'selection',
    adaptedText: sanitizeAdaptedText(adaptedText),
    adaptedBlocks: texts,
    originalText: fallbackOriginal || originalFragment.textContent || '',
    levelName: meta.levelName,
    translate: meta.translate,
    timestamp: Date.now(),
    sourceUrl: location.href,
    isActive: true,
    type: 'selection',
    wrapper,
    originalFragment: originalFragment.cloneNode(true) as DocumentFragment,
  };

  adaptations.set(id, record);
  savedRange = null;
  await persistHistory();
  updateHistoryButton();
  if (historyPanelOpen) renderHistoryPanel();

  return { ok: true, id };
}

function applyToPage(
  adaptedText: string,
  meta: { levelName: string; translate: boolean },
  adaptedBlocks?: string[],
): { ok: boolean; id?: string } {
  const blocks = getPageBlocks();
  if (blocks.length === 0) return { ok: false };

  const id = createAdaptationId();
  const snapshots: ElementSnapshot[] = blocks.map(({ element }) => ({
    element,
    originalHTML: element.innerHTML,
    originalText: getBlockText(element),
  }));

  let texts: string[];

  if (adaptedBlocks?.length === blocks.length) {
    texts = adaptedBlocks.map((part, index) => sanitizeAdaptedText(part) || blocks[index].text);
  } else {
    const parts = sanitizeAdaptedText(adaptedText)
      .split(/\n\n+/)
      .map((p) => p.trim())
      .filter(Boolean);

    if (parts.length === blocks.length) {
      texts = parts;
    } else if (parts.length === 1 && blocks.length === 1) {
      texts = parts;
    } else {
      texts = blocks.map((_, index) => parts[index] ?? snapshots[index].originalText);
    }
  }

  blocks.forEach(({ element }, index) => {
    element.setAttribute('data-medlens-replaced', 'page');
    element.setAttribute('data-medlens-batch-id', id);
    element.classList.add('medlens-adapted');
    assignTextToBlock(element, texts[index]);
  });

  const record: AdaptationRecord = {
    id,
    scope: 'page',
    adaptedText: texts.join('\n\n'),
    adaptedBlocks: texts,
    originalText: snapshots.map((s) => s.originalText).join('\n\n'),
    levelName: meta.levelName,
    translate: meta.translate,
    timestamp: Date.now(),
    sourceUrl: location.href,
    isActive: true,
    type: 'page',
    elementSnapshots: snapshots,
  };

  adaptations.set(id, record);
  void persistHistory();
  updateHistoryButton();
  if (historyPanelOpen) renderHistoryPanel();

  return { ok: true, id };
}

function getStructuralBlocksForReapply(record: AdaptationRecord, rangeContents?: DocumentFragment): ContentBlock[] {
  if (rangeContents) {
    const blocks = extractBlocksFromFragment(rangeContents);
    if (blocks.length > 0) return blocks;
  }

  if (record.originalFragment) {
    const blocks = extractBlocksFromFragment(record.originalFragment);
    if (blocks.length > 0) return blocks;
  }

  if (record.originalText.trim()) {
    return [
      {
        text: record.originalText.trim(),
        tag: 'span',
        bold: false,
        boldSegments: [],
        links: [],
      },
    ];
  }

  return [];
}

function insertSelectionAdaptation(
  record: AdaptationRecord,
  structuralBlocks: ReturnType<typeof extractBlocksFromFragment>,
  texts: string[],
  target: { type: 'range'; range: Range } | { type: 'anchor'; anchor: HTMLElement },
): HTMLElement {
  const wrapper = document.createElement('span');
  wrapper.className = 'medlens-adapted';
  wrapper.setAttribute('data-medlens-id', record.id);
  wrapper.setAttribute('data-medlens-replaced', 'selection');
  wrapper.innerHTML = buildAdaptedBlocksHtml(structuralBlocks, texts);
  attachBlockToolbar(wrapper, record.id);

  if (target.type === 'anchor') {
    const parent = target.anchor.parentNode;
    if (!parent) throw new Error('anchor detached');
    parent.insertBefore(wrapper, target.anchor);
    target.anchor.remove();
  } else {
    target.range.deleteContents();
    target.range.insertNode(wrapper);
  }

  return wrapper;
}

function restoreSelectionDom(record: AdaptationRecord): void {
  if (!record.wrapper || !record.originalFragment) return;

  const { wrapper, originalFragment } = record;
  const parent = wrapper.parentNode;
  if (!parent) return;

  const anchor = document.createElement('span');
  anchor.setAttribute('data-medlens-anchor', record.id);
  anchor.className = 'medlens-anchor';

  Array.from(originalFragment.childNodes).forEach((node) => {
    anchor.appendChild(node.cloneNode(true));
  });

  parent.insertBefore(anchor, wrapper);
  wrapper.remove();
  record.anchorElement = anchor;
  record.wrapper = undefined;
}

function restorePageDom(record: AdaptationRecord): void {
  record.elementSnapshots?.forEach(({ element, originalHTML }) => {
    element.innerHTML = originalHTML;
    element.removeAttribute('data-medlens-replaced');
    element.removeAttribute('data-medlens-batch-id');
    element.classList.remove('medlens-adapted');
  });
}

function reapplySelection(record: AdaptationRecord): boolean {
  const anchor =
    record.anchorElement?.isConnected
      ? record.anchorElement
      : (document.querySelector(`[data-medlens-anchor="${record.id}"]`) as HTMLElement | null);

  if (anchor) {
    const fragment = document.createDocumentFragment();
    Array.from(anchor.childNodes).forEach((node) => fragment.appendChild(node.cloneNode(true)));
    const blocksFromAnchor = extractBlocksFromFragment(fragment);
    const blocks = blocksFromAnchor.length > 0 ? blocksFromAnchor : getStructuralBlocksForReapply(record, fragment);

    try {
      record.wrapper = insertSelectionAdaptation(
        record,
        blocks,
        resolveAdaptedBlockTexts(
          record.adaptedBlocks,
          record.adaptedText,
          blocks.length,
          blocks.map((block) => block.text),
        ),
        { type: 'anchor', anchor },
      );
      record.anchorElement = undefined;
      record.originalFragment = fragment;
      return true;
    } catch {
      return false;
    }
  }

  const range =
    findTextRange(record.originalText) ??
    (record.originalFragment?.textContent ? findTextRange(record.originalFragment.textContent) : null);

  if (!range) return false;

  const originalFragment = range.cloneContents();
  const structuralBlocks = getStructuralBlocksForReapply(record, originalFragment);
  const resolvedTexts = resolveAdaptedBlockTexts(
    record.adaptedBlocks,
    record.adaptedText,
    structuralBlocks.length,
    structuralBlocks.map((block) => block.text),
  );

  record.wrapper = insertSelectionAdaptation(record, structuralBlocks, resolvedTexts, { type: 'range', range });
  record.originalFragment = originalFragment;
  record.anchorElement = undefined;
  return true;
}

function rebuildPageSnapshots(record: AdaptationRecord): ElementSnapshot[] {
  const parts = record.originalText.split(/\n\n+/).map((part) => part.trim()).filter(Boolean);
  const blocks = getPageBlocks();
  if (parts.length === 0 || blocks.length === 0) return [];

  if (parts.length === blocks.length) {
    return blocks.map((block, index) => ({
      element: block.element,
      originalHTML: block.element.innerHTML,
      originalText: parts[index] ?? block.text,
    }));
  }

  const snapshots: ElementSnapshot[] = [];
  let searchFrom = 0;

  for (const part of parts) {
    let found = -1;
    for (let index = searchFrom; index < blocks.length; index++) {
      const blockText = blocks[index].text;
      if (blockText === part || blockText.replace(/\s+/g, '') === part.replace(/\s+/g, '')) {
        found = index;
        break;
      }
    }
    if (found === -1) return [];
    snapshots.push({
      element: blocks[found].element,
      originalHTML: blocks[found].element.innerHTML,
      originalText: blocks[found].text,
    });
    searchFrom = found + 1;
  }

  return snapshots;
}

function reapplyPage(record: AdaptationRecord): boolean {
  let snapshots = record.elementSnapshots?.filter(({ element }) => element.isConnected) ?? [];

  if (snapshots.length === 0) {
    snapshots = rebuildPageSnapshots(record);
    if (snapshots.length === 0) return false;
    record.elementSnapshots = snapshots;
  }

  const texts = resolveAdaptedBlockTexts(
    record.adaptedBlocks,
    record.adaptedText,
    snapshots.length,
    snapshots.map((snapshot) => snapshot.originalText),
  );

  snapshots.forEach(({ element }, index) => {
    element.setAttribute('data-medlens-replaced', 'page');
    element.setAttribute('data-medlens-batch-id', record.id);
    element.classList.add('medlens-adapted');
    assignTextToBlock(element, texts[index] ?? snapshots[index].originalText);
  });

  return true;
}

function reapplyAdaptation(id: string): boolean {
  const record = adaptations.get(id);
  if (!record || record.isActive) return false;

  const ok = record.type === 'selection' ? reapplySelection(record) : reapplyPage(record);
  if (!ok) return false;

  record.isActive = true;
  void persistHistory();
  updateHistoryButton();
  if (historyPanelOpen) renderHistoryPanel();
  return true;
}

function restoreAdaptation(id: string): boolean {
  const record = adaptations.get(id);
  if (!record || !record.isActive) return false;

  if (record.type === 'selection') {
    restoreSelectionDom(record);
  } else {
    restorePageDom(record);
  }

  record.isActive = false;
  record.wrapper = undefined;
  void persistHistory();
  updateHistoryButton();
  if (historyPanelOpen) renderHistoryPanel();
  return true;
}

function restoreAllAdaptations(): void {
  Array.from(adaptations.values())
    .filter((r) => r.isActive)
    .forEach((r) => restoreAdaptation(r.id));
}

function isSelectionInsideAdapted(range: Range): boolean {
  const ancestor =
    range.commonAncestorContainer instanceof Element
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement;
  return Boolean(ancestor?.closest('.medlens-adapted, [data-medlens-id], .medlens-block-toolbar'));
}

function handleSelectionUpdate(): void {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.toString().trim()) {
    hideFloatButton();
    return;
  }

  if (selection.rangeCount === 0) {
    hideFloatButton();
    return;
  }

  const range = selection.getRangeAt(0);
  if (isSelectionInsideAdapted(range)) {
    hideFloatButton();
    return;
  }

  saveCurrentSelection();

  let rect = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) {
    const rects = range.getClientRects();
    if (rects.length > 0) rect = rects[0];
    else {
      hideFloatButton();
      return;
    }
  }

  showFloatButton(rect);
}

function bindPageEvents(): void {
  const scheduleSelectionUpdate = (): void => {
    if (selectionUpdateTimer) clearTimeout(selectionUpdateTimer);
    selectionUpdateTimer = setTimeout(handleSelectionUpdate, 30);
  };

  document.addEventListener('selectionchange', scheduleSelectionUpdate);

  document.addEventListener('mouseup', (e) => {
    if (
      floatBtn?.contains(e.target as Node) ||
      historyBtn?.contains(e.target as Node) ||
      historyPanel?.contains(e.target as Node) ||
      previewModal?.contains(e.target as Node)
    ) {
      return;
    }
    scheduleSelectionUpdate();
  });

  document.addEventListener('pointerup', (e) => {
    if (
      floatBtn?.contains(e.target as Node) ||
      historyBtn?.contains(e.target as Node) ||
      historyPanel?.contains(e.target as Node)
    ) {
      return;
    }
    scheduleSelectionUpdate();
  });

  document.addEventListener('keyup', (e) => {
    if (e.key === 'Escape') {
      hideFloatButton();
      historyPanelOpen = false;
      historyPanel?.classList.remove('visible');
      closeAdaptationPreview();
    }
  });

  document.addEventListener('scroll', scheduleSelectionUpdate, { passive: true });
}

function initContentScript(): void {
  if (initialized) return;

  const mount = getMountTarget();
  if (!mount) return;

  if (!document.getElementById('medlens-float-btn')) {
    floatBtn = createFloatButton();
    mount.appendChild(floatBtn);
  }

  if (!document.getElementById('medlens-history-btn')) {
    historyBtn = createHistoryButton();
    mount.appendChild(historyBtn);
  }

  if (!document.getElementById('medlens-history-panel')) {
    historyPanel = createHistoryPanel();
    mount.appendChild(historyPanel);
  }

  bindPageEvents();
  void loadPersistedSelection();
  void loadHistoryFromStorage();
  initialized = true;
}

browser.runtime.onMessage.addListener((message: unknown) => {
  const msg = message as ContentCommand | ContentRequest | { type: string };

  if (msg.type === 'GET_PAGE_TEXT') {
    return Promise.resolve({ text: extractPageText() });
  }

  if (msg.type === 'GET_PAGE_BLOCKS') {
    return Promise.resolve({ blocks: extractPageBlockTexts() });
  }

  if (msg.type === 'PING') {
    return Promise.resolve({ ok: true });
  }

  if (msg.type === 'GET_SELECTION_TEXT') {
    return extractSelectionText().then((text) => ({ text }));
  }

  if (msg.type === 'GET_SELECTION_BLOCKS') {
    return loadPersistedSelection().then(() => {
      const blocks = extractSelectionBlockTexts().filter((block) => block.trim().length > 0);
      return { blocks };
    });
  }

  if (msg.type === 'GET_PAGE_STATE') {
    return Promise.resolve(getPageState());
  }

  if (msg.type === 'APPLY_ADAPTED') {
    const { adaptedText, adaptedBlocks, scope, originalText, levelName, translate } = msg as ContentCommand & {
      type: 'APPLY_ADAPTED';
      adaptedText: string;
      adaptedBlocks?: string[];
      scope: TextScope;
      originalText?: string;
      levelName?: string;
      translate?: boolean;
    };

    const meta = {
      levelName: levelName ?? 'Стандарт',
      translate: translate ?? false,
    };

    return (async () => {
      if (scope === 'selection') {
        return applyToSelection(adaptedText, originalText, meta, adaptedBlocks);
      }
      return applyToPage(adaptedText, meta, adaptedBlocks);
    })();
  }

  if (msg.type === 'RESTORE_ORIGINAL') {
    const { id } = msg as { type: 'RESTORE_ORIGINAL'; id?: string };
    if (id) {
      return Promise.resolve({ ok: restoreAdaptation(id) });
    }
    restoreAllAdaptations();
    return Promise.resolve({ ok: true });
  }

  if (msg.type === 'DOWNLOAD_PDF') {
    const { id } = msg as { type: 'DOWNLOAD_PDF'; id: string };
    return downloadAdaptationPdf(id).then(() => ({ ok: true }));
  }

  if (msg.type === 'GET_ADAPTATION') {
    const { id } = msg as { type: 'GET_ADAPTATION'; id: string };
    const record = adaptations.get(id);
    return Promise.resolve(record ? toEntry(record) : null);
  }

  if (msg.type === 'REAPPLY_ADAPTED') {
    const { id } = msg as { type: 'REAPPLY_ADAPTED'; id: string };
    const ok = reapplyAdaptation(id);
    return Promise.resolve(
      ok ? { ok: true } : { ok: false, error: 'Не удалось найти текст на странице для повторной адаптации' },
    );
  }

  return undefined;
});

export function onExecute(): void {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initContentScript, { once: true });
  } else {
    initContentScript();
  }
}

onExecute();
