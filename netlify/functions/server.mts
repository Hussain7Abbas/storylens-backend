import type { Config, Context } from '@netlify/functions';
import { app } from '../../src/server';

export default async (req: Request, _context: Context) => app.fetch(req);

export const config: Config = {
  path: '/*',
};
