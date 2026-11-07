// plugins S4: the video's words say what the engine makes (G15: captions, no voice-over), and its template stacks
// on a phone (G14 video).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import looks from '../src/plugins/firstPartyLooks.json';
import { DEMO_VIDEO_LINE } from '../src/board/demoLaunch.js';
import { STAGE_LINE, rerecordNote } from '../src/api/demo.js';

describe('G15: no narration the engine does not make', () => {
  it('the Video plugin line and the Demo video job line say captions, never narration', () => {
    expect(looks['wicked-video'].description).toBe('Opens demo recordings: chapters, captions, trim, export.');
    for (const line of [looks['wicked-video'].description, DEMO_VIDEO_LINE]) expect(line).not.toMatch(/narrat/i);
  });
  it('no line promises a one-chapter re-record (D3: a whole new take)', () => {
    expect(STAGE_LINE.review_gate).toBe('The take is ready to review. Accept it, or record it again.');
    for (const line of Object.values(STAGE_LINE)) expect(line).not.toMatch(/re-record a chapter/i);
    expect(rerecordNote({ key: '02-a', title: 'A' })).not.toMatch(/only chapter|leave every other segment/i);
  });
});

describe('G14 video: the template stacks below 600 px', () => {
  const css = readFileSync(join(process.cwd(), 'src', 'plugins', 'wicked-video', 'template.html'), 'utf8');
  it('full screen is one column, player first, under 600 px', () => {
    const phone = /@media\(max-width:600px\)\{(.*)\}\s*<\/style>/s.exec(css)?.[1] ?? '';
    expect(phone).toContain('.video-editor[data-surface=full],.video-editor[data-mode=advanced][data-surface=full]{grid-template-columns:minmax(0,1fr)');
    expect(phone).toContain('.video-editor[data-surface=full] .work{order:-1');
    expect(phone).toContain('.chips{flex-wrap:wrap');
  });
});
