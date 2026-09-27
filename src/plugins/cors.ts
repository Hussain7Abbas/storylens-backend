import { cors as elysiaCors } from '@elysiajs/cors';

export const cors = elysiaCors({
  // Reflect the requested headers: a literal `*` never covers `Authorization`,
  // which the website's account pages send cross-origin.
  allowedHeaders: true,
  credentials: true,
});
