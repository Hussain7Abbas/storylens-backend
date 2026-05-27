export type SeedNovel = {
  name: string;
  slugs: string[];
  lastModified: string;
};

export type SeedKeyword = {
  novelName: string;
  name: string;
  description: string;
  color: string;
  imageUrl: string;
  /** Legacy field — use `mapLegacyRole()` to resolve category + nature */
  role: string;
  timestamp?: number;
};

export type SeedReplacement = {
  novelName: string;
  from: string;
  to: string;
};

export type SeedKeywordCategory = {
  nameEn?: string;
  nameAr?: string;
  color: string;
};

export type SeedKeywordNature = {
  nameEn?: string;
  nameAr?: string;
  color: string;
};

export type KeywordCategoryName = 'انثى' | 'بطل' | 'ذكر' | 'سيد';

export type KeywordNatureName = 'عدو' | 'صديق' | 'بطل';

export type LegacyRoleMapping = {
  category: KeywordCategoryName;
  nature: KeywordNatureName;
};
