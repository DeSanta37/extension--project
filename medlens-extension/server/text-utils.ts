export const BLOCK_SEP = '<<<MEDLENS_BLOCK>>>';

export const CHUNK_CHAR_LIMIT = 1800;

export function sanitizeAdaptedText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .trim();
}

export function chunkBlocks(blocks: string[], limit = CHUNK_CHAR_LIMIT): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  let currentLen = 0;

  for (const block of blocks) {
    const blockLen = block.length + BLOCK_SEP.length;
    if (current.length > 0 && currentLen + blockLen > limit) {
      chunks.push(current);
      current = [];
      currentLen = 0;
    }
    current.push(block);
    currentLen += blockLen;
  }

  if (current.length > 0) chunks.push(current);
  return chunks;
}

export function parseBlockResponse(raw: string, expectedCount: number): string[] {
  const trySplit = (separator: string | RegExp): string[] =>
    raw.split(separator).map((part) => sanitizeAdaptedText(part));

  let parts = trySplit(BLOCK_SEP);
  if (parts.length !== expectedCount) {
    parts = trySplit(/<<<MEDLENS_BLOCK>>>/i);
  }

  if (parts.length !== expectedCount) {
    parts = raw
      .split(/\n\n+/)
      .map((part) => sanitizeAdaptedText(part))
      .filter(Boolean);
  }

  if (parts.length > expectedCount) {
    const head = parts.slice(0, expectedCount - 1);
    const tail = parts.slice(expectedCount - 1).join('\n\n');
    return [...head, sanitizeAdaptedText(tail)];
  }

  if (parts.length < expectedCount) {
    while (parts.length < expectedCount) parts.push('');
  }

  return parts.slice(0, expectedCount).map(sanitizeAdaptedText);
}

export function countCharDiff(original: string, adapted: string): number {
  const maxLen = Math.max(original.length, adapted.length);
  let diff = Math.abs(original.length - adapted.length);

  for (let i = 0; i < maxLen; i++) {
    if (original[i] !== adapted[i]) diff++;
  }

  return diff;
}
