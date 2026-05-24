import { Elysia } from 'elysia';
import { app } from './server';

if (!(app instanceof Elysia)) {
  throw new Error('Expected Elysia app');
}

export default app;
