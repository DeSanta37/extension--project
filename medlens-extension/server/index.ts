import 'dotenv/config';
import { serve } from '@hono/node-server';
import { cors } from 'hono/cors';
import { Hono } from 'hono';
import { chatCompletion } from './gigachat';
import { buildBlockMessages, buildMessages, LEVEL_NAMES, type AdaptLevel } from './prompts';
import { adaptRequestSchema } from './schema';
import {
  BLOCK_SEP,
  chunkBlocks,
  countCharDiff,
  parseBlockResponse,
  sanitizeAdaptedText,
} from './text-utils';

const app = new Hono();

app.use(
  '*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type'],
  }),
);

app.get('/health', (c) => c.json({ status: 'ok' }));

async function adaptSingleText(
  text: string,
  level: AdaptLevel,
  translate: boolean,
): Promise<string> {
  const messages = buildMessages(text, level, translate);
  return sanitizeAdaptedText(await chatCompletion(messages));
}

async function adaptBlockChunk(
  blocks: string[],
  level: AdaptLevel,
  translate: boolean,
): Promise<string[]> {
  const joined = blocks.join(`\n${BLOCK_SEP}\n`);
  const messages = buildBlockMessages(joined, blocks.length, level, translate);
  const raw = await chatCompletion(messages);
  return parseBlockResponse(raw, blocks.length);
}

async function adaptAllBlocks(
  blocks: string[],
  level: AdaptLevel,
  translate: boolean,
): Promise<string[]> {
  const chunks = chunkBlocks(blocks);
  const adapted: string[] = [];

  for (const chunk of chunks) {
    const part = await adaptBlockChunk(chunk, level, translate);
    adapted.push(...part);
  }

  return adapted.map((block, index) => block.trim() || blocks[index] || '');
}

app.post('/api/adapt', async (c) => {
  try {
    const body = await c.req.json();
    const parsed = adaptRequestSchema.safeParse(body);

    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const path = issue?.path?.length ? `${String(issue.path.join('.'))}: ` : '';
      return c.json({ error: `${path}${issue?.message ?? 'Неверные данные'}` }, 400);
    }

    const { text, blocks, level, translate } = parsed.data;
    const start = Date.now();

    let adaptedText = '';
    let adaptedBlocks: string[] | undefined;

    if (blocks?.length) {
      adaptedBlocks = await adaptAllBlocks(blocks, level, translate);
      adaptedText = adaptedBlocks.join('\n\n');
    } else {
      adaptedText = await adaptSingleText(text!.trim(), level, translate);
    }

    const originalText = blocks?.join('\n\n') ?? text!.trim();
    const durationMs = Date.now() - start;
    const charsChanged = countCharDiff(originalText, adaptedText);

    return c.json({
      adaptedText,
      adaptedBlocks,
      originalLength: originalText.length,
      adaptedLength: adaptedText.length,
      charsChanged,
      durationMs,
      level,
      levelName: LEVEL_NAMES[level],
      translate,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Неизвестная ошибка';
    console.error('[adapt]', message);
    return c.json({ error: message }, 500);
  }
});

const port = Number(process.env.PORT ?? 3000);

serve({ fetch: app.fetch, port }, () => {
  console.log(`MedLens server: http://localhost:${port}`);
});
