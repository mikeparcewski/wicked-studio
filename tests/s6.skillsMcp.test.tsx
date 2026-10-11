import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { SkillsPage } from '../src/components/SkillsPage.js';
import { McpToolsPage } from '../src/components/McpToolsPage.js';
import { ApiError } from '../src/api/errors.js';
import type { SkillsCatalog } from '../src/api/skills.js';
import { approvals, policies, serversResponse } from './mcpFixtures.js';

const apiFetch = vi.fn();
vi.mock('../src/api/client.js', () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));

const catalog: SkillsCatalog = {
  revision: 1, root: '/home/operator/skills', current: null,
  manifest: {
    version: 2, revision: 1, baseline: 'base', baselines: {base:{plugin_version:'1.0.0',source:{kind:'directory',path:'/installed'},git_sha:null,captured_at:'2026-10-01T00:00:00Z',venv:'synced'}}, published: null,
    skills: { 'my-skill': { dir: 'skills/my-skill', kind: 'module', core: false, portable: true,
      enabled: true, provenance: 'user-added', editedAt: null, upgradeAvailable: false, conflict: false, upstreamDir: null } },
    files: { 'skills/my-skill/SKILL.md': { baselineHash: null, effectiveHash: 'abc', lastPublishedHash: null, conflict: false } },
  },
};

beforeEach(() => { apiFetch.mockReset(); });
afterEach(cleanup);

describe('S6 skills and MCP presentation', () => {
  it('Skills has one visible Refresh and hides settled zero filters, while preserving the active zero filter', async () => {
    apiFetch.mockImplementation((path: string) => path === '/skills' ? Promise.resolve(catalog) : Promise.reject(new ApiError(404, 'Not Found')));
    render(<SkillsPage navigate={vi.fn()} />);
    await screen.findByTestId('skills-row');
    expect(screen.getAllByRole('button', { name: /^Refresh$/ })).toHaveLength(1);
    expect(screen.queryByRole('button', {name:'Refresh baseline'})).toBeNull();
    expect(screen.getAllByTestId('skills-filter-chip').every(chip => !/\s0$/.test(chip.textContent ?? ''))).toBe(true);
    fireEvent.click(screen.getByRole('button', {name:'More actions for skills'}));
    expect(screen.getByRole('menuitem', {name:'Refresh baseline'})).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name:'More actions for skills'}));
    fireEvent.change(screen.getByTestId('skills-filter-search'), {target:{value:'no match'}});
    expect(screen.getAllByTestId('skills-filter-chip')).toHaveLength(1);
    expect(screen.getByTestId('skills-filter-chip')).toHaveAttribute('aria-pressed','true');
    expect(screen.getByTestId('skills-grid-empty')).toHaveTextContent('No matching skills');
    expect(screen.getByTestId('skills-root').querySelector('details') ?? screen.getByTestId('skills-root')).not.toHaveAttribute('open');
  });

  it('MCP gives the mode control a visible label and excludes retired helper names', async () => {
    const servers = serversResponse();
    servers.discovered = [
      {name:'retired-tool',cli:'agy',origin:'operator',managed:false,source:'/home/operator/settings'},
      {name:'old-tool',cli:'antigravity',origin:'operator',managed:false,source:'/home/operator/settings'},
      {name:'current-tool',cli:'codex',origin:'operator',managed:false,source:'/home/operator/settings'},
    ];
    apiFetch.mockImplementation((path: string) => {
      if (path === '/mcp/servers') return Promise.resolve(servers);
      if (path === '/mcp/policies/preview') return Promise.resolve(policies());
      if (path === '/mcp/approvals') return Promise.resolve(approvals());
      return Promise.reject(new ApiError(404, 'Not Found'));
    });
    render(<McpToolsPage navigate={vi.fn()} search="" />);
    await screen.findByTestId('mcp-discovered');
    expect(screen.getByText('When helpers use tools')).toBeVisible();
    const mode = screen.getByRole('radiogroup', {name:'When helpers use tools'});
    expect(within(mode).getAllByRole('radio')).toHaveLength(3);
    expect(screen.getByTestId('mcp-tools-page').textContent).not.toMatch(/agy|antigravity/i);
    expect(screen.getByTestId('mcp-discovered-server')).toHaveClass('wk-tag');
    fireEvent.keyDown(within(mode).getByRole('radio', {name:'Gate by risk'}), {key:'ArrowRight'});
    expect(within(mode).getByRole('radio', {name:'Auto'})).toHaveAttribute('aria-checked','true');
  });
});
