import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { useLayerStore } from '../src/store/layers.js';
import { useNotificationStore } from '../src/store/notifications.js';
import { NotificationBell } from '../src/components/NotificationBell.js';

function seedUnread(count: number): void {
  useNotificationStore.setState({
    notifications: Array.from({ length: count }, (_, index) => ({
      id: `notice-${index}`,
      kind: 'gate' as const,
      runId: `run-${index}`,
      message: 'Awaiting review',
      ts: 0,
      read: false,
    })),
  });
}

beforeEach(() => {
  useNotificationStore.setState({ notifications: [] });
  useLayerStore.setState({ bellOpen: false });
});

afterEach(cleanup);

describe('NotificationBell rail trigger', () => {
  it('centers its expanded content within a visible token border and omits an empty count', () => {
    render(<NotificationBell navigate={() => {}} />);
    const trigger = screen.getByTitle('Notifications');

    expect(trigger.style.justifyContent).toBe('center');
    expect(trigger.style.width).toBe('100%');
    expect(trigger.style.border).toBe('1px solid var(--surface-raised)');
    expect(trigger.querySelector('span[aria-hidden="true"]')).toBeNull();
  });

  it('renders the unread count inside the border, after the notification content', () => {
    seedUnread(2);
    render(<NotificationBell navigate={() => {}} />);
    const trigger = screen.getByRole('button', { name: '2 unread notifications' });
    const count = trigger.lastElementChild as HTMLSpanElement;

    expect(trigger.style.justifyContent).toBe('center');
    expect(count).toHaveTextContent('2');
    expect(count).toHaveAttribute('aria-hidden', 'true');
    expect(count.className).not.toContain('absolute');
  });

  it('keeps the icon-and-count form in the collapsed rail without the notification label', () => {
    seedUnread(1);
    render(<NotificationBell navigate={() => {}} collapsed />);
    const trigger = screen.getByRole('button', { name: '1 unread notification' });
    const count = trigger.lastElementChild as HTMLSpanElement;

    expect(trigger.style.justifyContent).toBe('center');
    expect(trigger.style.minWidth).toBe('28px');
    expect(trigger).not.toHaveTextContent('Notifications');
    expect(count).toHaveTextContent('1');
  });
});
