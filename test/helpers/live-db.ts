import { it } from 'bun:test';
import { prisma } from '@/lib/db';
import { createSessionToken } from '@/lib/auth/session';
import { syncPermissions } from '@/lib/permissions';
import { app } from '@/server';

/**
 * Live database tests run only with `STORYLENS_LIVE_DB_TEST=1` against a
 * migrated database (`make test-live` prepares `TEST_DATABASE_URL`).
 */
export const live = process.env.STORYLENS_LIVE_DB_TEST === '1' ? it : it.skip;

export type Actor = { id: string; token: string };

let permissionsSynced: Promise<unknown> | undefined;

/** A reader-portal account with the given system role and a bearer session. */
export async function makeActor(role: 'reader' | 'moderator' | 'guest', marker: string): Promise<Actor> {
  permissionsSynced ??= syncPermissions(prisma, app.routes);
  await permissionsSynced;
  const userRole = await prisma.role.findUniqueOrThrow({ where: { slug: role } });
  const tag = `${role}-${marker}-${crypto.randomUUID().slice(0, 8)}`;
  const user = await prisma.user.create({
    data: {
      email: `${tag}@example.invalid`,
      username: tag,
      password: 'unused',
      name: tag,
      isGuest: role === 'guest',
      isUser: true,
      userRoleId: userRole.id,
    },
  });
  return { id: user.id, token: await createSessionToken(prisma, user.id, 'user') };
}

export type CallResult<T = Record<string, unknown>> = { status: number; body: T };

/** Calls the reader API as `actor`. */
export async function call<T = Record<string, unknown>>(
  actor: Actor | null,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<CallResult<T>> {
  const response = await app.handle(
    new Request(`http://localhost/api/user${path}`, {
      method,
      headers: {
        ...(actor ? { Authorization: `Bearer ${actor.token}` } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  const text = await response.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Plain-text bodies (validation errors) stay strings.
  }
  return { status: response.status, body: parsed as T };
}

/** A category and a nature to style keywords with. */
export async function makeStyles(marker: string) {
  const [category, nature] = await Promise.all([
    prisma.keywordCategory.create({ data: { nameEn: `Category ${marker}`, color: '#112233' } }),
    prisma.keywordNature.create({ data: { nameEn: `Nature ${marker}`, color: '#445566' } }),
  ]);
  return { category, nature };
}

export async function cleanup(ids: { novels?: string[]; users?: string[]; categories?: string[]; natures?: string[] }) {
  if (ids.novels?.length) await prisma.novel.deleteMany({ where: { id: { in: ids.novels } } });
  if (ids.categories?.length) {
    await prisma.keywordAlias.updateMany({ where: { categoryId: { in: ids.categories } }, data: { categoryId: null } });
    await prisma.keywordCategory.deleteMany({ where: { id: { in: ids.categories } } });
  }
  if (ids.natures?.length) {
    await prisma.keywordAlias.updateMany({ where: { natureId: { in: ids.natures } }, data: { natureId: null } });
    await prisma.keywordNature.deleteMany({ where: { id: { in: ids.natures } } });
  }
  if (ids.users?.length) {
    await prisma.session.deleteMany({ where: { userId: { in: ids.users } } });
    await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
  }
}
