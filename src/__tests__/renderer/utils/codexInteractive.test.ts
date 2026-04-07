import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	clearCodexInteractiveReady,
	observeCodexInteractiveChunk,
	primeCodexInteractiveReady,
	waitForCodexInteractiveReady,
} from '../../../renderer/utils/codexInteractive';

describe('codexInteractive readiness tracking', () => {
	beforeEach(() => {
		vi.useRealTimers();
		clearCodexInteractiveReady('session-1-ai-tab-1');
	});

	it('resolves a primed interactive Codex session once prompt chrome appears', async () => {
		primeCodexInteractiveReady('session-1-ai-tab-1');
		const readyPromise = waitForCodexInteractiveReady('session-1-ai-tab-1');
		observeCodexInteractiveChunk('session-1-ai-tab-1', '› reply with only OK');
		await expect(readyPromise).resolves.toBeUndefined();
	});

	it('treats unknown active sessions as already ready when requested', async () => {
		await expect(
			waitForCodexInteractiveReady('session-1-ai-tab-1', true)
		).resolves.toBeUndefined();
	});
});
