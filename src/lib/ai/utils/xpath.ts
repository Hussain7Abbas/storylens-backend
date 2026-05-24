import { JSDOM } from 'jsdom';
import { cleanNovelTitle } from '@/lib/utils/novel-title';

export function createDocumentFromHtml(html: string) {
  return new JSDOM(html).window.document;
}

export function getRawTextFromXpath(
  xpathExpression: string,
  document: Document,
): string {
  const xpathResultType =
    document.defaultView?.XPathResult.FIRST_ORDERED_NODE_TYPE ?? 9;

  const result = document.evaluate(
    xpathExpression,
    document,
    null,
    xpathResultType,
    null,
  );

  return (
    result.singleNodeValue?.textContent
      ?.replaceAll('\n', ' ')
      .replace(/\s+/g, ' ')
      .trim() ?? ''
  );
}

export function extractTextFromXpath(
  xpathExpression: string,
  regex: string,
  document: Document,
): string | null {
  const textContent = getRawTextFromXpath(xpathExpression, document);
  if (!textContent) {
    return null;
  }

  try {
    const match = textContent.match(new RegExp(regex));
    if (match) {
      return match[1] ?? match[0] ?? null;
    }
  } catch {
    return null;
  }

  return null;
}

export function extractNovelNameFromXpath(
  xpathExpression: string,
  regex: string,
  document: Document,
): string | null {
  const textContent = getRawTextFromXpath(xpathExpression, document);
  if (!textContent) {
    return null;
  }

  try {
    const match = textContent.match(new RegExp(regex));
    if (match) {
      const captured = match[1] ?? match[0];
      if (captured) {
        const cleaned = cleanNovelTitle(captured);
        if (cleaned.length >= 2) {
          return cleaned;
        }
      }
    }
  } catch {
    // Fall through to cleaning the full xpath text.
  }

  const cleaned = cleanNovelTitle(textContent);
  return cleaned.length >= 2 ? cleaned : null;
}
