const LEADING_SEPARATORS = /^[\s\-|:·–—]+/;

const LEADING_NOVEL_PREFIX = /^رواية\s+/u;

const CHAPTER_SUFFIX_PATTERNS = [
  /\s*(?:[-–—]\s*)?(?:ال)?فصل(?:\s+| رقم )?\d+\s*$/iu,
  /\s*(?:[-–—]\s*)?chapter\s*#?\s*\d+\s*$/iu,
  /\s*(?:[-–—]\s*)?ch\.?\s*\d+\s*$/iu,
];

const METADATA_SUFFIXES = [/\s*مترجمة\s*$/iu, /\s*translated\s*$/iu, /\s*raw\s*$/iu];

function stripMetadataSuffixes(title: string): string {
  let result = title;
  for (const suffix of METADATA_SUFFIXES) {
    result = result.replace(suffix, '').trim();
  }
  return result;
}

function stripLeadingNovelPrefix(title: string): string {
  return title.replace(LEADING_NOVEL_PREFIX, '').trim();
}

function stripChapterSuffix(title: string): string {
  let result = title;
  for (const pattern of CHAPTER_SUFFIX_PATTERNS) {
    result = result.replace(pattern, '').trim();
  }
  return result;
}

function extractFromDashSegments(title: string): string {
  const dashParts = title.split(/\s[-–—]\s/);
  if (dashParts.length >= 3) {
    return dashParts.slice(1, -1).join(' - ').trim();
  }

  if (dashParts.length === 2) {
    const [first, second] = dashParts;
    const firstPart = first?.trim() ?? '';
    const secondPart = second?.trim() ?? '';

    if (!firstPart || /^[\s\-|:·–—]+$/.test(firstPart)) {
      return secondPart;
    }

    if (secondPart.length <= firstPart.length) {
      return firstPart;
    }
  }

  return title;
}

export function cleanNovelTitle(raw: string): string {
  let title = raw.replace(/\s+/g, ' ').trim();
  title = title.replace(LEADING_SEPARATORS, '').trim();
  title = extractFromDashSegments(title);
  title = stripLeadingNovelPrefix(title);
  title = stripChapterSuffix(title);
  title = stripMetadataSuffixes(title);
  title = title.replace(LEADING_SEPARATORS, '').trim();
  title = stripLeadingNovelPrefix(title);

  return stripMetadataSuffixes(title);
}
