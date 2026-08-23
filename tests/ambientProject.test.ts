import { describe, expect, it } from 'vitest';
import {
  ambientProjectId,
  launchPath,
  registerRepoPath,
  sessionProjectId,
} from '../src/hooks/ambientProject.js';
import { makeSession } from './factories.js';

/**
 * Slice S (DES-UX-001 §2.3 rule 1): the ONE ambient-project derivation every
 * launch entry point shares — plus the three-valued CREW-UX-2 DTO reader.
 */

describe('ambientProjectId — the shared route derivation', () => {
  it('derives the project from a /p/:id/* path, any depth', () => {
    expect(ambientProjectId('/p/upload-endpoint')).toBe('upload-endpoint');
    expect(ambientProjectId('/p/upload-endpoint/build')).toBe('upload-endpoint');
    expect(ambientProjectId('/p/upload-endpoint/build/new')).toBe('upload-endpoint');
    expect(ambientProjectId('/p/q3-review-deck/document/deck')).toBe('q3-review-deck');
  });

  it('decodes an encoded id exactly like the router', () => {
    expect(ambientProjectId('/p/a%20b/chat')).toBe('a b');
  });

  it('reads the ?project= carry for surfaces outside the shell', () => {
    expect(ambientProjectId('/repos/new', '?project=upload-endpoint')).toBe('upload-endpoint');
    expect(ambientProjectId('/repos/new', '')).toBeNull();
    expect(ambientProjectId('/repos/new', '?project=')).toBeNull();
  });

  it('the path segment wins over the search carry', () => {
    expect(ambientProjectId('/p/alpha/build', '?project=beta')).toBe('alpha');
  });

  it('never returns the synthesized default bucket — that means NO project', () => {
    expect(ambientProjectId('/p/default/build')).toBeNull();
    expect(ambientProjectId('/repos/new', '?project=default')).toBeNull();
  });

  it('flat routes have no ambient project', () => {
    expect(ambientProjectId('/')).toBeNull();
    expect(ambientProjectId('/runs')).toBeNull();
    expect(ambientProjectId('/work')).toBeNull();
    expect(ambientProjectId('/p/')).toBeNull();
  });
});

describe('launchPath / registerRepoPath — the shared entry-point spellings', () => {
  it('inside a project: the pre-bound create routes (the slice-B lock)', () => {
    expect(launchPath('upload-endpoint', 'build')).toBe('/p/upload-endpoint/build/new');
    expect(launchPath('upload-endpoint', 'chat')).toBe('/p/upload-endpoint/chat/new');
  });

  it('outside a project: the flat Unfiled-default forms', () => {
    expect(launchPath(null, 'build')).toBe('/runs/new');
    expect(launchPath(null, 'chat')).toBe('/chat/new');
  });

  it('register-repo carries the ambient project as ?project=', () => {
    expect(registerRepoPath('upload-endpoint')).toBe('/repos/new?project=upload-endpoint');
    expect(registerRepoPath('a b')).toBe('/repos/new?project=a%20b');
    expect(registerRepoPath(null)).toBe('/repos/new');
  });
});

describe('sessionProjectId — the three-valued CREW-UX-2 DTO reader', () => {
  it('a string claim is daemon truth', () => {
    expect(sessionProjectId(makeSession({ project_id: 'upload-endpoint' }))).toBe('upload-endpoint');
  });

  it('null = GENUINELY unfiled (the daemon said so)', () => {
    expect(sessionProjectId(makeSession({ project_id: null }))).toBeNull();
  });

  it('absent = a pre-0.8.0 daemon — undefined, so callers fall back to the join', () => {
    expect(sessionProjectId(makeSession())).toBeUndefined();
  });

  it('the synthesized default bucket normalizes to null — it IS Unfiled', () => {
    expect(sessionProjectId(makeSession({ project_id: 'default' }))).toBeNull();
  });
});
