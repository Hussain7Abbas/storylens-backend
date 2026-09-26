import { prisma } from '@/lib/db';
import { isValidExtensionVersion, REVIEW_VERSION_KEY } from '@/lib/review-version';

/**
 * Records the extension version submitted to the Chrome Web Store.
 * Usage: make set-review-version VERSION=1.5.1
 */
const version = process.argv[2]?.trim() ?? '';

if (!isValidExtensionVersion(version)) {
  console.error(`Invalid extension version "${version}". Usage: make set-review-version VERSION=1.5.1`);
  process.exit(1);
}

try {
  await prisma.config.upsert({
    where: { key: REVIEW_VERSION_KEY },
    create: { key: REVIEW_VERSION_KEY, value: version },
    update: { value: version },
  });
  console.log(`${REVIEW_VERSION_KEY} set to ${version}`);
} finally {
  await prisma.$disconnect();
}
