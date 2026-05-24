import type { LegacyRoleMapping } from '../data/types';

/**
 * Maps legacy `role` values from the old JSON export to category + nature.
 *
 * Legacy roles mixed both concepts:
 * - category-like: انثى, بطل
 * - nature-like:   عدو, صديق, بطل
 * - entity-like:   مدرب, طائفة, مهارة
 */
const legacyRoleMap: Record<string, LegacyRoleMapping> = {
  /** female — category only in legacy data */
  انثى: { category: 'انثى', nature: 'صديق' },
  /** protagonist */
  بطل: { category: 'بطل', nature: 'بطل' },
  /** ally / friend */
  صديق: { category: 'ذكر', nature: 'صديق' },
  /** enemy */
  عدو: { category: 'ذكر', nature: 'عدو' },
  /** mentor / trainer */
  مدرب: { category: 'سيد', nature: 'صديق' },
  /** sect / faction */
  طائفة: { category: 'سيد', nature: 'صديق' },
  /** skill / technique */
  مهارة: { category: 'بطل', nature: 'بطل' },
};

export function mapLegacyRole(role: string): LegacyRoleMapping {
  const mapping = legacyRoleMap[role.trim()];

  if (!mapping) {
    throw new Error(`Unknown legacy role: "${role}"`);
  }

  return mapping;
}
