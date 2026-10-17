import { expect } from 'bun:test';
import type { KeywordCategory, KeywordNature } from '@prisma/client';
import { prisma } from '@/lib/db';
import { createSessionToken } from '@/lib/auth/session';
import { syncPermissions } from '@/lib/permissions';
import { app } from '@/server';
import { cleanup, live, makeActor } from './helpers/live-db';

for (const kind of ['categories', 'natures'] as const) {
  live(`admin ${kind}: CRUD, validation, stale writes, replacement and permissions`, async () => {
    const marker = crypto.randomUUID();
    const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()] as const;
    const users: string[] = [];
    let novelId: string | undefined;
    let roleId: string | undefined;
    const path = `/keyword-${kind}/`;
    try {
      await syncPermissions(prisma, app.routes);
      const role = await prisma.role.findUniqueOrThrow({ where: { slug: 'super-admin' } });
      const admin = await prisma.user.create({ data: {
        email: `lookup-admin-${marker}@example.invalid`, username: `lookup-admin-${marker}`,
        name: 'Lookup admin', password: 'unused', isUser: false, isAdmin: true, adminRoleId: role.id,
      } });
      users.push(admin.id);
      const token = await createSessionToken(prisma, admin.id, 'admin');
      const request = async (method: string, suffix = '', body?: object, auth = token) => {
        const response = await app.handle(new Request(`http://localhost/api/admin${path}${suffix}`, {
          method, headers: { Authorization: `Bearer ${auth}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
          body: body ? JSON.stringify(body) : undefined,
        }));
        return { status: response.status, body: await response.json() as KeywordCategory & KeywordNature & { code?: string } };
      };
      const data = { id: ids[0], nameEn: ` Test ${marker} `, nameAr: ' ', color: '#abcdef', description: 'AI guidance',
        ...(kind === 'categories' ? { wordVfx: 'HEAT', wordVfxColor: '#123456', switchPositionWithNature: true } : {}),
      };
      expect((await request('POST', '', { ...data, nameEn: ' ', nameAr: null })).status).toBe(422);
      expect((await request('POST', '', { ...data, color: '#abc' })).status).toBe(422);
      expect((await request('POST', '', { ...data, description: 'x'.repeat(1001) })).status).toBe(422);
      const created = await request('POST', '', data);
      expect(created.status).toBe(200);
      expect(created.body.nameEn).toBe(`Test ${marker}`);
      expect(created.body.nameAr).toBeNull();
      expect((await request('POST', '', data)).body.id).toBe(ids[0]);
      expect((await request('POST', '', { ...data, id: ids[2] })).status).toBe(409);
      expect((await request('PUT', ids[0], { baseUpdatedAt: created.body.updatedAt, nameEn: null, nameAr: ' ' })).status).toBe(422);
      const updated = await request('PUT', ids[0], { baseUpdatedAt: created.body.updatedAt, color: '#445566', description: null });
      expect(updated.status).toBe(200);
      expect(updated.body.nameEn).toBe(`Test ${marker}`);
      expect(updated.body.description).toBeNull();
      if (kind === 'categories') {
        expect(updated.body.wordVfx).toBe('HEAT');
        expect(updated.body.wordVfxColor).toBe('#123456');
        expect(updated.body.switchPositionWithNature).toBe(true);
        // Supported dashboard releases may still update only VFX.
        const vfx = await request('PUT', ids[0], { baseUpdatedAt: updated.body.updatedAt, wordVfx: 'GLARE', wordVfxColor: null });
        expect(vfx.status).toBe(200);
        expect(vfx.body.nameEn).toBe(`Test ${marker}`);
        expect(vfx.body.color).toBe('#445566');
      }
      const stale = await request('PUT', ids[0], { baseUpdatedAt: created.body.updatedAt, color: '#000000' });
      expect(stale.status).toBe(409);
      expect(stale.body.code).toBe('STALE_WRITE');
      const replacement = await request('POST', '', { id: ids[1], nameAr: `بديل ${marker}`, color: '#112233' });
      expect(replacement.status).toBe(200);
      expect((await request('GET')).status).toBe(200);
      const novel = await prisma.novel.create({ data: { nameEn: marker, createdById: admin.id } });
      novelId = novel.id;
      const style = kind === 'categories' ? { categoryId: ids[0] } : { natureId: ids[0] };
      const keyword = await prisma.keyword.create({ data: {
        nameEn: marker, novelId: novel.id, createdById: admin.id,
        versions: { create: { startingChapter: 0, createdById: admin.id, ...style } },
        aliases: { create: { nameEn: 'Alias', createdById: admin.id, ...style } },
      }, include: { versions: true, aliases: true } });
      expect((await request('DELETE', ids[0])).status).toBe(400);
      expect((await request('DELETE', `${ids[0]}?replacementId=${ids[0]}`)).status).toBe(422);
      expect((await request('DELETE', `${ids[0]}?replacementId=${ids[2]}`)).status).toBe(404);
      const removed = await request('DELETE', `${ids[0]}?replacementId=${ids[1]}`);
      expect(removed.status).toBe(200);
      const version = await prisma.keywordVersion.findUniqueOrThrow({ where: { id: keyword.versions[0]!.id } });
      const alias = await prisma.keywordAlias.findUniqueOrThrow({ where: { id: keyword.aliases[0]!.id } });
      expect(kind === 'categories' ? version.categoryId : version.natureId).toBe(ids[1]);
      expect(kind === 'categories' ? alias.categoryId : alias.natureId).toBe(ids[1]);
      expect((await request('PUT', ids[0], { baseUpdatedAt: updated.body.updatedAt, color: '#000000' })).status).toBe(404);
      const reader = await makeActor('moderator', marker);
      users.push(reader.id);
      expect((await request('POST', '', { ...data, id: ids[2] }, reader.token)).status).toBe(403);
      const restrictedRole = await prisma.role.create({ data: { name: 'Lookup denied', slug: `lookup-${marker}`, portal: 'admin' } });
      roleId = restrictedRole.id;
      await prisma.user.update({ where: { id: admin.id }, data: { adminRoleId: restrictedRole.id } });
      for (const [method, suffix, body] of [
        ['GET', '', undefined], ['POST', '', { ...data, id: ids[2] }],
        ['PUT', ids[1], { baseUpdatedAt: replacement.body.updatedAt, color: '#000000' }], ['DELETE', ids[1], undefined],
      ] as const) expect((await request(method, suffix, body)).status).toBe(403);
      await prisma.user.update({ where: { id: admin.id }, data: { adminRoleId: role.id } });
      await prisma.novel.delete({ where: { id: novel.id } });
      novelId = undefined;
      expect((await request('DELETE', ids[1])).status).toBe(200);
    } finally {
      await cleanup({ users, novels: novelId ? [novelId] : [], ...(kind === 'categories' ? { categories: [...ids] } : { natures: [...ids] }) });
      if (roleId) await prisma.role.delete({ where: { id: roleId } });
    }
  });
}
