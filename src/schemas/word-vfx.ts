import { t } from 'elysia';
export { WordVfx as wordVfxSchema } from '@/lib/db';

export const wordVfxColorSchema = t.Nullable(t.String({ minLength: 7, maxLength: 7, pattern: '^#[0-9a-fA-F]{6}$' }));
