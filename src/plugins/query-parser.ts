import { Elysia } from 'elysia';

/**
 * Convert string values to appropriate types
 */
function convertValue(value: string): string | number | boolean {
  // Convert to number if it's a valid number
  if (!Number.isNaN(Number(value)) && value.trim() !== '') {
    return Number(value);
  }

  // Convert to boolean if it's a boolean string
  if (value.toLowerCase() === 'true') {
    return true;
  }
  if (value.toLowerCase() === 'false') {
    return false;
  }

  // Return as string otherwise
  return value;
}

/**
 * Plugin to parse bracket notation query parameters into nested objects
 * Converts pagination[page]=2&pagination[pageSize]=5 to { pagination: { page: 2, pageSize: 5 } }
 */
export const queryParser = new Elysia({ name: 'query-parser' }).derive(
  { as: 'scoped' },
  ({ query }) => {
    const parsedQuery: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(query)) {
      // Check if the key contains bracket notation
      if (key.includes('[') && key.includes(']')) {
        // Extract the parent key and nested key
        const match = key.match(/^([^[]+)\[([^\]]+)\]$/);
        if (match) {
          const parentKey = match[1];
          const nestedKey = match[2];

          if (parentKey && nestedKey) {
            // Initialize parent object if it doesn't exist
            if (!parsedQuery[parentKey]) {
              parsedQuery[parentKey] = {};
            }

            // Set the nested value with type conversion
            (parsedQuery[parentKey] as Record<string, unknown>)[nestedKey] =
              convertValue(value);
          }
        }
      } else {
        // Regular key-value pair with type conversion
        parsedQuery[key] = convertValue(value);
      }
    }

    return {
      query: parsedQuery,
    };
  },
);
