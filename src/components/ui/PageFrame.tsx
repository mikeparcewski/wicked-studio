/** The page frame every routed page uses (design/UI-CONTRACT.md §4.6): a title, one plain intro
 *  sentence, actions (right on desktop, own row on phone), then the page's sections. */
export function PageFrame({ title, intro, actions, children, 'data-testid': testId = 'page-frame' }: {
  title: string; intro?: string; actions?: React.ReactNode; children: React.ReactNode; 'data-testid'?: string;
}): React.ReactElement {
  return (
    <div data-testid={testId} className="wk-page">
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
