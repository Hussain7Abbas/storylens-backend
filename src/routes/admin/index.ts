import { Elysia } from 'elysia';
import { adminAuth } from './auth';
import { adminConfigs } from './configs';
import { adminFiles } from './files';
import { adminKeywordAliases } from './keyword-aliases';
import { adminKeywordCategories, adminKeywordNatures } from './keyword-styles';
import { adminKeywordVersions } from './keyword-versions';
import { adminKeywords } from './keywords';
import { adminNovels } from './novels';
import { adminPermissions } from './permissions';
import { adminRoles } from './roles';
import { adminStats } from './stats';
import { adminUsers } from './users';

/** Dashboard API: only `admin`-portal accounts, each route behind its permission. */
export const adminApi = new Elysia({ prefix: '/api/admin' })
  .use(adminAuth)
  .use(adminStats)
  .use(adminUsers)
  .use(adminRoles)
  .use(adminPermissions)
  .use(adminNovels)
  .use(adminKeywords)
  .use(adminKeywordAliases)
  .use(adminKeywordVersions)
  .use(adminKeywordCategories)
  .use(adminKeywordNatures)
  .use(adminConfigs)
  .use(adminFiles);
