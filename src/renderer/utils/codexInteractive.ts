import type { AITab, ProcessConfig, Session } from '../types';

type CodexInteractiveSession = Pick<
	Session,
	| 'id'
	| 'toolType'
	| 'cwd'
	| 'customPath'
	| 'customArgs'
	| 'customEnvVars'
	| 'customModel'
	| 'customContextWindow'
	| 'sessionSshRemoteConfig'
>;

type CodexInteractiveTab = Pick<AITab, 'id' | 'agentSessionId'>;

interface CodexInteractiveReadyState {
	promise: Promise<void>;
	resolve: () => void;
	ready: boolean;
	timeoutId: ReturnType<typeof setTimeout> | null;
}

const READY_TIMEOUT_MS = 20000;
const readyStates = new Map<string, CodexInteractiveReadyState>();

function isCodexInteractiveReadyChunk(text: string): boolean {
	return /›|tab to queue message|context left/i.test(text);
}

function ensureReadyState(processSessionId: string): CodexInteractiveReadyState {
	let existing = readyStates.get(processSessionId);
	if (existing) {
		return existing;
	}

	let resolveReady!: () => void;
	const promise = new Promise<void>((resolve) => {
		resolveReady = resolve;
	});
	const state: CodexInteractiveReadyState = {
		promise,
		resolve: () => {
			if (state.ready) return;
			state.ready = true;
			if (state.timeoutId) {
				clearTimeout(state.timeoutId);
				state.timeoutId = null;
			}
			resolveReady();
		},
		ready: false,
		timeoutId: setTimeout(() => {
			state.resolve();
		}, READY_TIMEOUT_MS),
	};
	readyStates.set(processSessionId, state);
	return state;
}

export function getCodexInteractiveProcessSessionId(sessionId: string, tabId: string): string {
	return `${sessionId}-ai-${tabId}`;
}

export function shouldPrewarmCodexInteractiveSession(
	session: Pick<Session, 'toolType' | 'sessionSshRemoteConfig'>
): boolean {
	return session.toolType === 'codex' && !session.sessionSshRemoteConfig?.enabled;
}

export function buildCodexInteractiveSpawnConfig(
	session: CodexInteractiveSession,
	tab: CodexInteractiveTab,
	command: string
): ProcessConfig {
	const args = ['--madmax', '--high'];
	if (tab.agentSessionId) {
		args.push('resume', tab.agentSessionId);
	}

	return {
		sessionId: getCodexInteractiveProcessSessionId(session.id, tab.id),
		toolType: session.toolType,
		cwd: session.cwd,
		command,
		args,
		sessionCustomPath: session.customPath,
		sessionCustomArgs: session.customArgs,
		sessionCustomEnvVars: session.customEnvVars,
		sessionCustomModel: session.customModel,
		sessionCustomContextWindow: session.customContextWindow,
		sessionSshRemoteConfig: session.sessionSshRemoteConfig,
	};
}

export function primeCodexInteractiveReady(processSessionId: string): void {
	ensureReadyState(processSessionId);
}

export function observeCodexInteractiveChunk(processSessionId: string, text: string): void {
	if (!isCodexInteractiveReadyChunk(text)) {
		return;
	}

	ensureReadyState(processSessionId).resolve();
}

export async function waitForCodexInteractiveReady(
	processSessionId: string,
	assumeReadyIfUnknown: boolean = false
): Promise<void> {
	const existing = readyStates.get(processSessionId);
	if (!existing) {
		if (assumeReadyIfUnknown) {
			return;
		}
		return ensureReadyState(processSessionId).promise;
	}

	if (existing.ready) {
		return;
	}

	await existing.promise;
}

export function clearCodexInteractiveReady(processSessionId: string): void {
	const existing = readyStates.get(processSessionId);
	if (!existing) {
		return;
	}

	if (existing.timeoutId) {
		clearTimeout(existing.timeoutId);
	}
	readyStates.delete(processSessionId);
}
