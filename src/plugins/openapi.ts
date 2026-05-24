import { openapi as elysiaOpenapi } from '@elysiajs/openapi';
import { fromTypes } from '@elysiajs/openapi/gen';
import { Elysia } from 'elysia';
import { env } from '@/env';

export const openapi =
  env.NODE_ENV !== 'development'
    ? new Elysia({})
    : elysiaOpenapi({
        references: fromTypes('src/server.ts'),
        path: '/docs',
        specPath: '/openapi.json',
        documentation: {
          tags: [],
          servers: [
            {
              url: `{server}:${env.PORT}`,
              description: 'Server URL',
              variables: {
                server: {
                  default: 'http://localhost',
                  description: 'The server URL',
                  enum: ['http://localhost', 'https://storylens-api.iscoded.com'],
                },
              },
            },
          ],
          components: {
            securitySchemes: {
              'Bearer Auth': {
                type: 'http',
                scheme: 'bearer',
                bearerFormat: 'JWT',
              },
            },
          },
        },
      });
