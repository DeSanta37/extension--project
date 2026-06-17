import browser from 'webextension-polyfill';
import type { Runtime } from 'webextension-polyfill';
import { onMessage } from 'webext-bridge/background';
import { fromJson, type AdaptPayload, type AdaptResult, type TextContext } from './types';
import type { BackgroundRequest } from './messages';

const API_URL = 'http://localhost:3000/api/adapt';

let pendingContext: TextContext | null = null;

browser.runtime.onInstalled.addListener(() => {
  browser.contextMenus.create({
    id: 'medlens-adapt',
    title: 'Адаптировать с MedLens',
    contexts: ['selection'],
  });
});

browser.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'medlens-adapt' || !tab?.id || !info.selectionText) return;

  pendingContext = {
    text: info.selectionText,
    scope: 'selection',
    charCount: info.selectionText.length,
    fromSelection: true,
  };

  await browser.storage.session.set({
    pendingContext,
    openIntent: 'selection',
    medlensSourceTabId: tab.id,
  });

  try {
    await browser.action.openPopup();
  } catch {}
});

async function getActiveTabId(): Promise<number | undefined> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

async function ensureContentScript(tabId: number): Promise<boolean> {
  try {
    await browser.tabs.sendMessage(tabId, { type: 'PING' });
    return true;
  } catch {
    try {
      const manifest = browser.runtime.getManifest();
      const files = manifest.content_scripts?.[0]?.js;
      if (!files?.length) return false;

      await browser.scripting.executeScript({
        target: { tabId },
        files: files as string[],
      });
      await new Promise((r) => setTimeout(r, 200));
      await browser.tabs.sendMessage(tabId, { type: 'PING' });
      return true;
    } catch (err) {
      console.error('[MedLens] content script inject failed:', err);
      return false;
    }
  }
}

async function sendToContentTab(tabId: number, message: object): Promise<void> {
  const ready = await ensureContentScript(tabId);
  if (!ready) return;

  try {
    await browser.tabs.sendMessage(tabId, message);
  } catch (err) {
    console.error('[MedLens] tabs.sendMessage failed:', err);
  }
}

async function queryContentTab<T>(tabId: number, message: object): Promise<T | null> {
  const ready = await ensureContentScript(tabId);
  if (!ready) return null;

  try {
    return (await browser.tabs.sendMessage(tabId, message)) as T;
  } catch {
    return null;
  }
}

browser.runtime.onMessage.addListener((message: unknown, sender: Runtime.MessageSender) => {
  if (!message || typeof message !== 'object' || !('type' in message)) return undefined;

  const req = message as BackgroundRequest;

  switch (req.type) {
    case 'SET_CONTEXT': {
      pendingContext = req.context;
      const sourceTabId = sender.tab?.id;
      return browser.storage.session
        .set({
          pendingContext: req.context,
          openIntent: 'selection',
          ...(sourceTabId ? { medlensSourceTabId: sourceTabId } : {}),
        })
        .then(() => ({ ok: true }));
    }

    case 'OPEN_POPUP':
      return browser.action
        .openPopup()
        .then(() => ({ ok: true }))
        .catch(() => ({ ok: false }));

    case 'GET_CONTEXT':
      return browser.storage.session.get('pendingContext').then((stored) => {
        return (stored.pendingContext as TextContext | undefined) ?? pendingContext;
      });

    case 'CLEAR_CONTEXT':
      pendingContext = null;
      return browser.storage.session
        .remove(['pendingContext', 'openIntent'])
        .then(() => ({ ok: true }));

    case 'ADAPT_TEXT':
      return handleAdaptText(req.payload, sender.tab?.id);

    case 'RESTORE_ORIGINAL':
      return getActiveTabId().then(async (tabId) => {
        const { id } = req as { type: 'RESTORE_ORIGINAL'; id?: string };
        if (tabId) await sendToContentTab(tabId, { type: 'RESTORE_ORIGINAL', id });
        return { ok: true };
      });

    case 'GET_PAGE_STATE':
      return (async () => {
        const tabId = sender.tab?.id ?? (await getActiveTabId());
        if (!tabId) return { adaptations: [] };
        return (
          (await queryContentTab(tabId, { type: 'GET_PAGE_STATE' })) ?? {
            adaptations: [],
          }
        );
      })();

    case 'ENSURE_CONTENT_SCRIPT':
      return (async () => {
        const tabId = sender.tab?.id ?? (await getActiveTabId());
        if (!tabId) return { ok: false };
        const ok = await ensureContentScript(tabId);
        return { ok };
      })();

    case 'GET_TAB_SELECTION':
      return (async () => {
        const tabId = sender.tab?.id ?? (await getActiveTabId());
        if (!tabId) return { text: '' };

        const stored = await browser.storage.session.get(['pendingContext', 'medlensLastSelection']);
        const pending = stored.pendingContext as TextContext | undefined;
        if (pending?.text?.trim()) return { text: pending.text.trim() };

        const last = stored.medlensLastSelection as { text?: string } | undefined;
        if (last?.text?.trim()) return { text: last.text.trim() };

        const result = await queryContentTab<{ text?: string }>(tabId, {
          type: 'GET_SELECTION_TEXT',
        });
        return { text: result?.text ?? '' };
      })();

    case 'OPEN_POPUP_FALLBACK':
      return (async () => {
        const { context } = req as { type: 'OPEN_POPUP_FALLBACK'; context: TextContext };
        pendingContext = context;
        await browser.storage.session.set({
          pendingContext: context,
          openIntent: 'selection',
        });
        return { ok: true };
      })();

    case 'REAPPLY_ADAPTED':
      return (async () => {
        const { id } = req as { type: 'REAPPLY_ADAPTED'; id: string };
        const tabId = await resolveTargetTabId();
        if (!tabId) return { ok: false };
        const result = await queryContentTab<{ ok?: boolean }>(tabId, {
          type: 'REAPPLY_ADAPTED',
          id,
        });
        return result ?? { ok: false, error: 'Не удалось связаться со страницей' };
      })();

    case 'GET_TAB_PAGE_TEXT':
      return (async () => {
        const tabId = sender.tab?.id ?? (await getActiveTabId());
        if (!tabId) return { text: '' };
        const result = await queryContentTab<{ text?: string }>(tabId, {
          type: 'GET_PAGE_TEXT',
        });
        return { text: result?.text ?? '' };
      })();

    default:
      return undefined;
  }
});

async function resolveTargetTabId(tabId?: number): Promise<number | undefined> {
  if (tabId) return tabId;

  const stored = await browser.storage.session.get('medlensSourceTabId');
  const sourceTabId = stored.medlensSourceTabId as number | undefined;
  if (sourceTabId) return sourceTabId;

  return getActiveTabId();
}

function sanitizeBlockList(blocks: unknown): string[] {
  if (!Array.isArray(blocks)) return [];
  return blocks
    .filter((block): block is string => typeof block === 'string')
    .map((block) => block.trim())
    .filter((block) => block.length > 0);
}

async function handleAdaptText(payload: AdaptPayload, tabId?: number): Promise<AdaptResult> {
  try {
    const targetTabId = await resolveTargetTabId(tabId);
    let requestBody: Record<string, unknown>;
    const level = payload.level ?? 1;
    const translate = payload.translate ?? false;
    const fallbackText = payload.text?.trim() ?? '';

    if (payload.scope === 'page') {
      if (!targetTabId) {
        throw new Error('Не удалось определить вкладку для адаптации страницы');
      }

      const blocksData = await queryContentTab<{ blocks?: string[] }>(targetTabId, {
        type: 'GET_PAGE_BLOCKS',
      });
      const blocks = sanitizeBlockList(blocksData?.blocks);

      if (blocks.length === 0) {
        throw new Error('На странице не найдено текста для адаптации');
      }

      requestBody = {
        blocks,
        text: blocks.join('\n\n'),
        level,
        translate,
      };
    } else {
      if (!targetTabId) {
        throw new Error('Не удалось определить вкладку для адаптации выделения');
      }

      const blocksData = await queryContentTab<{ blocks?: string[] }>(targetTabId, {
        type: 'GET_SELECTION_BLOCKS',
      });
      const blocks = sanitizeBlockList(blocksData?.blocks);
      const text = fallbackText || blocks.join('\n\n');

      if (!text) {
        throw new Error('Текст не найден. Выделите фрагмент и попробуйте снова.');
      }

      if (blocks.length > 1) {
        requestBody = {
          blocks,
          text,
          level,
          translate,
        };
      } else {
        requestBody = {
          text,
          level,
          translate,
        };
      }
    }

    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error ?? `Ошибка сервера (${response.status})`);
    }

    const adaptResult = result as AdaptResult;

    let adaptationId: string | undefined;

    if (targetTabId) {
      const applyResult = await queryContentTab<{ ok?: boolean; id?: string }>(targetTabId, {
        type: 'APPLY_ADAPTED',
        adaptedText: adaptResult.adaptedText,
        adaptedBlocks: adaptResult.adaptedBlocks,
        scope: payload.scope,
        originalText: payload.text,
        levelName: adaptResult.levelName,
        translate: adaptResult.translate,
      });
      if (!applyResult?.ok) {
        console.error('[MedLens] APPLY_ADAPTED failed on tab', targetTabId);
      }
      adaptationId = applyResult?.id;
    }

    return { ...adaptResult, adaptationId };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Ошибка адаптации';
    if (message.includes('Failed to fetch') || message.includes('NetworkError')) {
      throw new Error('Сервер не запущен. Выполните: npm run server');
    }
    throw new Error(message);
  }
}

onMessage('get-context', async () => {
  const stored = await browser.storage.session.get('pendingContext');
  return (stored.pendingContext as TextContext | undefined) ?? pendingContext;
});

onMessage('clear-context', async () => {
  pendingContext = null;
  await browser.storage.session.remove(['pendingContext', 'openIntent']);
  return { ok: true };
});

onMessage('adapt-text', async ({ data, sender }) => {
  const payload = fromJson<AdaptPayload>(data);
  const tabId = await resolveTargetTabId(sender.tabId);
  return handleAdaptText(payload, tabId);
});

onMessage('restore-original', async ({ data }) => {
  const tabId = await resolveTargetTabId();
  const id = (data as { id?: string } | undefined)?.id;
  if (tabId) await sendToContentTab(tabId, { type: 'RESTORE_ORIGINAL', id });
  return { ok: true };
});

onMessage('get-page-state', async () => {
  const tabId = await resolveTargetTabId();
  if (!tabId) return { adaptations: [] };
  return (
    (await queryContentTab(tabId, { type: 'GET_PAGE_STATE' })) ?? {
      adaptations: [],
    }
  );
});
