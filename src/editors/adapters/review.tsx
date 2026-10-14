import { registerHostTab, registerTabFooter } from '../hostApi.js';
import { DeckReview } from '../../components/session/DeckReview.js';
import { MatchTheme } from '../../components/editorPorts/MatchTheme.js';

/**
 * The host's REVIEW capability (DES-EDITOR-PLUGIN-CONTRACT-001 §7.4; HOST-API §4, slice H4). The deck-only review rail
 * becomes a host tab, shown for ANY adapter that reports `review` (an adapter with parts and a review store), never by
 * artifact kind. A person's decision (Approve, Ask for changes, Keep or Drop a rewrite) stays host chrome: no plugin
 * message can name one.
 */
registerHostTab({
  id: 'review',
  label: 'Review',
  needs: 'review',
  render: (ctx) => (
    <DeckReview
      projectId={ctx.binding.projectId}
      docId={ctx.binding.docId ?? ''}
      head={ctx.shown ?? ctx.adapter.artifact().head}
      onForked={(head) => ctx.changed(head, 'fork')}
    />
  ),
});

/**
 * "Match a website or a PDF" under any plugin's Style tab, for an adapter that can write a theme (HOST-API rev 3,
 * `registerTabFooter`). Host chrome: the frame has no network and cannot start a learn.
 */
registerTabFooter({
  tab: 'style',
  needs: 'theme',
  render: (ctx) => (
    <MatchTheme
      projectId={ctx.binding.projectId}
      docId={ctx.binding.docId ?? ''}
      // Through the adapter's theme write, so the engine's parent is recorded for Undo and the head moves.
      apply={async (tokens) => {
        const theme = (ctx.adapter as { theme?: (base: number, t: Record<string, unknown>, o?: { match?: boolean }) => Promise<{ version: number } | { error: string; message: string }> }).theme;
        if (theme === undefined) return { error: 'unsupported', message: 'this artifact has no theme' };
        const r = await theme.call(ctx.adapter, ctx.adapter.artifact().head, tokens, { match: true });
        return 'error' in r ? { error: r.error, message: r.message } : { version: r.version };
      }}
      onVersion={(version) => ctx.changed(version, 'theme')}
    />
  ),
});
