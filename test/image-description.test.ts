import { expect, test } from 'bun:test';
import { IMAGE_DESCRIPTION_OUTPUT, parseImageDescription } from '@/lib/ai/image-description';

test('only the selected available references accompany the visual description', () => {
  const mira = 'https://images.example.invalid/mira.png';
  const bram = 'https://images.example.invalid/bram.png';
  expect(parseImageDescription(JSON.stringify({ imageDescription: 'Mira crosses an empty bridge at dawn.', referenceImageUrls: [mira] }), [mira, bram]))
    .toEqual({ imageDescription: 'Mira crosses an empty bridge at dawn.', referenceImageUrls: [mira] });
});

for (const output of [
  'A plain string instead of JSON',
  JSON.stringify({ imageDescription: '', referenceImageUrls: [] }),
  JSON.stringify({ imageDescription: 'x'.repeat(4001), referenceImageUrls: [] }),
  JSON.stringify({ imageDescription: 'A scout.', referenceImageUrls: ['https://unknown.example.invalid/image.png'] }),
  JSON.stringify({ imageDescription: 'A scout.', referenceImageUrls: [], chapter: 'unwanted context' }),
  JSON.stringify({ imageDescription: '<CHAPTER>Unfiltered source</CHAPTER>', referenceImageUrls: [] }),
  JSON.stringify({ imageDescription: '<CHAPTER_CONTINUITY>Raw context</CHAPTER_CONTINUITY>', referenceImageUrls: [] }),
]) test('invalid or contaminated descriptions are rejected', () => {
  expect(() => parseImageDescription(output, [])).toThrow();
});


test('the Cloud description step reassesses old loadouts instead of copying reference equipment', () => {
  expect(IMAGE_DESCRIPTION_OUTPUT).toContain('latest applicable earlier observation');
  expect(IMAGE_DESCRIPTION_OUTPUT).toContain('Reference images and old descriptions preserve identity, not old loadouts');
  expect(IMAGE_DESCRIPTION_OUTPUT).toContain('there is no universal helmet-off or armor-on rule');
  expect(IMAGE_DESCRIPTION_OUTPUT).toContain('Do not invent exact ammunition counts');
});
