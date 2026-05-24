import { parseHTML } from 'linkedom';
import xpath from 'xpath';
import { cleanNovelTitle } from '@/lib/utils/novel-title';

export function createDocumentFromHtml(html: string) {
  const { document } = parseHTML(html);
  return document as unknown as Document;
}

function getNodeTextContent(node: xpath.SelectedValue): string {
  if (typeof node === 'string') {
    return node;
  }

  if (typeof node === 'number' || typeof node === 'boolean') {
    return String(node);
  }

  if (node === null) {
    return '';
  }

  if ('textContent' in node && typeof node.textContent === 'string') {
    return node.textContent;
  }

  return '';
}

export function getRawTextFromXpath(
  xpathExpression: string,
  document: Document,
): string {
  const nodes = xpath.select(xpathExpression, document);
  const node = Array.isArray(nodes) ? nodes[0] : nodes;

  if (node === undefined) {
    return '';
  }

  return getNodeTextContent(node)
    .replaceAll('\n', ' ')
    .replace(/\s+/g, ' ')
    .trim();
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
