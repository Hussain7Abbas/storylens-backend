import type { PrismaClient } from '@prisma/client';
import { authUserInclude, type AuthUserPayload, type UserWithAccess, verifyCredentialPassword } from '@/lib/auth/session';
import { consumeRegistration } from '@/lib/auth/registration';
import { grantTrialGift, type TrialGift } from '@/lib/billing/trial';
import { SYSTEM_ROLES, systemRoleId } from '@/lib/permissions';
import { HttpError } from '@/utils/errors';
import { sanitize } from '@/utils/sanitize';

/**
 * Reader sign-in and registration shared by the bearer routes
 * (`/api/user/auth/*`, extension and older websites) and the website's cookie
 * routes (`/api/user/auth/web/*`).
 */

export type Translate = (text: { en: string; ar: string }) => string;

// Only a guest upgrades in place, so only its own row is not a conflict.
export function guestId(user: { id: string; isGuest: boolean } | null): string | undefined {
  return user?.isGuest ? user.id : undefined;
}

// A guest registering may keep its own username; any other match is taken.
export async function assertRegistrationAvailable(
  prisma: PrismaClient,
  { email, username }: { email: string; username: string },
  currentUserId: string | undefined,
  translate: Translate,
): Promise<void> {
  const existingEmail = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });

  if (existingEmail && existingEmail.id !== currentUserId) {
    throw new HttpError({
      message: translate({
        en: 'Email already registered',
        ar: 'البريد الإلكتروني مسجل بالفعل',
      }),
    });
  }

  const existingUsername = await prisma.user.findUnique({
    where: { username },
    select: { id: true },
  });

  if (existingUsername && existingUsername.id !== currentUserId) {
    throw new HttpError({
      message: translate({
        en: 'Username already taken',
        ar: 'اسم المستخدم مأخوذ بالفعل',
      }),
    });
  }
}

// Accounts without reader access (dashboard-only) can't use the reader API;
// a dashboard user can grant it from the Users page.
export function assertReaderPortal(user: { isUser: boolean }, translate: Translate): void {
  if (!user.isUser) {
    throw new HttpError({
      statusCode: 403,
      message: translate({
        en: 'This account does not have reader access',
        ar: 'لا يملك هذا الحساب صلاحية القارئ',
      }),
    });
  }
}

/** Checks an email and password; refuses accounts without reader access. */
export async function verifyLogin(
  prisma: PrismaClient,
  rawEmail: string,
  password: string,
  translate: Translate,
): Promise<UserWithAccess> {
  const email = rawEmail.toLowerCase();
  const user = await prisma.user.findUnique({ where: { email }, include: authUserInclude });
  const invalid = () =>
    new HttpError({
      statusCode: 401,
      message: translate({
        en: 'Invalid email or password',
        ar: 'بريد إلكتروني أو كلمة مرور غير صالحة',
      }),
    });
  if (!user) throw invalid();
  if (!(await verifyCredentialPassword(prisma, user.id, password))) throw invalid();
  assertReaderPortal(user, translate);
  return user;
}

/**
 * Accepts the emailed registration code and creates the account, or upgrades
 * the guest `currentUser` in place, with the trial gift in the same transaction.
 */
export async function completeRegistration(
  prisma: PrismaClient,
  input: { email: string; code: string; currentUser: AuthUserPayload | null; translate: Translate },
): Promise<{ user: UserWithAccess; gift: TrialGift | null }> {
  const { currentUser, translate } = input;
  const email = sanitize(input.email).toLowerCase();
  const result = await consumeRegistration(prisma, email, input.code);

  if (result.status === 'expired') {
    throw new HttpError({
      message: translate({
        en: 'This code has expired. Request a new one.',
        ar: 'انتهت صلاحية هذا الرمز. اطلب رمزًا جديدًا.',
      }),
    });
  }

  if (result.status === 'invalid') {
    throw new HttpError({
      message:
        result.attemptsLeft > 0
          ? translate({
              en: `Incorrect code. ${result.attemptsLeft} attempts left.`,
              ar: `رمز غير صحيح. المحاولات المتبقية: ${result.attemptsLeft}.`,
            })
          : translate({
              en: 'Too many incorrect attempts. Request a new code.',
              ar: 'محاولات خاطئة كثيرة. اطلب رمزًا جديدًا.',
            }),
    });
  }

  const { registration } = result;
  // The email or username may have been taken while the code was pending.
  await assertRegistrationAvailable(prisma, registration, guestId(currentUser), translate);

  const data = {
    email: registration.email,
    username: registration.username,
    password: registration.passwordHash,
    name: registration.name,
    isUser: true,
    isGuest: false,
    userRoleId: await systemRoleId(prisma, SYSTEM_ROLES.reader),
    emailVerified: true,
  };

  // A verified registration gets the trial lenses once (`Lens_Trial_Gift`).
  if (currentUser?.isGuest) {
    return prisma.$transaction(async (tx) => {
      const upgraded = await tx.user.update({
        where: { id: currentUser.id },
        data,
        include: authUserInclude,
      });

      const account = await tx.account.findFirst({
        where: { userId: upgraded.id, providerId: 'credential' },
      });

      if (account) {
        await tx.account.update({
          where: { id: account.id },
          data: { accountId: data.email, password: data.password },
        });
      } else {
        await tx.account.create({
          data: {
            accountId: data.email,
            providerId: 'credential',
            userId: upgraded.id,
            password: data.password,
          },
        });
      }

      return { user: upgraded, gift: await grantTrialGift(tx, upgraded.id) };
    });
  }

  return prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        ...data,
        accounts: {
          create: {
            accountId: data.email,
            providerId: 'credential',
            password: data.password,
          },
        },
      },
      include: authUserInclude,
    });
    return { user: created, gift: await grantTrialGift(tx, created.id) };
  });
}
