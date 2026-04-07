/**
 * Utility functions for cleaning and filtering terminal output
 * Removes control sequences, escape codes, and other non-visible content
 */

/**
 * Filter out shell prompts and command echoes from terminal output
 * This is used in Command Terminal mode to show ONLY stdout/stderr
 *
 * Removes:
 * - Lines that look like shell prompts (e.g., [user:~/path], user@host:~$)
 * - Lines that match the last command sent (command echoes)
 * - Git branch indicators (e.g., (main), (master))
 * - Standalone prompt markers
 */
function filterTerminalPrompts(text: string, lastCommand?: string): string {
	const lines = text.split('\n');
	const filteredLines: string[] = [];

	for (const line of lines) {
		const trimmedLine = line.trim();

		// Skip empty lines
		if (!trimmedLine) {
			continue;
		}

		// Skip lines that look like shell prompts
		// Patterns:
		// - [user:~/path] or [user:~/path]$
		// - user@host:~$
		// - ~/path $
		// - (main) or (master) - git branch indicators alone
		// - Lines ending with $ or # (common prompt endings)
		if (
			/^\[[\w\-\.]+:.*?\]/.test(trimmedLine) || // [user:~/path]
			/^[\w\-\.]+@[\w\-\.]+:.*?[\$#%>]/.test(trimmedLine) || // user@host:~$
			/^~?\/.*?[\$#%>]\s*$/.test(trimmedLine) || // ~/path $
			/^\([\w\-\/]+\)\s*$/.test(trimmedLine) || // (main) alone
			/^[\$#%>]\s*$/.test(trimmedLine) || // Just a prompt character
			/^\[.*?\]\s*\([\w\-\/]+\)\s*[\$#%>]?\s*$/.test(trimmedLine) // [user:~/path] (main) $
		) {
			continue;
		}

		// Skip command echoes (lines that match the last command sent)
		if (lastCommand && trimmedLine === lastCommand) {
			continue;
		}

		// Remove git branch indicators from the line (e.g., " (main)" or "(main) ")
		let cleanedLine = line.replace(/\s*\([\w\-\/]+\)\s*/g, ' ');

		// Remove trailing prompt characters if present
		cleanedLine = cleanedLine.replace(/[\$#%>]\s*$/, '');

		// If after all cleaning the line is empty, skip it
		if (cleanedLine.trim()) {
			filteredLines.push(cleanedLine);
		}
	}

	return filteredLines.join('\n');
}

/**
 * Strip terminal control sequences from raw PTY output
 * This removes:
 * - OSC sequences (Operating System Commands) like title changes
 * - CSI sequences (Control Sequence Introducer) like cursor positioning
 * - SGR sequences (Select Graphic Rendition) that aren't visible content
 * - Shell prompt markers and other non-content control codes
 * - Shell prompts (for terminal mode only)
 * - Command echoes (for terminal mode only)
 * - Git branch indicators (for terminal mode only)
 *
 * @param text - Raw terminal output
 * @param lastCommand - Last command sent to terminal (for filtering echoes)
 * @param isTerminal - Whether this is terminal mode (enables aggressive filtering)
 *
 * Note: This preserves ANSI color codes which are handled by ansi-to-html in the renderer
 */
export function stripControlSequences(
	text: string,
	lastCommand?: string,
	isTerminal: boolean = false
): string {
	let cleaned = text;

	// Remove OSC (Operating System Command) sequences
	// Format: ESC ] ... (BEL or ST)
	// Examples: window title changes, hyperlinks, custom sequences
	cleaned = cleaned.replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '');

	// Remove CSI (Control Sequence Introducer) sequences that aren't color codes.
	// This also strips DEC private-mode toggles like ESC[?1h and bracketed paste.
	cleaned = cleaned.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, (sequence) =>
		sequence.endsWith('m') ? sequence : ''
	);

	// Remove standalone escape sequences used for keypad/application mode switching.
	cleaned = cleaned.replace(/\x1b[=>]/g, '');

	// Remove shell integration markers (VSCode, iTerm2, etc.)
	// Format: ESC ] 133 ; ... BEL/ST
	cleaned = cleaned.replace(/\x1b\]133;[^\x07\x1b]*(\x07|\x1b\\)/g, '');
	cleaned = cleaned.replace(/\x1b\]1337;[^\x07\x1b]*(\x07|\x1b\\)/g, '');
	cleaned = cleaned.replace(/\x1b\]7;[^\x07\x1b]*(\x07|\x1b\\)/g, '');

	// Remove BARE shell integration sequences (without ESC prefix)
	// SSH interactive shells emit these when .zshrc/.bashrc loads shell integration
	// Format: ]1337;Key=Value]1337;Key=Value...actual content (no ESC prefix)
	// Process BEL-terminated sequences first
	cleaned = cleaned.replace(/\]1337;[^\x07]*\x07/g, '');
	cleaned = cleaned.replace(/\]133;[^\x07]*\x07/g, '');
	cleaned = cleaned.replace(/\]7;[^\x07]*\x07/g, '');
	// Handle chained sequences (followed by another ])
	cleaned = cleaned.replace(/\]1337;[^\]\x07\x1b]*(?=\])/g, '');
	cleaned = cleaned.replace(/\]133;[^\]\x07\x1b]*(?=\])/g, '');
	cleaned = cleaned.replace(/\]7;[^\]\x07\x1b]*(?=\])/g, '');
	// Handle last sequence in chain (ShellIntegrationVersion followed by content)
	cleaned = cleaned.replace(/\]1337;ShellIntegrationVersion=[\d;a-zA-Z=]*/g, '');
	cleaned = cleaned.replace(/\]1337;(?:RemoteHost|CurrentDir|User|HostName)=[^\/\]\x07\{]*/g, '');
	// Handle sequences at end of string
	cleaned = cleaned.replace(/^\]1337;[^\]\x07]*$/g, '');
	cleaned = cleaned.replace(/^\]133;[^\]\x07]*$/g, '');
	cleaned = cleaned.replace(/^\]7;[^\]\x07]*$/g, '');

	// Remove other OSC sequences by number
	cleaned = cleaned.replace(/\x1b\][0-9];[^\x07\x1b]*(\x07|\x1b\\)/g, '');

	// Remove soft hyphen and other invisible formatting
	cleaned = cleaned.replace(/\u00AD/g, '');

	// Remove carriage returns that are followed by newlines (Windows-style)
	// But keep standalone \r for terminal overwrites
	cleaned = cleaned.replace(/\r\n/g, '\n');

	// Remove any remaining standalone escape sequences without parameters
	cleaned = cleaned.replace(/\x1b[()][AB012]/g, '');

	// Remove BEL (bell) character
	cleaned = cleaned.replace(/\x07/g, '');

	// Remove other control characters except newline, tab, and ANSI escape start
	cleaned = cleaned.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1A\x1C-\x1F]/g, '');

	// For terminal mode, apply aggressive filtering to show ONLY command output
	if (isTerminal) {
		cleaned = filterTerminalPrompts(cleaned, lastCommand);
	}

	return cleaned;
}

/**
 * Strip PTY UI chrome from interactive AI sessions.
 *
 * Interactive Codex/OMX sessions emit full-screen TUI repaint sequences that are
 * appropriate for a terminal emulator but unreadable in Maestro's chat transcript.
 * This helper removes ANSI/control sequences from the accumulated stream and drops
 * common chrome-only lines so only meaningful assistant content remains.
 */
export function stripAiPtyOutput(text: string, lastCommand?: string): string {
	let cleaned = stripAllAnsiCodes(text);

	// Remove single-character escape sequences like ESC M (reverse index)
	// that are common in TUI redraws and can survive chunk boundaries.
	cleaned = cleaned.replace(/\x1b[@-Z\\-_]/g, '');

	// Remove residual CSI fragments that can remain when ANSI sequences were split
	// across PTY chunks and later concatenated.
	cleaned = cleaned
		.replace(/\[\??\d+(?:;\d+)*[A-Za-z]/g, '')
		.replace(/\[\??[0-9;]*[A-Za-z]/g, '')
		.replace(/\r/g, '')
		.replace(/^OpenAI Codex v[^\n]*$/gim, '')
		.replace(/^workdir:\s*[^\n]*$/gim, '')
		.replace(/^provider:\s*[^\n]*$/gim, '')
		.replace(/^approval:\s*[^\n]*$/gim, '')
		.replace(/^sandbox:\s*[^\n]*$/gim, '')
		.replace(/^reasoning (?:effort|summaries?):\s*[^\n]*$/gim, '')
		.replace(/^session id:\s*[^\n]*$/gim, '')
		.replace(/^[-─]{4,}$/gim, '')
		.replace(/^›(?:[ \t].*)?$/gim, '')
		.replace(/Reading additional input from stdin\.\.\./gi, '')
		.replace(/⚠\s*Under-development features enabled:/gi, '')
		.replace(/child_agents_md\./gi, '')
		.replace(
			/To suppress this warning, set\s+`suppress_unstable_features_warning\s*=\s*true`\s+in\s+\/[^\s]+config\.toml\.?/gi,
			''
		)
		.replace(/Starting MCP servers\s*\(\d+\/\d+\):\s*/gi, '')
		.replace(/interrupt:\s*Ctrl\+C,\s*esc to (?:interrupt|queue message)/gi, '')
		.replace(/tab to queue message/gi, '')
		.replace(/Use \/mcp to list configured MCP tools\.?/gi, '')
		.replace(/Use \/skills to list available skills\.?/gi, '')
		.replace(/Use \/personality to customize how Codex communicates\.?/gi, '')
		.replace(/Run \/review on my current changes\.?/gi, '')
		.replace(/Restart Codex to use it\.?/gi, '')
		.replace(/Under-development features are incomplete and may behave unpredictably\.?/gi, '')
		.replace(/^Tip:\s*$/gim, '')
		.replace(/gpt-[^\n·]+(?:\s*·\s*[^\n·]+){1,8}/gi, '')
		.replace(
			/⚠\s*Under-development features enabled:[\s\S]*?suppress_unstable_features_warning\s*=\s*true\s*in\s*\/[^\s]+config\.toml\.?/gi,
			''
		);

	const lines = cleaned.split('\n');
	const filtered: string[] = [];

	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed) continue;

		if (lastCommand && trimmed === lastCommand.trim()) {
			continue;
		}

		if (
			/^⚠\s*Under-development features enabled:/i.test(trimmed) ||
			/^To suppress this warning,/i.test(trimmed) ||
			/^[╭╰│─]+/.test(trimmed) ||
			/^>_\s*OpenAI Codex/i.test(trimmed) ||
			/^OpenAI Codex v/i.test(trimmed) ||
			/^model:\s/i.test(trimmed) ||
			/^directory:\s/i.test(trimmed) ||
			/^workdir:\s/i.test(trimmed) ||
			/^provider:\s/i.test(trimmed) ||
			/^approval:\s/i.test(trimmed) ||
			/^sandbox:\s/i.test(trimmed) ||
			/^reasoning (?:effort|summaries?):\s/i.test(trimmed) ||
			/^session id:\s/i.test(trimmed) ||
			/^Tip:/i.test(trimmed) ||
			/^(Use|Run)\s+\/[\w-]+/i.test(trimmed) ||
			/restart codex to use it/i.test(trimmed) ||
			/under-development features are incomplete/i.test(trimmed) ||
			/^Working(?:\s*\(.*\))?$/i.test(trimmed) ||
			/^gpt-[^·]+·/.test(trimmed) ||
			(/gpt-\S+/i.test(trimmed) &&
				(/window/i.test(trimmed) || /weekly\s+\d+%/i.test(trimmed) || /used/i.test(trimmed))) ||
			/^›(?:[ \t].*)?$/.test(trimmed) ||
			/^Starting MCP servers/i.test(trimmed) ||
			/esc to interrupt/i.test(trimmed) ||
			/omx_[\w-]+/i.test(trimmed) ||
			/^(omx_[\w-]+(?:,\s*)?)+$/i.test(trimmed) ||
			/^interrupt:\s/i.test(trimmed) ||
			/^Reading additional input from stdin/i.test(trimmed) ||
			/^[-─]{4,}$/.test(trimmed) ||
			/^\d+%\s+context left$/i.test(trimmed) ||
			/^tab to queue message/i.test(trimmed) ||
			/^context left$/i.test(trimmed)
		) {
			continue;
		}

		filtered.push(trimmed);
	}

	return filtered.join('\n');
}

/**
 * Strip ALL ANSI escape codes from text (including color codes).
 * This is more aggressive than stripControlSequences and removes everything.
 * Use this for stderr from AI agents where we don't want any formatting.
 *
 * NOTE: This is intentionally more comprehensive than shared/stringUtils.stripAnsiCodes().
 * The shared version handles basic SGR color/style codes (sufficient for UI display cleanup).
 * This version also handles: OSC sequences, character set selection, BEL, and control chars.
 * This comprehensive version is needed for raw terminal output from AI agents.
 *
 * @see src/shared/stringUtils.ts for the basic version
 */
export function stripAllAnsiCodes(text: string): string {
	// Remove all ANSI escape sequences including color codes
	// Format: ESC [ ... final byte (CSI sequences, including DEC private modes)
	// Format: ESC ] ... BEL/ST (OSC sequences)
	return text
		.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '') // All CSI sequences
		.replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '') // OSC sequences
		.replace(/\x1b[=>]/g, '') // Keypad/application mode toggles
		.replace(/\x1b[()][AB012]/g, '') // Character set selection
		.replace(/\x07/g, '') // BEL character
		.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1A\x1C-\x1F]/g, ''); // Other control chars
}

/**
 * Detect if a line is likely a command echo in terminal output
 * This helps identify when the terminal is echoing back the command the user typed
 *
 * @internal This function is exported for testing purposes only.
 * It is not used in production code - the echo detection logic is
 * handled within filterTerminalPrompts() instead.
 */
export function isCommandEcho(line: string, lastCommand?: string): boolean {
	if (!lastCommand) return false;

	const trimmedLine = line.trim();
	const trimmedCommand = lastCommand.trim();

	// Exact match
	if (trimmedLine === trimmedCommand) return true;

	// Line starts with the command (may have prompt prefix)
	if (trimmedLine.endsWith(trimmedCommand)) return true;

	return false;
}

/**
 * Extract the actual command from user input (without prompt)
 *
 * @internal This function is exported for testing purposes only.
 * It is not used in production code.
 */
export function extractCommand(input: string): string {
	// Remove common prompt patterns from the beginning
	const withoutPrompt = input.replace(/^[^$#%>]*[$#%>]\s*/, '');
	return withoutPrompt.trim();
}
