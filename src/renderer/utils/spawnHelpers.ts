import { isWindowsPlatform } from './platformUtils';

/**
 * Compute stdin transport flags for spawning agents.
 *
 * On Windows the cmd.exe command line is limited to ~8 KB and special
 * characters cause escaping issues.  Sending the prompt via stdin
 * side-steps both problems.
 *
 * Codex-via-OMX also uses raw stdin on local sessions because OMX forwards
 * positional prompts into a codex exec path that rejects transport config
 * flags after prompt parsing. Sending the prompt via stdin keeps OMX in
 * exec mode while preserving the Codex options ordering.
 *
 * SSH sessions must NOT use these flags — they have a dedicated
 * stdin-script path handled by ChildProcessSpawner.
 */
export function getStdinFlags(opts: {
	isSshSession: boolean;
	supportsStreamJsonInput: boolean;
	toolType?: string;
}): {
	sendPromptViaStdin: boolean;
	sendPromptViaStdinRaw: boolean;
} {
	const isWindows = isWindowsPlatform();
	const useStdin =
		!opts.isSshSession && (isWindows || opts.toolType === 'codex');

	return {
		sendPromptViaStdin: useStdin && opts.supportsStreamJsonInput,
		sendPromptViaStdinRaw: useStdin && !opts.supportsStreamJsonInput,
	};
}
