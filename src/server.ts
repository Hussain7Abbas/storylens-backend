import chalk from 'chalk';
import { Elysia, status } from 'elysia';
import { env } from './env';
import { cors, crons, logger, openapi, queryParser } from './plugins';
import { ai } from './routes/ai';
// import { accounts } from './routes/accounts';
import { chapters } from './routes/chapters';
import { configs } from './routes/configs';
import { files } from './routes/files';
import { keywordCategories } from './routes/keyword-categories';
import { keywordNatures } from './routes/keyword-natures';
import { keywords } from './routes/keywords';
import { keywordsChapters } from './routes/keywords-chapters';
import { novels } from './routes/novels';
import { replacements } from './routes/replacements';
import { errorSchema } from './schemas/common';
import { AuthError, HttpError } from './utils/errors';

export const app = new Elysia()
  .use(logger)
  .use(cors)
  .use(openapi)
  .use(crons)
  .use(queryParser)

  .error({ HttpError, AuthError })
  .onError(({ code, error }) => {
    if (code === 'HttpError') {
      return status(error.statusCode, { message: error.message });
    }

    if (code === 'AuthError') {
      return status(401, { message: error.message });
    }
  })
  .guard({
    response: {
      404: errorSchema,
      500: errorSchema,
    },
  })

  // Routes
  .get('/', () => ({
    message: 'Made with ❤️ by Hussain Abbas, for docs checkout /docs',
  }))

  // .use(accounts)
  .use(configs)
  .use(novels)
  .use(chapters)
  .use(keywords)
  .use(replacements)
  .use(keywordsChapters)
  .use(keywordCategories)
  .use(keywordNatures)
  .use(files)
  .use(ai)

  .listen(env.PORT, ({ url }) => {
    console.log(`🚀 Server is running at ${chalk.green(url)}`);
  });
