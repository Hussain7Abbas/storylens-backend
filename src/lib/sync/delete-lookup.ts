import { Prisma, type PrismaClient } from '@prisma/client';
import { HttpError } from '@/utils/errors';

type Kind = 'keywordCategory' | 'keywordNature';
type Translate = (messages: { en: string; ar: string }) => string;

/** Lock lookup rows before checking use: concurrent FK writes cannot slip past deletion. */
export async function deleteLookup(prisma: PrismaClient, kind: Kind, id: string, replacementId: string | undefined, t: Translate): Promise<void> {
  if (replacementId === id) throw new HttpError({ statusCode: 422, code: 'LOOKUP_REPLACEMENT_INVALID', message: t({ en: 'Choose a different replacement', ar: 'اختر بديلاً مختلفاً' }) });
  await prisma.$transaction(async tx => {
    const ids = [...new Set([id, ...(replacementId ? [replacementId] : [])])].sort();
    const locked = kind === 'keywordCategory'
      ? await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM "KeywordCategory" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`)
      : await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM "KeywordNature" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`);
    if (!locked.some(row => row.id === id)) throw new HttpError({ statusCode: 404, code: 'NOT_FOUND', message: t({ en: 'Item not found', ar: 'العنصر غير موجود' }) });
    if (replacementId && !locked.some(row => row.id === replacementId)) throw new HttpError({ statusCode: 404, code: 'PARENT_NOT_FOUND', message: t({ en: 'Replacement no longer exists', ar: 'البديل لم يعد موجوداً' }) });
    const where = kind === 'keywordCategory' ? { categoryId: id } : { natureId: id };
    if (replacementId) {
      const data = kind === 'keywordCategory' ? { categoryId: replacementId } : { natureId: replacementId };
      await tx.keywordVersion.updateMany({ where, data });
      await tx.keywordAlias.updateMany({ where, data });
    } else {
      const [versions, aliases] = await Promise.all([tx.keywordVersion.count({ where }), tx.keywordAlias.count({ where })]);
      if (versions || aliases) throw new HttpError({ statusCode: 400, code: kind === 'keywordCategory' ? 'CATEGORY_IN_USE' : 'NATURE_IN_USE', message: t({ en: 'Choose a replacement for the linked data before deleting', ar: 'اختر بديلاً للبيانات المرتبطة قبل الحذف' }) });
    }
    if (kind === 'keywordCategory') await tx.keywordCategory.delete({ where: { id } });
    else await tx.keywordNature.delete({ where: { id } });
  });
}
