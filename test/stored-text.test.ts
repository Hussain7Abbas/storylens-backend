import { describe, expect, it } from 'bun:test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { sanitize, sanitizeObject } from '@/utils/sanitize';

// The API stores text exactly as typed (trimmed, not HTML-escaped), so no client
// may insert stored text as HTML. Reading `innerHTML` is fine; writing it is not.
const HTML_WRITES = /\.(innerHTML|outerHTML)\s*=[^=]|insertAdjacentHTML\s*\(|dangerouslySetInnerHTML|document\.write\s*\(/;
const apps = ['extension', 'dashboard', 'website'].map((app) => join(import.meta.dir, '../..', app, 'src'));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return entry === 'generated' || entry === 'node_modules' ? [] : sourceFiles(path);
    return /\.(tsx?|jsx?)$/.test(entry) ? [path] : [];
  });
}

describe('stored text', () => {
  it('is trimmed but not escaped', () => {
    expect(sanitize("  D'Artagnan <b>\"x\"</b> ")).toBe("D'Artagnan <b>\"x\"</b>");
    expect(sanitizeObject({ name: " O'Brien ", tags: [' <i> '] })).toEqual({ name: "O'Brien", tags: ['<i>'] });
  });

  it('is never inserted as HTML by the extension, dashboard or website', () => {
    const present = apps.filter((dir) => existsSync(dir));
    // Only a submodule checked out on its own lacks its siblings.
    if (!present.length) return;
    const hits = present.flatMap((dir) =>
      sourceFiles(dir).flatMap((file) =>
        readFileSync(file, 'utf8')
          .split('\n')
          .flatMap((line, index) => (HTML_WRITES.test(line) ? [`${file}:${index + 1}: ${line.trim()}`] : [])),
      ),
    );
    expect(hits).toEqual([]);
  });
});
