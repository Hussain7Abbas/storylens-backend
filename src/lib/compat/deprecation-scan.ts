import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { endOfDay, parseDeprecationDate } from './deprecation';

/** A deprecation found in source, with the date support may end. */
export type DeprecationMarker = { file: string; line: number; removeAfter: string; text: string };
export type DeprecationIssue = { file: string; line: number; message: string };
export type DeprecationScan = { files: number; markers: DeprecationMarker[]; issues: DeprecationIssue[] };
export type DeprecationStatus = 'expired' | 'due-soon' | 'ok';

/** Files the scan reads, relative to the backend root. */
const SCAN_GLOBS = ['src/**/*.ts', 'prisma/schema.prisma'];
/** Files that define the deprecation mechanism itself, so they mention its markers. */
const MECHANISM_FILES = new Set([
  'src/lib/compat/deprecation.ts',
  'src/lib/compat/deprecation-scan.ts',
  'src/plugins/deprecation.ts',
]);

const COMMENT_MARKER = /@deprecated\b/;
const COMMENT_REMOVE_AFTER = /remove-after:\s*([^\s"'`),;*]+)/;
const OPTION_REMOVE_AFTER = /\bremoveAfter:\s*['"`]([^'"`]*)['"`]/g;
const BARE_FLAG = /\bdeprecated:\s*true\b/;

/** Warn this many days before a deprecation's removal date. */
export const DUE_SOON_DAYS = 30;

/**
 * Finds deprecation markers in one file. Every `@deprecated` comment (JSDoc or
 * Prisma `///`) must carry `remove-after: YYYY-MM-DD` on the same line; route
 * options and `deprecate()` carry `removeAfter`. A bare `deprecated: true` is an
 * issue because it has no removal date.
 */
export function scanSource(file: string, text: string): Omit<DeprecationScan, 'files'> {
  const markers: DeprecationMarker[] = [];
  const issues: DeprecationIssue[] = [];

  const addMarker = (line: number, value: string, source: string) => {
    try {
      parseDeprecationDate(value);
      markers.push({ file, line, removeAfter: value, text: source.trim() });
    } catch (error) {
      issues.push({ file, line, message: error instanceof Error ? error.message : String(error) });
    }
  };

  text.split('\n').forEach((source, index) => {
    const line = index + 1;

    if (COMMENT_MARKER.test(source)) {
      const date = COMMENT_REMOVE_AFTER.exec(source)?.[1];
      if (date) addMarker(line, date, source);
      else issues.push({ file, line, message: '@deprecated needs "remove-after: YYYY-MM-DD" on the same line' });
    }

    for (const match of source.matchAll(OPTION_REMOVE_AFTER)) {
      addMarker(line, match[1] ?? '', source);
    }

    if (BARE_FLAG.test(source)) {
      issues.push({
        file,
        line,
        message: 'Use the `deprecated` route option or `deprecate()` instead of a bare `deprecated: true`',
      });
    }
  });

  return { markers, issues };
}

/** Expired once the removal date has fully passed (UTC), due soon within `DUE_SOON_DAYS`. */
export function deprecationStatus(removeAfter: string, now: Date = new Date()): DeprecationStatus {
  const end = endOfDay(parseDeprecationDate(removeAfter));
  if (now >= end) return 'expired';

  const dueSoonFrom = new Date(end.getTime() - DUE_SOON_DAYS * 24 * 60 * 60 * 1000);
  return now >= dueSoonFrom ? 'due-soon' : 'ok';
}

/** Scans the backend's source and Prisma schema. */
export async function scanDeprecations(root: string): Promise<DeprecationScan> {
  const markers: DeprecationMarker[] = [];
  const issues: DeprecationIssue[] = [];
  let files = 0;

  for (const pattern of SCAN_GLOBS) {
    for await (const file of new Bun.Glob(pattern).scan({ cwd: root })) {
      if (MECHANISM_FILES.has(file)) continue;

      files += 1;
      const result = scanSource(file, await readFile(join(root, file), 'utf8'));
      markers.push(...result.markers);
      issues.push(...result.issues);
    }
  }

  markers.sort((a, b) => a.removeAfter.localeCompare(b.removeAfter) || a.file.localeCompare(b.file));
  return { files, markers, issues };
}
