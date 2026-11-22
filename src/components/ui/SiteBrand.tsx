import { useAppearanceStore } from '../../theming/appearance.js';
import { ShorelineMark, StudioLettering, StudioLockup } from './BrandMarks.js';

/** The brand Settings › Theme sets: the site name (trimmed, null when blank) and the logo URL (null when none). */
export function useSiteBrand(): { siteName: string | null; logoUrl: string | null } {
  const siteName = useAppearanceStore((s) => s.appearance.site_name?.trim() || null);
  const logoUrl = useAppearanceStore((s) => s.appearance.logo_url);
  return { siteName, logoUrl };
}

/** Theme › Logo (studio#512): the mark's slot, contain-fit, decoration (the brand's words carry the name). */
export function SiteLogo({ url, size, testId }: { url: string; size: number; testId: string }): React.ReactElement {
  return (
    <span
      aria-hidden
      data-testid={testId}
      style={{
        width: size, height: size, flexShrink: 0,
        backgroundImage: `url(${JSON.stringify(url)})`,
        backgroundSize: 'contain', backgroundPosition: 'center', backgroundRepeat: 'no-repeat',
      }}
    />
  );
}

/**
 * THE one brand choice, for the desktop rail's wordmark and the phone top bar (studio#983: the bar drew the lockup
 * while the rail showed the site name). Theme › Logo takes the mark's place; a custom site name is the user's words,
 * in the text face, beside the mark (or the logo); with no name, the lettering beside a custom logo, else the drawn
 * lockup (the Shoreline mark beside the Wave W lettering, fonts-v3). Renders the parts; the caller owns the wrapper.
 */
export function SiteBrand({ ids, logoSize, nameClass }: {
  ids: { logo: string; mark: string; lettering: string; lockup: string; name?: string };
  logoSize: number;
  nameClass: string;
}): React.ReactElement {
  const { siteName, logoUrl } = useSiteBrand();
  return (
    <>
      {logoUrl !== null
        ? <SiteLogo url={logoUrl} size={logoSize} testId={ids.logo} />
        : siteName !== null ? <ShorelineMark testId={ids.mark} /> : null}
      {siteName !== null
        ? <span {...(ids.name !== undefined ? { 'data-testid': ids.name } : {})} className={nameClass}><b>{siteName}</b></span>
        : logoUrl !== null ? <StudioLettering testId={ids.lettering} /> : <StudioLockup testId={ids.lockup} />}
    </>
  );
}
