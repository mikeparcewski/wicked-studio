/** How wide a page sits (sections/layout.css, the page measure): `wide` is every page's default,
 *  `narrow` a settings-style page whose cards are a form's width, `full` a tool that needs the whole
 *  column. Every width is centred in the main column. */
export type PageWidth = 'wide' | 'narrow' | 'full';

/** The page frame every routed page uses (design/UI-CONTRACT.md §4.6): a title, one plain intro
 *  sentence, actions (right on desktop, own row on phone), then the page's sections — centred in the
 *  main column at the page measure (operator 2026-10-16). */
export function PageFrame({ title, intro, actions, children, width = 'wide', 'data-testid': testId = 'page-frame' }: {
  title: string; intro?: string; actions?: React.ReactNode; children: React.ReactNode; width?: PageWidth; 'data-testid'?: string;
}): React.ReactElement {
  return (
    <div data-testid={testId} data-width={width} className={width === 'wide' ? 'wk-page' : `wk-page wk-page--${width}`}>
      <header className="wk-page-head">
        <div className="wk-page-head-text">
          <h1 className="wk-page-title">{title}</h1>
          {intro !== undefined && <p className="wk-page-intro">{intro}</p>}
        </div>
        {actions !== undefined && <div className="wk-page-actions">{actions}</div>}
      </header>
      <div className="wk-page-body">{children}</div>
    </div>
  );
}

/** A section heading inside a page (sentence case; never an uppercase micro-label). */
export function SectionTitle({ children }: { children: React.ReactNode }): React.ReactElement {
  return <h2 className="wk-section-title">{children}</h2>;
}
