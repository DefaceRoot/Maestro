try {
	Object.defineProperty(process.stdin, 'isTTY', {
		value: false,
		configurable: true,
	});
	Object.defineProperty(process.stdout, 'isTTY', {
		value: false,
		configurable: true,
	});
	Object.defineProperty(process.stderr, 'isTTY', {
		value: false,
		configurable: true,
	});
} catch {
	// Best effort only. If Node refuses the override, OMX falls back to its
	// native launch policy and Maestro will still run, just with more TUI chrome.
}
