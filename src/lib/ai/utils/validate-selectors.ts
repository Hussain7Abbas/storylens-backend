import type { WebsiteSelector } from '../schemas/chapter-selector';
import { cleanNovelTitle } from '@/lib/utils/novel-title';
import {
  createDocumentFromHtml,
  extractNovelNameFromXpath,
  extractTextFromXpath,
  getRawTextFromXpath,
} from './xpath';

export type SelectorValidation = {
  novelSlug: string | null;
  novelName: string | null;
  chapter: number | null;
  errors: string[];
};

function extractFromUrl(pageUrl: string, regex: string): string | null {
  const match = pageUrl.match(new RegExp(regex));
  return match ? (match[1] ?? null) : null;
}

function isValidNovelSlug(slug: string | null): slug is string {
  return (
    !!slug &&
    slug.length >= 2 &&
    !/^https?:?$/.test(slug) &&
    !/[\s\u0600-\u06FF]/.test(slug)
  );
}

function isValidNovelName(name: string | null): name is string {
  return !!name && name.trim().length >= 2;
}

export function validateWebsiteSelectors(
  selectors: WebsiteSelector,
  pageUrl: string,
  html: string,
): SelectorValidation {
  const document = createDocumentFromHtml(html);
  const errors: string[] = [];

  let novelSlug: string | null = null;
  let novelName: string | null = null;

  if (selectors.novel.url?.regex) {
    novelSlug = extractFromUrl(pageUrl, selectors.novel.url.regex);
    if (!isValidNovelSlug(novelSlug)) {
      errors.push('Novel URL regex did not match a valid novel slug.');
    }
  } else if (selectors.novel.xpath?.value) {
    novelSlug = extractTextFromXpath(
      selectors.novel.xpath.value,
      selectors.novel.xpath.regex,
      document,
    );
    if (!isValidNovelSlug(novelSlug)) {
      errors.push('Novel XPath did not match a valid novel slug.');
    }
  } else {
    errors.push('No novel selector (XPath or URL regex) was provided.');
  }

  if (selectors.novel.xpath?.value) {
    novelName = extractNovelNameFromXpath(
      selectors.novel.xpath.value,
      selectors.novel.xpath.regex,
      document,
    );
    if (!isValidNovelName(novelName)) {
      const rawText = getRawTextFromXpath(selectors.novel.xpath.value, document);
      if (rawText) {
        errors.push(
          `Novel XPath did not match a valid novel name. XPath text was: "${rawText.slice(0, 120)}"`,
        );
      } else {
        errors.push('Novel XPath did not match any element on the page.');
      }
    }
  }

  let chapter: number | null = null;

  if (selectors.chapter.xpath?.value) {
    const chapterText = extractTextFromXpath(
      selectors.chapter.xpath.value,
      selectors.chapter.xpath.regex,
      document,
    );
    chapter = chapterText ? Number.parseInt(chapterText, 10) : null;
    if (!chapter || Number.isNaN(chapter)) {
      errors.push('Chapter XPath did not produce a valid chapter number.');
    }
  } else if (selectors.chapter.url?.regex) {
    const chapterText = extractFromUrl(pageUrl, selectors.chapter.url.regex);
    chapter = chapterText ? Number.parseInt(chapterText, 10) : null;
    if (!chapter || Number.isNaN(chapter)) {
      errors.push('Chapter URL regex did not produce a valid chapter number.');
    }
  } else {
    errors.push('No chapter selector (XPath or URL regex) was provided.');
  }

  return { novelSlug, novelName, chapter, errors };
}

export function applyNovelFormNameFallback(
  validation: SelectorValidation,
  novelFormName: string | undefined,
): SelectorValidation {
  if (isValidNovelName(validation.novelName) || !novelFormName) {
    return validation;
  }

  const cleanedName = cleanNovelTitle(novelFormName);
  if (!isValidNovelName(cleanedName)) {
    return validation;
  }

  return {
    ...validation,
    novelName: cleanedName,
    errors: validation.errors.filter(
      (error) =>
        !error.startsWith('Novel XPath did not match a valid novel name') &&
        !error.startsWith('Novel XPath did not match any element'),
    ),
  };
}
