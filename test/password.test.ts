import { expect, it } from 'bun:test';

// Isolate mocked Elysia setup from the real server smoke test and other routes.
it('validates password changes, credentials, and role guards', async () => {
  const child = Bun.spawn([process.execPath, 'test', './test/fixtures/password.ts'], {
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
