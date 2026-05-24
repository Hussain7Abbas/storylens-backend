#!/usr/bin/env bun
import { detectChapterSelectors } from '../agents/chapter-selector-agent';

const url = process.argv[2];
const htmlPath = process.argv[3];

if (!url || !htmlPath) {
  console.error('Usage: bun run detect-selectors <chapter-url> <html-file-path>');
  process.exit(1);
}

const html = await Bun.file(htmlPath).text();
const output = await detectChapterSelectors({ url, html });

console.log(JSON.stringify(output, null, 2));
