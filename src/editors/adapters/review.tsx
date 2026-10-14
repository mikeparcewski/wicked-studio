import { registerHostTab } from '../hostApi.js';
import { DeckReview } from '../../components/session/DeckReview.js';

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
