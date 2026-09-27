import { expect, it } from 'bun:test';

// Isolate mocked Elysia setup and Better Auth from other routes.
it('exchanges OAuth sessions, merges guests, and generates usernames', async () => {
  const child = Bun.spawn([process.execPath, 'test', './test/fixtures/oauth.ts'], {
    cwd: new URL('..', import.meta.url).pathname,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect({ code, output: code === 0 ? '' : stdout + stderr }).toEqual({ code: 0, output: '' });
});
