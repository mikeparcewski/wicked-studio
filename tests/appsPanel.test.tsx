import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSpec } from '../src/api/types.js';
import { AppProperties } from '../src/components/apps/AppProperties.js';
import { AppSidePanel, readCollapsed, readSeen, type PanelTab } from '../src/components/apps/AppSidePanel.js';
import { SAMPLE_APPS } from '../src/editors/apps/samples.js';

/**
 * K5 (operator 2026-11-04: "chat/properties should be in same panel just tabs in the panel with chat as default. That
 * panel should be collapsable by user"): one panel, Chat | Properties, Chat by default, a real tablist, collapse to a
 * rail remembered across sessions, busy and unread dots on the rail, the chat's draft kept across tabs.
 */

afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; localStorage.clear(); });

function Harness({ busy = false, unread = false, initialCollapsed = false }: { busy?: boolean; unread?: boolean; initialCollapsed?: boolean }): React.ReactElement {
  const [tab, setTab] = useState<PanelTab>('chat');
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  return (
    <AppSidePanel slug="desk" tab={tab} setTab={setTab} collapsed={collapsed} setCollapsed={setCollapsed} busy={busy} unread={unread} phone={false} dock={null}
      chat={<textarea data-testid="app-composer-input" defaultValue="" />} properties={<p data-testid="props-body">props</p>} />
  );
}

describe('the app side panel', () => {
  it('opens on Chat; arrows move between the tabs; both panes stay mounted, so the draft is kept', () => {
    render(<Harness />);
    const chatTab = screen.getByTestId('app-panel-tab-chat');
    const propsTab = screen.getByTestId('app-panel-tab-properties');
    expect(screen.getByRole('tablist')).toBeTruthy();
    expect(chatTab.getAttribute('aria-selected')).toBe('true');
    expect(chatTab.tabIndex).toBe(0);
    expect(propsTab.tabIndex).toBe(-1);
    const box = screen.getByTestId('app-composer-input') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'my draft' } });
    fireEvent.keyDown(chatTab, { key: 'ArrowRight' });
    expect(propsTab.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(propsTab);
    expect((screen.getByTestId('app-panel-chat') as HTMLElement).hidden).toBe(true);
    fireEvent.keyDown(propsTab, { key: 'Home' });
    expect(chatTab.getAttribute('aria-selected')).toBe('true');
    fireEvent.click(chatTab);
    // Same element, same draft; the focus is in the composer after a switch to Chat.
    expect(screen.getByTestId('app-composer-input')).toBe(box);
    expect(box.value).toBe('my draft');
    expect(document.activeElement).toBe(box);
  });

  it('collapses to a rail (aria-expanded false), remembered across sessions; a rail icon opens on its tab', () => {
    const { unmount } = render(<Harness />);
    const toggle = screen.getByTestId('app-panel-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(toggle);
    expect(screen.getByTestId('app-panel').getAttribute('data-collapsed')).toBe('true');
    expect(screen.getByTestId('app-panel-toggle').getAttribute('aria-expanded')).toBe('false');
    expect(readCollapsed()).toBe(true);
    unmount();
    render(<Harness initialCollapsed={readCollapsed()} />);
    expect(screen.getByTestId('app-panel').getAttribute('data-collapsed')).toBe('true');
    fireEvent.click(screen.getByTestId('app-panel-rail-properties'));
    expect(screen.getByTestId('app-panel').getAttribute('data-collapsed')).toBe('false');
    expect(screen.getByTestId('app-panel-tab-properties').getAttribute('aria-selected')).toBe('true');
    expect(readCollapsed()).toBe(false);
  });

  it('collapsed: a running turn shows a busy dot on Chat, an ended unseen one an unread dot', () => {
    const { unmount } = render(<Harness busy initialCollapsed />);
    expect(screen.getByTestId('app-panel-rail-chat').querySelector('[data-testid="app-panel-busy"]')).not.toBeNull();
    unmount();
    render(<Harness unread initialCollapsed />);
    expect(screen.getByTestId('app-panel-rail-chat').querySelector('[data-testid="app-panel-unread"]')).not.toBeNull();
    expect(screen.getByTestId('app-panel-rail-properties').querySelector('[data-testid="app-panel-unread"]')).toBeNull();
    expect(readSeen('desk')).toBe('');
  });
});

describe('Properties in the panel', () => {
  const spec = (): AppSpec => structuredClone(SAMPLE_APPS['escalations']!.spec);

  it('changes the selected component with the runtime\'s own ops (a title on Enter, a binding at once, a delete)', () => {
    const s = spec();
    const kpi = s.pages[0]!.components.find((c) => c.type === 'kpi')!;
    const onOps = vi.fn(() => ({ ok: true }));
    render(<AppProperties spec={s} selected={kpi.id} editable readOnlyWhy={null} onOps={onOps} />);
    expect(screen.getByTestId('app-properties-what').textContent).toBe(`KPI · ${kpi.id}`);
    const title = screen.getByTestId('app-prop-title') as HTMLInputElement;
    fireEvent.change(title, { target: { value: 'Open now' } });
    expect(onOps).not.toHaveBeenCalled();
    fireEvent.keyDown(title, { key: 'Enter' });
    expect(onOps).toHaveBeenLastCalledWith([{ op: 'component-set', id: kpi.id, prop: 'title', value: 'Open now' }]);
    const other = s.queries.find((q) => q.id !== (kpi as { data: { query: string } }).data.query)!.id;
    fireEvent.change(document.querySelector('select[data-prop="query"]')!, { target: { value: other } });
    expect(onOps).toHaveBeenLastCalledWith([{ op: 'bind', id: kpi.id, query: other }]);
    fireEvent.click(screen.getByTestId('app-prop-remove'));
    expect(onOps).toHaveBeenLastCalledWith([{ op: 'component-remove', id: kpi.id }]);
  });

  it('says why nothing can change here (Preview, a phone, a frame, a turn), and what to do with nothing selected', () => {
    const { unmount } = render(<AppProperties spec={spec()} selected={null} editable={false} readOnlyWhy="Open Edit, then select a component to change it here." onOps={vi.fn()} />);
    expect(screen.getByTestId('app-properties-empty').textContent).toMatch(/Open Edit/);
    unmount();
    render(<AppProperties spec={spec()} selected={null} editable readOnlyWhy={null} onOps={vi.fn()} />);
    expect(screen.getByTestId('app-properties-empty').textContent).toMatch(/Select a component/);
  });
});
