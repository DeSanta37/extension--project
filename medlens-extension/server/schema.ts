import { z } from 'zod';

const levelSchema = z.coerce.number().pipe(z.union([z.literal(1), z.literal(2), z.literal(3)]));

const MAX_SELECTION_CHARS = 50_000;
const MAX_BLOCKS = 1000;
const MAX_BLOCK_CHARS = 8_000;

const blocksSchema = z.preprocess(
  (value) => {
    if (!Array.isArray(value)) return undefined;
    return value
      .filter((block): block is string => typeof block === 'string')
      .map((block) => block.trim())
      .filter((block) => block.length > 0);
  },
  z.array(z.string().min(1)).max(MAX_BLOCKS).optional(),
);

export const adaptRequestSchema = z
  .object({
    text: z.preprocess(
      (value) => (typeof value === 'string' ? value : ''),
      z.string(),
    ),
    blocks: blocksSchema,
    level: levelSchema,
    translate: z.boolean().optional().default(false),
  })
  .superRefine((data, ctx) => {
    const hasBlocks = Boolean(data.blocks?.length);
    const text = data.text.trim();

    if (!hasBlocks && !text) {
      ctx.addIssue({
        code: 'custom',
        message: 'Текст не может быть пустым',
        path: ['text'],
      });
      return;
    }

    if (!hasBlocks && text.length > MAX_SELECTION_CHARS) {
      ctx.addIssue({
        code: 'custom',
        message: `Текст слишком длинный (максимум ${MAX_SELECTION_CHARS} символов). Выделите фрагмент или адаптируйте страницу целиком.`,
        path: ['text'],
      });
    }

    data.blocks?.forEach((block, index) => {
      if (block.length > MAX_BLOCK_CHARS) {
        ctx.addIssue({
          code: 'custom',
          message: `Блок ${index + 1} слишком длинный`,
          path: ['blocks', index],
        });
      }
    });
  });

export type AdaptRequest = z.infer<typeof adaptRequestSchema>;

export const adaptResponseSchema = z.object({
  adaptedText: z.string(),
  adaptedBlocks: z.array(z.string()).optional(),
  originalLength: z.number(),
  adaptedLength: z.number(),
  charsChanged: z.number(),
  durationMs: z.number(),
  level: levelSchema,
  levelName: z.string(),
  translate: z.boolean(),
});

export type AdaptResponse = z.infer<typeof adaptResponseSchema>;
