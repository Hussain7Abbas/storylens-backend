export const REASONING_EFFORTS = ['auto', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export const IMAGE_QUALITIES = ['auto', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export type ReasoningEffort = typeof REASONING_EFFORTS[number];
export type ImageQuality = typeof IMAGE_QUALITIES[number];

/** Model defaults remain usable after changing to a model with different capabilities. */
export function effectiveEffort(value: ReasoningEffort, model?: { reasoningEfforts: string[] | null; reasoningMandatory: boolean }): ReasoningEffort {
  if (value === 'auto' || !model) return value;
  if (value === 'none' && model.reasoningMandatory) return 'auto';
  return model.reasoningEfforts !== null && !model.reasoningEfforts.includes(value) ? 'auto' : value;
}
export function effectiveQuality(value: ImageQuality, qualities?: string[]): ImageQuality {
  return value !== 'auto' && qualities && !qualities.includes(value) ? 'auto' : value;
}
