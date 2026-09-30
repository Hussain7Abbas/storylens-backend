/**
 * Normalize a single string input by trimming it. Stored text is plain: it is
 * kept exactly as typed (no HTML escaping), and no client may insert it as HTML.
 */
export function sanitize(input: string): string {
  return input.trim();
}

/**
 * Recursively sanitize all string values in an object.
 * Returns a new object with sanitized strings.
 */
export function sanitizeObject<T>(obj: T): T {
  if (typeof obj === 'string') {
    return sanitize(obj) as T;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeObject(item)) as T;
  }

  if (obj !== null && typeof obj === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      sanitized[key] = sanitizeObject(value);
    }
    return sanitized as T;
  }

  return obj;
}
