import { afterAll, beforeAll, describe, expect } from 'bun:test';
import bcrypt from 'bcryptjs';
import { env } from '@/env';
import { prisma } from '@/lib/db';
import { createCredentialAccount, createSessionToken } from '@/lib/auth/session';
import { stageRegistration } from '@/lib/auth/registration';
import { stageAccountChange } from '@/lib/auth/account-change';
import { WEB_SESSION_COOKIE } from '@/lib/auth/web-session';
import { SYSTEM_ROLES } from '@/lib/permissions';
import { app } from '@/server';
import { cleanup, live, makeActor } from './helpers/live-db';

type Json = Record<string, unknown>;

const marker = crypto.randomUUID().slice(0, 8);
const ids = { users: [] as string[] };
const WEBSITE = new URL(env.WEBSITE_URL).origin;
const PASSWORD = 'correct-horse-battery';
let member: { id: string; email: string };

async function send(
  method: string,
  path: string,
  { body, cookie, bearer, origin = WEBSITE, csrf = true }: { body?: unknown; cookie?: string; bearer?: string; origin?: string | null; csrf?: boolean } = {},
) {
  const headers: Record<string, string> = {};
  if (origin) headers.Origin = origin;
  if (csrf) headers['X-Storylens-Web'] = '1';
  if (cookie) headers.Cookie = `${WEB_SESSION_COOKIE}=${cookie}`;
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await app.handle(
    new Request(`http://localhost/api/user${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
  );
  const text = await response.text();
  let json: Json = {};
  try {
    json = JSON.parse(text) as Json;
  } catch {
    json = { text };
  }
  return { status: response.status, json, setCookie: response.headers.getSetCookie() };
}

/** The web session token from a `Set-Cookie` list. */
function tokenFrom(setCookie: string[]): string {
  const cookie = setCookie.find((value) => value.startsWith(`${WEB_SESSION_COOKIE}=`));
  if (!cookie) throw new Error('no web session cookie');
  return decodeURIComponent(cookie.slice(WEB_SESSION_COOKIE.length + 1).split(';')[0] ?? '');
}

async function login(): Promise<string> {
  const response = await send('POST', '/auth/web/login', { body: { email: member.email, password: PASSWORD } });
  expect(response.status).toBe(200);
  return tokenFrom(response.setCookie);
}

beforeAll(async () => {
  if (process.env.STORYLENS_LIVE_DB_TEST !== '1') return;
  const reader = await makeActor('reader', marker);
  ids.users.push(reader.id);
  const user = await prisma.user.update({
    where: { id: reader.id },
    data: { email: `web-${marker}@example.invalid`, password: await bcrypt.hash(PASSWORD, 4) },
  });
  await createCredentialAccount(prisma, user.id, user.email, PASSWORD);
  member = { id: user.id, email: user.email };
});

afterAll(async () => {
  if (process.env.STORYLENS_LIVE_DB_TEST !== '1') return;
  await cleanup(ids);
});

describe('website session', () => {
  live('signs in with an HttpOnly, Secure, SameSite=Strict host cookie', async () => {
    const response = await send('POST', '/auth/web/login', { body: { email: member.email, password: PASSWORD } });
    expect(response.status).toBe(200);
    expect(response.json.user).toMatchObject({ id: member.id });
    expect(response.json).not.toHaveProperty('token');
    const cookie = response.setCookie.find((value) => value.startsWith(`${WEB_SESSION_COOKIE}=`)) ?? '';
    for (const part of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/']) expect(cookie).toContain(part);
    expect(cookie).not.toContain('Domain=');
    const session = await prisma.session.findUniqueOrThrow({ where: { token: tokenFrom(response.setCookie) } });
    expect(session.kind).toBe('web');
  });

  live('answers only the website origin with the CSRF header', async () => {
    const body = { email: member.email, password: PASSWORD };
    const elsewhere = await send('POST', '/auth/web/login', { body, origin: 'https://evil.example' });
    expect([elsewhere.status, elsewhere.json.code]).toEqual([403, 'WEB_ORIGIN_REQUIRED']);
    const noHeader = await send('POST', '/auth/web/login', { body, csrf: false });
    expect([noHeader.status, noHeader.json.code]).toEqual([403, 'WEB_ORIGIN_REQUIRED']);
  });

  live('reads the cookie only from the website origin', async () => {
    const token = await login();
    expect((await send('GET', '/auth/me', { cookie: token })).status).toBe(200);
    expect((await send('GET', '/auth/me', { cookie: token, origin: 'https://evil.example' })).status).toBe(401);
    expect((await send('GET', '/auth/me', { cookie: token, origin: null })).status).toBe(401);
    // A write without the CSRF header is treated as signed out.
    expect((await send('PUT', '/auth/me', { cookie: token, csrf: false, body: { username: `n${marker}`, name: 'N' } })).status).toBe(401);
  });

  live('keeps cookie and bearer tokens apart', async () => {
    const web = await login();
    expect((await send('GET', '/auth/me', { bearer: web, origin: null, csrf: false })).status).toBe(401);
    const bearer = await createSessionToken(prisma, member.id, 'user');
    expect((await send('GET', '/auth/me', { cookie: bearer })).status).toBe(401);
  });

  live('signs out and clears the cookie', async () => {
    const token = await login();
    const response = await send('POST', '/auth/web/logout', { cookie: token });
    expect(response.status).toBe(200);
    expect(response.setCookie.some((value) => value.includes('Max-Age=0'))).toBe(true);
    expect(await prisma.session.findUnique({ where: { token } })).toBeNull();
    expect((await send('POST', '/auth/web/logout')).status).toBe(200);
  });
});

describe('registration on the website', () => {
  async function verify(email: string, bearer?: string) {
    const username = `w${crypto.randomUUID().slice(0, 10)}`;
    const staged = await stageRegistration(prisma, { email, username, name: username, passwordHash: await bcrypt.hash('unused-password', 4) });
    if (staged.status !== 'staged') throw new Error('not staged');
    const response = await send('POST', '/auth/web/register/verify', { body: { email, code: staged.code }, bearer });
    const id = (response.json.user as Json | undefined)?.id;
    if (typeof id === 'string') ids.users.push(id);
    return response;
  }

  live('creates the account with the trial gift and a cookie', async () => {
    await prisma.config.upsert({ where: { key: 'Lens_Trial_Gift' }, update: { value: '10' }, create: { key: 'Lens_Trial_Gift', value: '10' } });
    const response = await verify(`webreg-${marker}@example.invalid`);
    expect(response.status).toBe(200);
    expect(response.json.gift).toEqual({ lenses: 10 });
    expect(tokenFrom(response.setCookie)).toBeTruthy();
  });

  live('upgrades the extension guest in place', async () => {
    const guest = await makeActor('guest', marker);
    ids.users.push(guest.id);
    const response = await verify(`webguest-${marker}@example.invalid`, guest.token);
    expect((response.json.user as Json).id).toBe(guest.id);
    expect((response.json.user as Json).isGuest).toBe(false);
  });
});

describe('extension handoff', () => {
  live('mints a bearer session for the extension and merges its guest', async () => {
    const web = await login();
    const plain = await send('POST', '/auth/web/extension-session', { cookie: web, body: {} });
    expect(plain.status).toBe(200);
    const session = await prisma.session.findUniqueOrThrow({ where: { token: plain.json.token as string } });
    expect(session.kind).toBe('bearer');

    const guest = await makeActor('guest', marker);
    const novel = await prisma.novel.create({ data: { nameEn: `Guest novel ${marker}`, createdById: guest.id } });
    const merged = await send('POST', '/auth/web/extension-session', { cookie: web, body: { guestToken: guest.token } });
    expect(merged.status).toBe(200);
    expect(await prisma.user.findUnique({ where: { id: guest.id } })).toBeNull();
    expect((await prisma.novel.findUniqueOrThrow({ where: { id: novel.id } })).createdById).toBe(member.id);
    await prisma.novel.delete({ where: { id: novel.id } });
  });

  live('needs the website session, not a bearer token', async () => {
    const bearer = await createSessionToken(prisma, member.id, 'user');
    const response = await send('POST', '/auth/web/extension-session', { bearer, body: {} });
    expect([response.status, response.json.code]).toEqual([403, 'WEB_ORIGIN_REQUIRED']);
  });

  live('adopts the extension’s member session, never a guest’s', async () => {
    const bearer = await createSessionToken(prisma, member.id, 'user');
    const adopted = await send('POST', '/auth/web/adopt', { bearer });
    expect(adopted.status).toBe(200);
    expect(tokenFrom(adopted.setCookie)).toBeTruthy();

    const guest = await makeActor('guest', marker);
    ids.users.push(guest.id);
    expect((await send('POST', '/auth/web/adopt', { bearer: guest.token })).status).toBe(403);
  });

  live('ends web sessions when the dashboard signs a user out everywhere', async () => {
    const web = await login();
    const role = await prisma.role.findUniqueOrThrow({ where: { slug: SYSTEM_ROLES.superAdmin } });
    const admin = await prisma.user.create({
      data: { email: `wadmin-${marker}@example.invalid`, username: `wadmin${marker}`, password: 'x', name: 'Owner', isUser: false, isAdmin: true, adminRoleId: role.id },
    });
    ids.users.push(admin.id);
    const adminToken = await createSessionToken(prisma, admin.id, 'admin');
    const response = await app.handle(
      new Request(`http://localhost/api/admin/users/${member.id}/sessions`, { method: 'DELETE', headers: { Authorization: `Bearer ${adminToken}` } }),
    );
    expect(response.status).toBe(200);
    expect(await prisma.session.findUnique({ where: { token: web } })).toBeNull();
  });

  live('a verified password change ends the other web sessions and keeps the current one and the bearer ones', async () => {
    const current = await login();
    const other = await login();
    const bearer = await createSessionToken(prisma, member.id, 'user');
    // The same password, so the other tests can still sign in.
    const passwordHash = (await prisma.user.findUniqueOrThrow({ where: { id: member.id } })).password;
    await prisma.verification.deleteMany({ where: { identifier: { contains: member.id } } });
    const staged = await stageAccountChange(prisma, member.id, { kind: 'password', passwordHash });
    if (staged.status !== 'staged') throw new Error('the change was not staged');

    const response = await send('POST', '/auth/change-password/verify', { cookie: current, body: { code: staged.code } });
    expect(response.status).toBe(200);
    expect(await prisma.session.findUnique({ where: { token: current } })).not.toBeNull();
    expect(await prisma.session.findUnique({ where: { token: other } })).toBeNull();
    expect(await prisma.session.findUnique({ where: { token: bearer } })).not.toBeNull();
  });
});
