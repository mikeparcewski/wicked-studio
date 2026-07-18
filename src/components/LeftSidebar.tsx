import { useState } from 'react';
import type { SessionView } from '../api/types.js';
import { ConnectionStatus } from './ConnectionStatus.js';
import { RunLink } from './RunLink.js';
import { SettingsMenu } from './SettingsMenu.js';
import { WickedLogo } from './WickedLogo.js';

interface Props {
  runs: SessionView[];
  selectedRunId: string | null;
  onSelectRun: (id: string) => void;
  navigate: (path: string) => void;
}

export function LeftSidebar({ runs, selectedRunId, onSelectRun, navigate }: Props): React.ReactElement {
  const [collapsed, setCollapsed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <div
      className={`flex flex-col bg-zinc-900 border-r border-zinc-800 shrink-0 transition-all duration-200 ${
        collapsed ? 'w-14' : 'w-60'
      }`}
    >
      {/* Header: logo + title + collapse toggle */}
      <div className="flex items-center gap-2 px-3 pt-4 pb-3 shrink-0">
        <button
          type="button"
          onClick={() => navigate('/')}
          className="shrink-0"
          aria-label="Home"
        >
          <WickedLogo size={26} />
        </button>
        {!collapsed && (
          <span className="flex-1 text-sm font-semibold text-white truncate">Wicked Crew Studio</span>
        )}
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="ml-auto text-zinc-400 hover:text-zinc-200 text-xs font-mono shrink-0 leading-none"
        >
          {collapsed ? '»' : '«'}
        </button>
      </div>

      {/* Action buttons */}
      <div className={`px-2 flex flex-col gap-1 shrink-0 ${collapsed ? 'items-center' : ''}`}>
        <button
          type="button"
          data-testid="new-run"
          onClick={() => navigate('/')}
          aria-label="New run"
          className={`rounded bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition-colors ${
            collapsed ? 'w-9 h-9 flex items-center justify-center' : 'w-full py-1.5 px-3'
          }`}
        >
          {collapsed ? '+' : 'New run'}
        </button>
        <button
          type="button"
          onClick={() => navigate('/repos')}
          aria-label="Repositories"
          className={`rounded text-zinc-300 hover:bg-zinc-800 text-xs transition-colors ${
            collapsed
              ? 'w-9 h-9 flex items-center justify-center'
              : 'w-full py-1.5 px-3 text-left'
          }`}
        >
          {collapsed ? '⊞' : 'Repositories'}
        </button>
      </div>

      {/* Run list — fills remaining space */}
      <div className="flex-1 overflow-y-auto mt-3 px-2 flex flex-col gap-0.5">
        {runs.length === 0 ? (
          !collapsed && (
            <p className="px-2 text-[11px] text-zinc-500 italic">No runs yet</p>
          )
        ) : (
          runs.map((v) =>
            collapsed ? (
              // Collapsed: status dot only — title gives the run name on hover
              <button
                key={v.session.id}
                type="button"
                onClick={() => onSelectRun(v.session.id)}
                aria-label={v.session.problem}
                title={v.session.problem}
                className={`w-9 h-9 mx-auto flex items-center justify-center rounded-md ${
                  selectedRunId === v.session.id ? 'bg-zinc-800' : 'hover:bg-zinc-800/50'
                }`}
              >
                <span
                  className={`w-2.5 h-2.5 rounded-full ${
                    v.session.status === 'completed'
                      ? 'bg-emerald-500'
                      : v.session.status === 'failed'
                        ? 'bg-red-500'
                        : v.session.status === 'cancelled'
                          ? 'bg-zinc-500'
                          : v.session.status === 'awaiting_human'
                            ? 'bg-amber-400 animate-pulse'
                            : 'bg-blue-400 animate-pulse'
                  }`}
                />
              </button>
            ) : (
              <RunLink
                key={v.session.id}
                view={v}
                selectedRunId={selectedRunId}
                onSelect={onSelectRun}
              />
            )
          )
        )}
      </div>

      {/* Bottom: connection status + version + settings */}
      <div className={`px-2 pb-3 shrink-0 flex flex-col gap-1 ${collapsed ? 'items-center' : ''}`}>
        {!collapsed && (
          <div className="px-1">
            <ConnectionStatus />
          </div>
        )}
        {!collapsed && (
          <p className="text-[10px] text-zinc-500 px-1">v0.2.1</p>
        )}
        <div className="relative">
          <button
            type="button"
            onClick={() => setSettingsOpen((v) => !v)}
            onMouseDown={(e) => e.stopPropagation()}
            aria-label="Settings"
            className={`rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors ${
              collapsed
                ? 'w-9 h-9 flex items-center justify-center text-base'
                : 'w-full flex items-center gap-2 px-2 py-1.5 text-xs'
            }`}
          >
            <span>⚙</span>
            {!collapsed && <span>Settings</span>}
          </button>
          {settingsOpen && (
            <SettingsMenu
              onNavigate={navigate}
              onClose={() => setSettingsOpen(false)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
