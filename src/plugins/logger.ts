import chalk from 'chalk';
import { Elysia } from 'elysia';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
type Methods = (typeof METHODS)[number];

interface LoggerParams {
  method: Methods;
  status: number;
  path: string;
}

const formatStatus = (status: number) =>
  status >= 400
    ? chalk.bold.red(status)
    : status >= 300
      ? chalk.bold.yellow(status)
      : status >= 200
        ? chalk.bold.green(status)
        : chalk.bold.gray(status);

const log = (params: LoggerParams) => {
  if (!METHODS.includes(params.method) || typeof params.status !== 'number') {
    return;
  }

  const method = chalk.bold.blue(params.method);
  const status = formatStatus(params.status);
  const path = chalk.bold.cyan(params.path);

  console.log(`${method} ${status} ${path}`);
};

interface ErrorLogParams {
  method: string;
  path: string;
  code: string | number;
  status: number;
  message: string;
  stack?: string;
}

export const logError = ({
  method,
  path,
  code,
  status,
  message,
  stack,
}: ErrorLogParams) => {
  const formattedMethod = chalk.bold.blue(method);
  const formattedStatus = formatStatus(status);
  const formattedPath = chalk.bold.cyan(path);
  const formattedCode = chalk.bold.magenta(String(code));
  const formattedMessage = chalk.red(message);
  const output = `${formattedMethod} ${formattedStatus} ${formattedPath} ${formattedCode} ${formattedMessage}`;

  if (status >= 500) {
    console.error(output);
    if (stack) {
      console.error(chalk.gray(stack));
    }
    return;
  }

  console.warn(output);
};

export const logger = new Elysia({ name: 'logger' })
  .derive({ as: 'global' }, () => ({ start: Date.now() }))

  .onError({ as: 'global' }, (ctx) => {
    log({
      method: ctx.request.method as Methods,
      status: ctx.set.status as number,
      path: ctx.path,
    });
  })

  .onAfterResponse({ as: 'global' }, (ctx) => {
    log({
      method: ctx.request.method as Methods,
      status: ctx.set.status as number,
      path: ctx.path,
    });
  });
