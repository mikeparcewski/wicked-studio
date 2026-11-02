/**
 * The studio's marks (fonts-v3, the operator's pick 2026-11-02): the Shoreline mark beside the Wave W
 * lettering, from the vendored design package (src/vendor/wicked-design/brand). Each is a CSS mask over
 * currentColor (components.css `.wk-brand-svg`), so it takes the ink of the text around it in every theme
 * and needs no markup injected. Sizes follow the fonts-v3 specimen's sidebar: 11.4 px caps (the lettering's
 * cap height is 100 units in a box 200 units tall, so the box is 2x the cap).
 */
import lockupUrl from '../../vendor/wicked-design/brand/wicked-studio-wordmark-small.svg?url';
import letteringUrl from '../../vendor/wicked-design/brand/wicked-studio-lettering-small.svg?url';
import markUrl from '../../vendor/wicked-design/brand/shoreline.svg?url';

/** The cap height the rail and the phone top bar set the name at today (16 px type). */
export const BRAND_CAP_PX = 11.4;
/** Each file's viewBox width, in its own units (tests/brandMarks.test.ts reads the files and checks these). */
export const BRAND_BOX = { lockup: 1120.4, lettering: 944.4, height: 200 } as const;

function masked(url: string, width: number, height: number, label: string | null, testId: string): React.ReactElement {
  const mask = `url(${JSON.stringify(url)})`;
  return (
    <span
      data-testid={testId}
      className="wk-brand-svg"
      {...(label !== null ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
      style={{ width: Math.round(width * 10) / 10, height: Math.round(height * 10) / 10, maskImage: mask, WebkitMaskImage: mask }}
    />
  );
}

const k = BRAND_CAP_PX / 100;

/** The Wicked Studio lockup: the Shoreline mark and the lettering at the specimen's spacing. */
export function StudioLockup({ testId = 'brand-lockup' }: { testId?: string }): React.ReactElement {
  return masked(lockupUrl, BRAND_BOX.lockup * k, BRAND_BOX.height * k, 'Wicked Studio', testId);
}

/** The lettering alone, beside a mark that is not ours (a custom logo). */
export function StudioLettering({ testId = 'brand-lettering' }: { testId?: string }): React.ReactElement {
  return masked(letteringUrl, BRAND_BOX.lettering * k, BRAND_BOX.height * k, 'Wicked Studio', testId);
}

/** The Shoreline mark alone (its small cut, for 16 to 24 px), beside a name that is not ours (a custom site name). */
export function ShorelineMark({ size = 16, testId = 'brand-mark' }: { size?: number; testId?: string }): React.ReactElement {
  return masked(markUrl, size, size, null, testId);
}
