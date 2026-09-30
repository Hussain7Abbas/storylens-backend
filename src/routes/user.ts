import { Elysia } from 'elysia';
import { accounts } from './accounts';
import { ai } from './ai';
import { chapters } from './chapters';
import { files } from './files';
import { keywordAliases } from './keyword-aliases';
import { keywordCategories } from './keyword-categories';
import { keywordNatures } from './keyword-natures';
import { keywordVersions } from './keyword-versions';
import { keywords } from './keywords';
import { keywordsChapters } from './keywords-chapters';
import { novels } from './novels';
import { replacements } from './replacements';
import { sync } from './sync';
import { websiteNovelBiases } from './website-novel-biases';
import { websiteSelectors } from './website-selectors';

/**
 * Reader API for the extension, website account pages and desktop client:
 * only `user`-portal accounts, each route behind its permission.
 */
export const userApi = new Elysia({ prefix: '/api/user' })
  .use(accounts)
  .use(websiteSelectors)
  .use(websiteNovelBiases)
  .use(novels)
  .use(chapters)
  .use(keywords)
  .use(keywordAliases)
  .use(keywordVersions)
  .use(replacements)
  .use(keywordsChapters)
  .use(keywordCategories)
  .use(keywordNatures)
  .use(files)
  .use(ai)
  .use(sync);
