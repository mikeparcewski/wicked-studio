import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * studio#1140: `chatCutInView` from the real health decoder. Crew's `capabilities.chatArtifacts.cutInView` turns it on
 * (crew reads an edited cut as a video the chat can't change); absent, false or a failed read keep it off, so studio
 * never sends a cut as in view to a crew that would read it as a page a refine may change.
 */
const getHealth = vi.fn();
vi.mock('../src/api/client.js', () => ({
  api: new Proxy({}, { get: (_t, k) => (k === 'getHealth' ? getHealth : () => Promise.resolve({})) }),
}));

const { useCapabilities } = await import('../src/store/capabilities.js');

const health = (chatArtifacts: unknown) => ({ status: 'ok', capabilities: chatArtifacts === undefined ? {} : { chatArtifacts } });
const FLAGS = { context: true, instructions: true, proposals: true, create: true, refine: true, theme: true, demo: false, onboard: true };

beforeEach(() => {
  useCapabilities.setState({ loaded: false, chatCutInView: false });
  getHealth.mockReset();
});

describe('chatCutInView from /health', () => {
  it.each([
    ['chatArtifacts.cutInView true', health({ ...FLAGS, cutInView: true }), true],
    ['chatArtifacts.cutInView false', health({ ...FLAGS, cutInView: false }), false],
    ['a crew before cutInView', health(FLAGS), false],
    ['no chatArtifacts', health(undefined), false],
  ])('%s', async (_name, answer, expected) => {
    getHealth.mockResolvedValue(answer);
    await useCapabilities.getState().load();
    expect(useCapabilities.getState().chatCutInView).toBe(expected);
  });

  it('a failed read is false', async () => {
    useCapabilities.setState({ chatCutInView: true });
    getHealth.mockRejectedValue(new Error('daemon down'));
    await useCapabilities.getState().load();
    expect(useCapabilities.getState()).toMatchObject({ loaded: true, chatCutInView: false });
  });
});
