import { resolve } from 'node:path';
import chalk from 'chalk';
import { deprecationStatus, scanDeprecations } from '@/lib/compat/deprecation-scan';

/**
 * Lists every deprecation with its removal date. Exits 1 when a marker lacks a
 * valid date or its date has passed; `test/deprecations.test.ts` enforces the same.
 */
const root = resolve(import.meta.dir, '../..');
const { files, markers, issues } = await scanDeprecations(root);

const label = {
  expired: chalk.bold.red('EXPIRED '),
  'due-soon': chalk.bold.yellow('DUE SOON'),
  ok: chalk.green('ok      '),
};

console.log(`Scanned ${files} files, found ${markers.length} deprecation(s).`);
let expired = 0;
for (const marker of markers) {
  const status = deprecationStatus(marker.removeAfter);
  if (status === 'expired') expired += 1;
  console.log(`${label[status]} ${marker.removeAfter}  ${marker.file}:${marker.line}  ${chalk.gray(marker.text)}`);
}

for (const issue of issues) {
  console.log(`${chalk.bold.red('INVALID ')} ${issue.file}:${issue.line}  ${issue.message}`);
}

if (files === 0) {
  console.error(chalk.red('No files scanned; check the scan globs.'));
  process.exit(1);
}

if (expired || issues.length) {
  console.error(chalk.red('Remove expired deprecations (or move their date deliberately) and fix invalid markers.'));
  process.exit(1);
}
