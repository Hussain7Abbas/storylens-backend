import { expect, it } from 'bun:test';
import { prisma } from '@/lib/db';
import { createSessionToken } from '@/lib/auth/session';
import { app } from '@/server';

const live = process.env.STORYLENS_LIVE_DB_TEST === '1' ? it : it.skip;

live('admin keyword merges and chapter ranges stay safe in PostgreSQL', async () => {
  const marker = crypto.randomUUID();
  let userId: string | undefined;
  let novelId: string | undefined;
  try {
    const role = await prisma.role.findUniqueOrThrow({ where: { slug: 'super-admin' } });
    const user = await prisma.user.create({
      data: {
        email: `review-${marker}@example.invalid`,
        username: `review-${marker}`,
        password: 'unused',
        name: 'Review check',
        isUser: false,
        isAdmin: true,
        adminRoleId: role.id,
      },
    });
    userId = user.id;
    const token = await createSessionToken(prisma, user.id, 'admin');
    const novel = await prisma.novel.create({ data: { nameEn: `Review ${marker}`, createdById: user.id } });
    novelId = novel.id;
    const request = (method: string, path: string, body?: object) =>
      app.handle(new Request(`http://localhost/api/admin${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      }));
    const makeKeyword = (nameEn: string) => prisma.keyword.create({
      data: {
        novelId: novel.id,
        nameEn,
        createdById: user.id,
        versions: { create: { startingChapter: 0, createdById: user.id } },
      },
    });

    const target = await makeKeyword(`Target ${marker}`);
    const alias = await prisma.keywordAlias.create({
      data: { keywordId: target.id, nameAr: 'لقب تجريبي', createdById: user.id },
    });
    const first = await makeKeyword(`First ${marker}`);
    const second = await makeKeyword(`Second ${marker}`);
    const links = await Promise.all([
      request('POST', `/keywords/${first.id}/link-alias`, { aliasId: alias.id }),
      request('POST', `/keywords/${second.id}/link-alias`, { aliasId: alias.id }),
    ]);
    expect(links.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(await prisma.keyword.count({ where: { id: { in: [first.id, second.id] } } })).toBe(1);

    const dedupeTarget = await makeKeyword(`Dedupe target ${marker}`);
    await prisma.keywordAlias.create({
      data: { keywordId: dedupeTarget.id, nameAr: 'أليس', nameEn: 'Alice', createdById: user.id },
    });
    const source = await makeKeyword(`Third ${marker}`);
    await prisma.keywordAlias.create({
      data: { keywordId: source.id, nameAr: 'أليس', nameEn: 'Alyss', createdById: user.id },
    });
    const merged = await request('POST', `/keywords/${source.id}/alias`, { targetId: dedupeTarget.id });
    expect(merged.status).toBe(200);
    expect(await prisma.keywordAlias.findFirst({ where: { keywordId: dedupeTarget.id, nameEn: 'Alyss' } })).not.toBeNull();
    expect(await prisma.keywordAlias.count({ where: { keywordId: dedupeTarget.id, nameAr: 'أليس' } })).toBe(1);

    const twinAlias = await prisma.keywordAlias.create({
      data: { keywordId: dedupeTarget.id, nameEn: 'Twin', createdById: user.id },
    });
    const twinSource = await makeKeyword(`Twin source ${marker}`);
    await prisma.keywordAlias.create({
      data: { keywordId: twinSource.id, nameEn: 'Twin', nameAr: 'توأم', createdById: user.id },
    });
    const twinMerge = await request('POST', `/keywords/${twinSource.id}/alias`, { targetId: dedupeTarget.id });
    expect(twinMerge.status).toBe(200);
    expect((await prisma.keywordAlias.findUniqueOrThrow({ where: { id: twinAlias.id } })).nameAr).toBe('توأم');
    const otherTwin = await makeKeyword(`Other twin ${marker}`);
    await prisma.keywordAlias.create({
      data: { keywordId: otherTwin.id, nameEn: 'Twin', nameAr: 'توأمان', createdById: user.id },
    });
    const otherTwinMerge = await request('POST', `/keywords/${otherTwin.id}/alias`, { targetId: dedupeTarget.id });
    expect(otherTwinMerge.status).toBe(200);
    expect(await prisma.keywordAlias.findFirst({ where: { keywordId: dedupeTarget.id, nameAr: 'توأمان' } })).not.toBeNull();

    const guarded = await makeKeyword(`Guarded ${marker}`);
    await prisma.keywordVersion.create({ data: { keywordId: guarded.id, startingChapter: 10, createdById: user.id } });
    const refused = await request('POST', `/keywords/${guarded.id}/link-alias`, { aliasId: alias.id });
    expect(refused.status).toBe(409);
    expect(await prisma.keyword.findUnique({ where: { id: guarded.id } })).not.toBeNull();

    const base = await prisma.keywordVersion.findFirstOrThrow({
      where: { keywordId: target.id }, orderBy: { startingChapter: 'asc' },
    });
    const added = await request('POST', '/keyword-versions/', { keywordId: target.id, startingChapter: 10 });
    expect(added.status).toBe(200);
    const middle = await added.json() as { id: string };
    const next = await request('POST', '/keyword-versions/', { keywordId: target.id, startingChapter: 20 });
    expect(next.status).toBe(200);
    const overlap = await request('PUT', `/keyword-versions/${middle.id}`, { endingChapter: 20 });
    expect(overlap.status).toBe(409);
    const deleted = await request('DELETE', `/keyword-versions/${middle.id}`);
    expect(deleted.status).toBe(200);
    expect((await prisma.keywordVersion.findUniqueOrThrow({ where: { id: base.id } })).endingChapter).toBe(19);
    const latest = await next.json() as { id: string };
    const moved = await request('PUT', `/keyword-versions/${latest.id}`, { startingChapter: 25 });
    expect(moved.status).toBe(200);
    expect((await prisma.keywordVersion.findUniqueOrThrow({ where: { id: base.id } })).endingChapter).toBe(24);

    const folded = await makeKeyword(`Folded ${marker}`);
    const foldedResponse = await request('POST', `/keywords/${folded.id}/version`, { targetId: target.id });
    expect(foldedResponse.status).toBe(200);
    expect((await prisma.keywordVersion.findUniqueOrThrow({ where: { id: latest.id } })).endingChapter).toBe(25);
  } finally {
    if (novelId) await prisma.novel.delete({ where: { id: novelId } });
    if (userId) await prisma.user.delete({ where: { id: userId } });
  }
});
