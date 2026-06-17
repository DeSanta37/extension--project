import type { JsonValue } from 'type-fest';

export type AdaptLevel = 1 | 2 | 3;

export function asJson<T>(value: T): JsonValue {
  return value as unknown as JsonValue;
}

export function fromJson<T>(value: JsonValue | null | undefined): T {
  return value as unknown as T;
}

export type TextScope = 'selection' | 'page';

export interface TextContext {
  text: string;
  scope: TextScope;
  charCount: number;
  /** true when opened via floating button after text selection */
  fromSelection: boolean;
}

export interface AdaptResult {
  adaptedText: string;
  originalLength: number;
  adaptedLength: number;
  charsChanged: number;
  durationMs: number;
  level: AdaptLevel;
  levelName: string;
  translate: boolean;
  adaptationId?: string;
  adaptedBlocks?: string[];
}

export interface AdaptPayload {
  text: string;
  level: AdaptLevel;
  translate: boolean;
  scope: TextScope;
}

export interface ApplyPayload {
  adaptedText: string;
  scope: TextScope;
}

export interface AdaptationEntry {
  id: string;
  scope: TextScope;
  adaptedText: string;
  adaptedBlocks?: string[];
  originalText: string;
  levelName: string;
  translate: boolean;
  timestamp: number;
  preview: string;
  sourceUrl: string;
  isActive: boolean;
}

export interface PageState {
  adaptations: AdaptationEntry[];
}
