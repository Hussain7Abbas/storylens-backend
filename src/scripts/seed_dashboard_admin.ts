import { prisma } from '@/lib/db';
import { seedDashboardAdmin } from '../../prisma/seed/tables/dashboard-admin';

// Creates or resets only the dashboard super admin, without the rest of the seed.
try {
  await seedDashboardAdmin(prisma);
} finally {
  await prisma.$disconnect();
}
