import { auditBalances } from '@/lib/billing/ledger';
import { prisma } from '@/lib/db';

// Read-only: compares every balance with the sum of its ledger rows.
try {
  const mismatches = await auditBalances(prisma);
  if (mismatches.length === 0) {
    console.log('Lens audit: every balance matches its ledger');
  } else {
    for (const row of mismatches) {
      console.error(`Lens audit mismatch: user ${row.userId} balance ${row.balance}, ledger ${row.ledger}`);
    }
    process.exitCode = 1;
  }
} finally {
  await prisma.$disconnect();
}
