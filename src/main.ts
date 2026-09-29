import chalk from 'chalk';
import { env } from './env';
import { prisma } from './lib/db';
import { syncPermissions } from './lib/permissions';
import { app } from './server';

// Every `/api/{portal}` route gets a permission row before requests arrive.
const synced = await syncPermissions(prisma, app.routes);
console.log(
  `🔐 ${synced.total} permissions synced (${synced.created.length} new, ${synced.removed.length} removed)`,
);

app.listen(env.PORT, ({ url }) => {
  console.log(`🚀 Server is running at ${chalk.green(url)}`);
});
