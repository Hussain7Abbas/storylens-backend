import { describe, expect, it } from 'bun:test';
import { versionEditNeighbors } from '@/routes/admin/version-ranges';

const versions = [
  { id: 'base', startingChapter: 0, endingChapter: 9 },
  { id: 'middle', startingChapter: 10, endingChapter: 19 },
  { id: 'latest', startingChapter: 20, endingChapter: null },
];

describe('admin version range edits', () => {
  it('rejects an overlap with the following version', () => {
    expect(() => versionEditNeighbors(versions, 'middle', 10, 20)).toThrow();
    expect(versionEditNeighbors(versions, 'middle', 10, null).endingChapter).toBe(19);
  });

  it('allows moving a start within its neighbors so the previous end can follow', () => {
    expect(versionEditNeighbors(versions, 'middle', 5, 19).previous?.id).toBe('base');
    expect(() => versionEditNeighbors(versions, 'middle', 20, 20)).toThrow();
  });

  it('allows a nonzero base while preserving the following range', () => {
    expect(versionEditNeighbors(versions, 'base', 1, 9).next?.id).toBe('middle');
    expect(() => versionEditNeighbors(versions, 'base', 10, 10)).toThrow();
  });
});
