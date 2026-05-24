import chalk from 'chalk';
import { env } from './env';
import { app } from './server';

app.listen(env.PORT, ({ url }) => {
  console.log(`🚀 Server is running at ${chalk.green(url)}`);
});
