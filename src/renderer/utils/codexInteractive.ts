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
