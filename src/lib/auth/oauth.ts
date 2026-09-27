import type { PrismaClient } from '@prisma/client';

type UsernameLookup = Pick<PrismaClient, 'user'>;

// Usernames can be shown to other readers, so derive them from the display
// name rather than the email address.
function usernameBase(name?: string | null): string {
  const base = (name ?? '').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 20);
  return base.length >= 3 ? base : `reader${base}`;
}

/** Derives a free username (3–30 chars) for an account created through OAuth. */
export async function generateUniqueUsername(
  prisma: UsernameLookup,
  name?: string | null,
): Promise<string> {
  const base = usernameBase(name);
  for (let attempt = 0; attempt < 8; attempt++) {
    const candidate =
      attempt === 0 ? base : `${base}${Math.floor(1000 + Math.random() * 9000)}`;
    const taken = await prisma.user.findUnique({
      where: { username: candidate },
      select: { id: true },
    });
    if (!taken) return candidate;
  }
  return `${base}${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
}

/**
 * Moves everything a guest created to `userId`, then deletes the guest
 * (its sessions and credential account cascade).
 */
export async function mergeGuestInto(
  prisma: PrismaClient,
  guestId: string,
  userId: string,
): Promise<void> {
  const from = { createdById: guestId };
  const to = { createdById: userId };
  await prisma.$transaction([
    prisma.novel.updateMany({ where: from, data: to }),
    prisma.keyword.updateMany({ where: from, data: to }),
    prisma.keywordAlias.updateMany({ where: from, data: to }),
    prisma.keywordVersion.updateMany({ where: from, data: to }),
    prisma.replacement.updateMany({ where: from, data: to }),
    prisma.file.updateMany({ where: { userId: guestId }, data: { userId } }),
    prisma.user.delete({ where: { id: guestId } }),
  ]);
}
