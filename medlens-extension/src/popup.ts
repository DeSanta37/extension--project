import browser from 'webextension-polyfill';
import { sendMessage } from 'webext-bridge/popup';
import { downloadTextAsPdf } from './pdf';
import {
  asJson,
  fromJson,
  type AdaptationEntry,
  type AdaptLevel,
  type AdaptResult,
  type PageState,
  type TextContext,
} from './types';

const levelNames: Record<string, string> = {
  '1': 'Лёгкий',
  '2': 'Стандарт',
  '3': 'Глубокий',
};

const levelDescriptions: Record<
  number,
  { title: string; description: string; features: string[] }
> = {
  1: {
    title: 'Уровень 1: Лёгкий',
    description:
      'Максимально упрощённый вариант для быстрого понимания материала. Подходит для студентов 1-2 курса.',
    features: [
      'Сложные термины заменены на простые аналоги',
      'Длинные предложения разбиты на короткие',
      'Добавлены пояснения к ключевым понятиям',
      'Убраны второстепенные детали',
      'Акцент на основных фактах и выводах',
    ],
  },
  2: {
    title: 'Уровень 2: Стандарт',
    description:
      'Баланс между точностью и доступностью. Терминология сохранена с краткими пояснениями.',
    features: [
      'Профессиональные термины сохранены с пояснениями',
      'Улучшена логическая структура текста',
      'Выделены ключевые взаимосвязи',
      'Сохранены важные клинические детали',
      'Оптимально для подготовки к экзаменам',
    ],
  },
  3: {
    title: 'Уровень 3: Глубокий',
    description:
      'Полное сохранение профессиональной лексики с улучшением читаемости.',
    features: [
      'Вся профессиональная терминология сохранена',
      'Улучшена структура и навигация по тексту',
      'Добавлены логические связки и переходы',
      'Подчеркнуты причинно-следственные связи',
      'Подходит для клинической практики и исследований',
    ],
  },
};

let currentContext: TextContext | null = null;
let lastResult: AdaptResult | null = null;
let lastAdaptationId: string | null = null;
let viewAdaptationId: string | null = null;

function showScreen(screenNum: number): void {
  document.querySelectorAll('.screen').forEach((el) => el.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach((el) => el.classList.remove('active'));

  const screenId =
    screenNum === 3 ? 'screen-3' : screenNum === 0 ? 'screen-error' : `screen-${screenNum}`;
  document.getElementById(screenId)?.classList.add('active');

  const navIndex = screenNum === 0 ? 2 : screenNum - 1;
  document.querySelectorAll('.nav-item')[navIndex]?.classList.add('active');
}

function updateCharCounter(count: number): void {
  const el = document.getElementById('char-count');
  if (el) el.textContent = `${count} символов`;
}

async function loadContext(): Promise<void> {
  const stored = await browser.storage.session.get('openIntent');
  const openIntent = stored.openIntent as string | undefined;
  const ctx = fromJson<TextContext | null>(await sendMessage('get-context', {}, 'background'));

  if (openIntent === 'selection' && ctx?.text) {
    currentContext = ctx;
    updateCharCounter(ctx.charCount);
    showScreen(2);
    await browser.storage.session.remove('openIntent');
    return;
  }

  await sendMessage('clear-context', {}, 'background');
  currentContext = null;
  showScreen(1);
}

async function getPageTextFromTab(): Promise<string> {
  try {
    const result = (await browser.runtime.sendMessage({ type: 'GET_TAB_PAGE_TEXT' })) as {
      text?: string;
    };
    return result?.text ?? '';
  } catch {
    return '';
  }
}

async function saveSourceTabId(): Promise<void> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    await browser.storage.session.set({ medlensSourceTabId: tab.id });
  }
}

async function getSelectionFromTab(): Promise<string> {
  try {
    const stored = await browser.storage.session.get(['pendingContext', 'medlensLastSelection']);
    const pending = stored.pendingContext as TextContext | undefined;
    if (pending?.text?.trim()) return pending.text.trim();

    const last = stored.medlensLastSelection as { text?: string } | undefined;
    if (last?.text?.trim()) return last.text.trim();

    const result = (await browser.runtime.sendMessage({ type: 'GET_TAB_SELECTION' })) as {
      text?: string;
    };
    return result?.text?.trim() ?? '';
  } catch {
    return '';
  }
}

async function startAdaptation(scope: 'selection' | 'page'): Promise<void> {
  await saveSourceTabId();
  let text = '';

  if (scope === 'selection' && currentContext?.text) {
    text = currentContext.text;
  } else if (scope === 'page') {
    text = await getPageTextFromTab();
  }

  if (!text.trim()) {
    showError('Текст не найден. Выделите фрагмент или откройте страницу с текстом.');
    return;
  }

  currentContext = {
    text: text.trim(),
    scope,
    charCount: text.trim().length,
    fromSelection: scope === 'selection',
  };

  updateCharCounter(currentContext.charCount);
  showScreen(2);
  closeAdaptModal();
}

async function runAdaptation(): Promise<void> {
  if (!currentContext?.text) {
    showError('Нет текста для адаптации.');
    return;
  }

  await saveSourceTabId();

  const level = Number(
    (document.querySelector('input[name="level"]:checked') as HTMLInputElement)?.value ?? '1',
  ) as AdaptLevel;

  const translate = (document.getElementById('translate-toggle') as HTMLInputElement)?.checked ?? false;

  const levelName = levelNames[String(level)];
  const levelEl = document.getElementById('selected-level');
  if (levelEl) levelEl.textContent = translate ? `${levelName} + EN→RU` : levelName;

  document.querySelectorAll('.screen').forEach((el) => el.classList.remove('active'));
  document.getElementById('screen-loading')?.classList.add('active');
  document.querySelectorAll('.nav-item').forEach((el) => el.classList.remove('active'));
  document.querySelectorAll('.nav-item')[1]?.classList.add('active');

  const loadingSub = document.querySelector('#screen-loading .loading-sub');
  if (loadingSub) {
    loadingSub.textContent =
      currentContext.scope === 'page'
        ? 'Страница обрабатывается по частям. Это может занять 1–3 минуты'
        : 'Обычно это занимает 3-15 секунд';
  }

  const startTime = Date.now();

  try {
    const result = fromJson<AdaptResult>(
      await sendMessage(
        'adapt-text',
        asJson({
          text: currentContext.text,
          level,
          translate,
          scope: currentContext.scope,
        }),
        'background',
      ),
    );

    lastResult = result;
    lastAdaptationId = result.adaptationId ?? null;

    const durationSec = Math.max(1, Math.round(result.durationMs / 1000));
    const durationEl = document.getElementById('stat-duration');
    const charsEl = document.getElementById('stat-chars');

    if (durationEl) durationEl.textContent = `${durationSec} сек.`;
    if (charsEl) charsEl.textContent = `${result.charsChanged} символов`;
    if (levelEl) {
      levelEl.textContent = result.translate
        ? `${result.levelName} + EN→RU`
        : result.levelName;
    }

    document.getElementById('screen-loading')?.classList.remove('active');
    showScreen(3);
    document.querySelectorAll('.nav-item').forEach((el) => el.classList.remove('active'));
    document.querySelectorAll('.nav-item')[2]?.classList.add('active');
    await renderHistoryList();
  } catch (err) {
    document.getElementById('screen-loading')?.classList.remove('active');
    const message = err instanceof Error ? err.message : 'Неизвестная ошибка';
    showError(message);
    console.error('Adaptation failed:', err, 'after', Date.now() - startTime, 'ms');
  }
}

function showError(message: string): void {
  const el = document.getElementById('error-message');
  if (el) el.textContent = message;
  showScreen(0);
}

async function getPageState(): Promise<PageState> {
  const state = fromJson<PageState>(await sendMessage('get-page-state', {}, 'background'));
  return state ?? { adaptations: [] };
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

async function renderHistoryList(): Promise<void> {
  const listEl = document.getElementById('history-list');
  const sectionEl = document.getElementById('history-section');
  if (!listEl || !sectionEl) return;

  const state = await getPageState();
  const entries = state.adaptations ?? [];

  if (entries.length === 0) {
    sectionEl.style.display = 'none';
    return;
  }

  sectionEl.style.display = 'block';
  listEl.innerHTML = entries
    .sort((a, b) => b.timestamp - a.timestamp)
    .map((entry) => {
      const restoredBadge = entry.isActive
        ? ''
        : '<span class="history-restored-badge"> · восстановлено</span>';
      const actions = entry.isActive
        ? `
          <button type="button" class="btn btn-inline history-btn-restore" data-id="${entry.id}">Оригинал</button>
          <button type="button" class="btn btn-inline history-btn-pdf" data-id="${entry.id}">PDF</button>
        `
        : `
          <button type="button" class="btn btn-inline history-btn-reapply" data-id="${entry.id}">Адаптив</button>
          <button type="button" class="btn btn-inline history-btn-view" data-id="${entry.id}">Просмотр</button>
          <button type="button" class="btn btn-inline history-btn-pdf" data-id="${entry.id}">PDF</button>
        `;
      return `
      <div class="history-item" data-id="${entry.id}">
        <div class="history-item-preview history-preview-click" data-id="${entry.id}">${escapeHtml(entry.preview)}</div>
        <div class="history-item-meta">${escapeHtml(entry.translate ? `${entry.levelName} + EN→RU` : entry.levelName)} · ${formatTime(entry.timestamp)}${restoredBadge}</div>
        <div class="history-item-actions">${actions}</div>
      </div>
    `;
    })
    .join('');

  listEl.querySelectorAll('.history-btn-restore').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = (btn as HTMLElement).dataset.id;
      if (id) await restoreAdaptationById(id);
    });
  });

  listEl.querySelectorAll('.history-btn-reapply').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = (btn as HTMLElement).dataset.id;
      if (id) await reapplyAdaptationById(id);
    });
  });

  listEl.querySelectorAll('.history-btn-view, .history-preview-click').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = (btn as HTMLElement).dataset.id;
      if (id) await openAdaptView(id);
    });
  });

  listEl.querySelectorAll('.history-btn-pdf').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = (btn as HTMLElement).dataset.id;
      if (id) await downloadPdfById(id);
    });
  });
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function openAdaptView(id: string): Promise<void> {
  const state = await getPageState();
  const entry = findEntry(state.adaptations, id);
  if (!entry) return;

  viewAdaptationId = id;
  const titleEl = document.getElementById('adapt-view-title');
  const metaEl = document.getElementById('adapt-view-meta');
  const originalEl = document.getElementById('adapt-view-original');
  const textEl = document.getElementById('adapt-view-text');

  if (titleEl) titleEl.textContent = 'Сохранённая адаптация';
  if (metaEl) {
    const level = entry.translate ? `${entry.levelName} + EN→RU` : entry.levelName;
    const date = new Date(entry.timestamp).toLocaleString('ru-RU');
    metaEl.innerHTML = `${escapeHtml(level)} · ${escapeHtml(date)}${entry.sourceUrl ? ` · <a href="${escapeHtml(entry.sourceUrl)}" target="_blank" rel="noopener">ссылка</a>` : ''}`;
  }
  if (originalEl) originalEl.textContent = entry.originalText;
  if (textEl) textEl.textContent = entry.adaptedText;

  document.getElementById('adapt-view-overlay')?.classList.add('active');
}

async function reapplyAdaptationById(id: string): Promise<void> {
  const result = (await browser.runtime.sendMessage({ type: 'REAPPLY_ADAPTED', id })) as {
    ok?: boolean;
    error?: string;
  };

  if (result?.ok) {
    lastAdaptationId = id;
    await renderHistoryList();
    return;
  }

  showError(
    result?.error ??
      'Не удалось вернуть адаптив на страницу. Обновите вкладку и попробуйте снова.',
  );
}

function closeAdaptView(): void {
  viewAdaptationId = null;
  document.getElementById('adapt-view-overlay')?.classList.remove('active');
}

async function downloadPdfFromView(): Promise<void> {
  if (viewAdaptationId) await downloadPdfById(viewAdaptationId);
}

function findEntry(entries: AdaptationEntry[], id: string): AdaptationEntry | undefined {
  return entries.find((e) => e.id === id);
}

async function restoreAdaptationById(id: string): Promise<void> {
  await sendMessage('restore-original', asJson({ id }), 'background');
  if (lastAdaptationId === id) lastAdaptationId = null;
  await renderHistoryList();
}

async function restoreOriginal(): Promise<void> {
  if (lastAdaptationId) {
    await restoreAdaptationById(lastAdaptationId);
    return;
  }
  await sendMessage('restore-original', {}, 'background');
  await renderHistoryList();
}

async function restoreAllAdaptations(): Promise<void> {
  await sendMessage('restore-original', {}, 'background');
  lastAdaptationId = null;
  await renderHistoryList();
}

async function copyAdaptedText(): Promise<void> {
  const text = lastResult?.adaptedText ?? '';
  if (!text) return;

  await navigator.clipboard.writeText(text);

  const btn = document.getElementById('btn-copy');
  if (btn) {
    const original = btn.textContent;
    btn.textContent = 'Скопировано!';
    setTimeout(() => {
      btn.textContent = original;
    }, 1500);
  }
}

async function downloadPdfById(id: string): Promise<void> {
  const state = await getPageState();
  const entry = findEntry(state.adaptations, id);
  if (!entry?.adaptedText?.trim()) return;

  const level = entry.translate ? `${entry.levelName} + EN→RU` : entry.levelName;
  await downloadTextAsPdf(entry.adaptedText, `medlens-${id.slice(-8)}.pdf`, {
    level,
    date: new Date(entry.timestamp).toLocaleDateString('ru-RU'),
  });
}

async function downloadPdf(): Promise<void> {
  if (lastAdaptationId) {
    await downloadPdfById(lastAdaptationId);
    return;
  }

  const text = lastResult?.adaptedText?.trim() ?? '';
  if (!text) return;

  const level = document.getElementById('selected-level')?.textContent ?? '';
  try {
    await downloadTextAsPdf(text, `medlens-${Date.now()}.pdf`, { level });
  } catch (err) {
    console.error('PDF export failed:', err);
  }
}

function openModal(levelNum: number): void {
  const level = levelDescriptions[levelNum];
  const modalBody = document.getElementById('modal-body');
  if (!modalBody || !level) return;

  modalBody.innerHTML = `
    <div class="modal-title">${level.title}</div>
    <div class="modal-description">${level.description}</div>
    <ul class="modal-features">${level.features.map((f) => `<li>${f}</li>`).join('')}</ul>
  `;

  document.getElementById('modal-overlay')?.classList.add('active');
}

function closeModal(event?: Event): void {
  if (!event || event.target === document.getElementById('modal-overlay')) {
    document.getElementById('modal-overlay')?.classList.remove('active');
  }
}

function openAdaptModal(): void {
  const content = document.querySelector('.adapt-modal-content');
  if (content) {
    content.innerHTML = `
      <p style="margin-bottom: 16px;">Выберите, что адаптировать:</p>
      <button class="btn" id="adapt-selection-btn" style="margin-bottom: 10px;">Выделенный текст</button>
      <button class="btn" id="adapt-page-btn">Всю страницу</button>
    `;

    document.getElementById('adapt-selection-btn')?.addEventListener('click', async () => {
      const text = await getSelectionFromTab();

      if (!text) {
        content.innerHTML =
          '<p style="color:#c0392b;">Текст не выделен. Выделите фрагмент на странице и попробуйте снова.</p>';
        return;
      }

      currentContext = {
        text,
        scope: 'selection',
        charCount: text.length,
        fromSelection: true,
      };
      updateCharCounter(text.length);
      closeAdaptModal();
      showScreen(2);
    });

    document.getElementById('adapt-page-btn')?.addEventListener('click', () => {
      startAdaptation('page');
    });
  }

  document.getElementById('adaptModal')?.classList.add('active');
}

function closeAdaptModal(event?: Event): void {
  if (!event || event.target === document.getElementById('adaptModal')) {
    document.getElementById('adaptModal')?.classList.remove('active');
  }
}

function bindEvents(): void {
  document.querySelectorAll('.nav-item[data-screen]').forEach((el) => {
    el.addEventListener('click', () => {
      const screen = Number((el as HTMLElement).dataset.screen);
      if (screen) {
        showScreen(screen);
        if (screen === 3) void renderHistoryList();
      }
    });
  });

  document.getElementById('btn-start-adapt')?.addEventListener('click', openAdaptModal);
  document.getElementById('btn-run-adapt')?.addEventListener('click', runAdaptation);
  document.getElementById('btn-restore-last')?.addEventListener('click', restoreOriginal);
  document.getElementById('btn-restore-all')?.addEventListener('click', restoreAllAdaptations);
  document.getElementById('btn-copy')?.addEventListener('click', copyAdaptedText);
  document.getElementById('btn-pdf')?.addEventListener('click', () => void downloadPdf());
  document.getElementById('btn-retry')?.addEventListener('click', () => {
    if (currentContext) showScreen(2);
    else showScreen(1);
  });

  document.querySelectorAll('.highlight-link[data-level]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const level = Number((el as HTMLElement).dataset.level);
      if (level) openModal(level);
    });
  });

  document.getElementById('adapt-view-close')?.addEventListener('click', closeAdaptView);
  document.getElementById('adapt-view-pdf')?.addEventListener('click', () => void downloadPdfFromView());
  document.getElementById('adapt-view-overlay')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('adapt-view-overlay')) closeAdaptView();
  });

  const modalOverlay = document.getElementById('modal-overlay');
  modalOverlay?.addEventListener('click', (e) => closeModal(e));
  document.getElementById('modal-close')?.addEventListener('click', () => closeModal());
  modalOverlay?.querySelector('.modal-content')?.addEventListener('click', (e) => e.stopPropagation());

  const adaptModal = document.getElementById('adaptModal');
  adaptModal?.addEventListener('click', (e) => closeAdaptModal(e));
  document.getElementById('adapt-modal-close')?.addEventListener('click', () => closeAdaptModal());
  adaptModal?.querySelector('.adapt-modal')?.addEventListener('click', (e) => e.stopPropagation());
}

document.addEventListener('DOMContentLoaded', () => {
  bindEvents();
  loadContext();
});
