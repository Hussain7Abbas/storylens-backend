import { getBillingConfig } from '@/lib/billing/config';
import { grantTrialGift } from '@/lib/billing/trial';
import { prisma } from '@/lib/db';

// Gives the trial lenses to registered readers who do not have them yet (decision D2:
// readers registered before lenses existed). Dry run unless CONFIRM=1. Idempotent.
const apply = process.env.CONFIRM === '1';

try {
  const { trialLenses } = await getBillingConfig(prisma);
  if (trialLenses <= 0) {
    console.log('Lens_Trial_Gift is 0: nothing to grant');
  } else {
    const readers = await prisma.user.findMany({
      where: { isUser: true, isGuest: false, lensTransactions: { none: { type: 'TRIAL_GIFT' } } },
      select: { id: true },
    });
    if (!apply) {
      console.log(`Dry run: ${readers.length} readers would get ${trialLenses} lenses. Run with CONFIRM=1 to grant.`);
    } else {
      let granted = 0;
      for (const reader of readers) {
        const gift = await prisma.$transaction((tx) => grantTrialGift(tx, reader.id));
        if (gift) granted++;
      }
      console.log(`Granted ${trialLenses} lenses to ${granted} readers`);
    }
  }
} finally {
  await prisma.$disconnect();
}
