import type { Band } from './boardAttention.js';

const COPY: Record<Band, { label: string; hint: string }> = {
  'needs-you': {
    label: 'Needs you',
    hint: 'A gate is open or a recent run failed — your attention is required.',
  },
  working: {
    label: 'Working',
    hint: 'A run is active and progressing without your input.',
  },
  quiet: {
    label: 'Quiet',
    hint: 'No active runs or open gates — this project is idle.',
  },
};

export function bandLabel(band: Band): string {
  return COPY[band].label;
}

export function bandHint(band: Band): string {
  return COPY[band].hint;
}
