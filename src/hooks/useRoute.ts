import { useCallback, useEffect, useState } from 'react';

export type Panel = 'runs' | 'coverage' | 'workflows' | 'domain' | 'policies' | 'rules' | 'repos' | 'system' | 'chats' | 'work' | 'repo-detail' | 'projects' | 'project-detail';

const PANELS: Panel[] = ['runs', 'coverage', 'workflows', 'domain', 'policies', 'rules', 'repos', 'system', 'chats', 'work', 'repo-detail', 'projects', 'project-detail'];

interface Route {
  panel: Panel;
  /** Non-null only when panel === 'runs' and a run is selected. */
  runId: string | null;
  /** True when panel === 'runs' and the launch form is open. */
  showLaunch: boolean;
  /** Non-null only when panel === 'repo-detail'. */
  repoId: string | null;
  /** True when panel === 'repos' and the register form should auto-open. */
  showRegisterRepo: boolean;
  /** True when the launch form is in chat mode (vs. work mode). */
  chatMode: boolean;
  /** Non-null only when panel === 'project-detail'. */
  projectId: string | null;
}

function safeDecode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

function parse(pathname: string): Route {
  const [, first = '', second = ''] = pathname.split('/');
  if (first === 'repo-detail' && second) {
    return { panel: 'repo-detail', runId: null, showLaunch: false, repoId: safeDecode(second), showRegisterRepo: false, chatMode: false, projectId: null };
  }
  if (first === 'repo-detail') {
    return { panel: 'repos', runId: null, showLaunch: false, repoId: null, showRegisterRepo: false, chatMode: false, projectId: null };
  }
  if (first === 'repos' && second === 'new') {
    return { panel: 'repos', runId: null, showLaunch: false, repoId: null, showRegisterRepo: true, chatMode: false, projectId: null };
  }
  if (first === 'chat' && second === 'new') {
    return { panel: 'runs', runId: null, showLaunch: true, repoId: null, showRegisterRepo: false, chatMode: true, projectId: null };
  }
  if (first === 'projects' && second) {
    return { panel: 'project-detail', runId: null, showLaunch: false, repoId: null, showRegisterRepo: false, chatMode: false, projectId: safeDecode(second) };
  }
  if ((PANELS as string[]).includes(first) && first !== 'runs') {
    return { panel: first as Panel, runId: null, showLaunch: false, repoId: null, showRegisterRepo: false, chatMode: false, projectId: null };
  }
  if (second === 'new') return { panel: 'runs', runId: null, showLaunch: true, repoId: null, showRegisterRepo: false, chatMode: false, projectId: null };
  if (second) return { panel: 'runs', runId: safeDecode(second), showLaunch: false, repoId: null, showRegisterRepo: false, chatMode: false, projectId: null };
  return { panel: 'runs', runId: null, showLaunch: false, repoId: null, showRegisterRepo: false, chatMode: false, projectId: null };
}

export function useRoute(): Route & {
  navigate: (path: string) => void;
  panelPath: (p: Panel) => string;
} {
  const [pathname, setPathname] = useState(() => window.location.pathname);

  useEffect(() => {
    const handler = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, []);

  const navigate = useCallback((path: string) => {
    history.pushState(null, '', path);
    setPathname(path);
  }, []);

  const panelPath = useCallback((p: Panel) => (p === 'runs' ? '/' : `/${p}`), []);

  return { ...parse(pathname), navigate, panelPath };
}
