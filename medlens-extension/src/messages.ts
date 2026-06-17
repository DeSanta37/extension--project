import type { AdaptPayload, AdaptResult, PageState, TextContext, TextScope } from './types';

export type BackgroundRequest =
  | { type: 'SET_CONTEXT'; context: TextContext }
  | { type: 'OPEN_POPUP' }
  | { type: 'GET_CONTEXT' }
  | { type: 'CLEAR_CONTEXT' }
  | { type: 'ADAPT_TEXT'; payload: AdaptPayload }
  | { type: 'RESTORE_ORIGINAL'; id?: string }
  | { type: 'GET_PAGE_STATE' }
  | { type: 'ENSURE_CONTENT_SCRIPT' }
  | { type: 'GET_TAB_SELECTION' }
  | { type: 'GET_TAB_PAGE_TEXT' }
  | { type: 'OPEN_POPUP_FALLBACK'; context: TextContext }
  | { type: 'REAPPLY_ADAPTED'; id: string };

export type ContentRequest =
  | { type: 'GET_PAGE_TEXT' }
  | { type: 'GET_PAGE_BLOCKS' }
  | { type: 'GET_SELECTION_TEXT' }
  | { type: 'GET_SELECTION_BLOCKS' };

export type ContentCommand =
  | {
      type: 'APPLY_ADAPTED';
      adaptedText: string;
      adaptedBlocks?: string[];
      scope: TextScope;
      originalText?: string;
      levelName?: string;
      translate?: boolean;
    }
  | { type: 'RESTORE_ORIGINAL'; id?: string }
  | { type: 'DOWNLOAD_PDF'; id: string }
  | { type: 'GET_ADAPTATION'; id: string }
  | { type: 'REAPPLY_ADAPTED'; id: string };

export type BackgroundResponse =
  | { ok: true }
  | { ok: false }
  | TextContext
  | null
  | AdaptResult
  | PageState
  | { text: string };
