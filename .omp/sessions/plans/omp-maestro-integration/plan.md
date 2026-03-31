# OMP ↔ Maestro Full Integration Plan

## Summary

Integrate the `omp` CLI (Oh My Pi fork at `/home/cbee/Repos/oh-my-pi`, symlinked as `omp`) into Maestro as a first-class AI coding agent. OMP runs in **RPC mode** (`omp --mode rpc`) — a persistent bidirectional JSON process: Maestro writes commands to OMP's stdin, OMP streams events to stdout. This unlocks real-time context window reporting, mid-turn abort, model switching, and steering — none of which batch-mode agents support. The integration covers every Maestro feature: agent registration, output parsing, session browser, wizard, slash commands, group chat, context window display, read-only/plan mode, and agent mode selection (default / ask / orchestrator / plan).

---

## Codebase Context

### Maestro (Electron, React + Node.js main process)

| Path | Role |
|---|---|
| `src/shared/agentIds.ts` | Single source of truth: `AGENT_IDS` tuple + `AgentId` type |
| `src/shared/agentMetadata.ts` | `AGENT_DISPLAY_NAMES`, `BETA_AGENTS` |
| `src/shared/agentConstants.ts` | `DEFAULT_CONTEXT_WINDOWS`, `COMBINED_CONTEXT_AGENTS` |
| `src/main/agents/definitions.ts` | `AGENT_DEFINITIONS` array — CLI args, configOptions, argBuilders |
| `src/main/agents/capabilities.ts` | `AGENT_CAPABILITIES` — capability record per agent |
| `src/main/parsers/agent-output-parser.ts` | `AgentOutputParser` interface (9 methods) + `ParsedEvent` type |
| `src/main/parsers/index.ts` | Parser factory: `initializeOutputParsers()` calls `registerOutputParser(new Parser())` |
| `src/main/parsers/error-patterns.ts` | Static `patternRegistry` map; `ErrorPattern = { pattern, message, recoverable }` |
| `src/main/storage/base-session-storage.ts` | `BaseSessionStorage` — 5 abstract methods; `applyMessagePagination` static helper |
| `src/main/storage/index.ts` | Storage factory: `initializeSessionStorages()` calls `registerSessionStorage(new Storage())` |
| `src/main/storage/codex-session-storage.ts` | **Reference** for JSONL-based session storage with `RemoteFsResult` wrappers |
| `src/main/process-manager/ProcessManager.ts` | Core agent process lifecycle; has `processes` Map |
| `src/main/process-manager/spawners/` | Per-spawner modules (`PtySpawner.ts`, `ChildProcessSpawner.ts`) + barrel `index.ts` |
| `src/main/process-manager/handlers/StdoutHandler.ts` | Calls `extractUsage`, `extractSessionId`, etc; emits typed IPC events: `process:session-id`, `process:usage`, `process:tool-execution` |
| `src/main/ipc/handlers/process.ts` | `registerProcessHandlers()` — all `ipcMain.handle(...)` entries for process management |
| `src/main/utils/agent-args.ts` | `buildAgentArgs` (sync) + `applyAgentConfigOverrides` (sync) — spawn argument assembly |
| `src/main/preload/index.ts` | Exposes `window.maestro.process.*` via `contextBridge.exposeInMainWorld` |
| `src/renderer/global.d.ts` | `MaestroAPI.process` namespace — renderer-side TypeScript declarations |
| `src/renderer/hooks/agent/useAgentListeners.ts` | IPC listener hub for `window.maestro.process.onXxx(...)` subscriptions |
| `src/renderer/hooks/agent/useInterruptHandler.ts` | Centralized abort logic — calls `window.maestro.process.interrupt(...)` |
| `src/renderer/hooks/agent/useSummarizeAndContinue.ts` | Compaction/summarize workflow entry point |
| `src/renderer/hooks/input/useInputProcessing.ts` | Input routing: batch agents spawn; live processes use `window.maestro.process.write(...)` |
| `src/renderer/hooks/tabs/useTabHandlers.ts` | Tab lifecycle — `closeTab()` here must call `process.kill` for persistent OMP processes |
| `src/renderer/stores/sessionStore.ts` | Zustand store |
| `src/renderer/slashCommands.ts` | Autocomplete; uses `agentTypes?: ToolType[]` per command |
| `src/renderer/components/Wizard/screens/AgentSelectionScreen.tsx` | Hardcoded `AGENT_TILES: AgentTile[]`; `AgentTile = { id, name, supported, description, brandColor? }`; `GRID_COLS=3`, `GRID_ROWS=2` |
| `src/renderer/components/Wizard/services/wizardPrompts.ts` | System prompt construction |
| `src/renderer/components/Wizard/services/conversationManager.ts` | Calls `generateSystemPrompt(...)`; thread agentId here |
| `src/renderer/components/shared/AgentConfigPanel.tsx` | Renders `configOptions` generically — handles `checkbox`, `text`, `number`, `select` |
| `src/renderer/components/QuickActionsModal.tsx` | Quick actions panel — add OMP Compact action here |
| `src/renderer/types/index.ts` | `AgentCapabilities` renderer copy — must stay in sync with main |
| `src/__tests__/main/agents/agent-completeness.test.ts` | CI gate — enforces 19 boolean capability fields |
| `src/__tests__/main/agents/capabilities.test.ts` | Enumerates `knownAgents` — add OMP |
| `src/__tests__/main/agents/definitions.test.ts` | `knownAgents` and `toContain` checks — add OMP |
| `src/__tests__/shared/agentMetadata.test.ts` | Asserts display names + beta — add OMP |
| `src/__tests__/shared/agentConstants.test.ts` | Asserts `DEFAULT_CONTEXT_WINDOWS` entries — OMP intentionally absent |
| `src/__tests__/renderer/hooks/useInlineWizard.test.ts` | Mocked `supportsWizard` list at line 17-18 — add OMP |

### Oh My Pi (`omp`, `/home/cbee/Repos/oh-my-pi`)

| Path | Role |
|---|---|
| `packages/coding-agent/src/commands/launch.ts` | CLI flags: `--mode rpc`, `--resume`, `--continue`, `--model` |
| `packages/coding-agent/src/modes/rpc/rpc-types.ts` | `RpcCommand` (stdin), `RpcResponse` + events (stdout) |
| `packages/coding-agent/src/modes/rpc/rpc-mode.ts` | Emits `{ type: "ready" }`, processes stdin commands, emits `extension_ui_request` |
| `packages/agent/src/types.ts` | `AgentEvent` union |
| `packages/coding-agent/src/session/session-manager.ts` | `SessionHeader` (first JSONL line); `getDefaultSessionDirName()` for path encoding |
| `packages/utils/src/dirs.ts` | `getSessionsDir()` → `~/.omp/agent/sessions/` |
| `packages/coding-agent/src/slash-commands/builtin-registry.ts` | Confirmed builtins: `/plan`, `/mcp`, `/compact`, `/background` |
| `agent/config.yml` | `modelRoles: { default, ask, orchestrator, plan, ... }` |

---

## Research Findings

### RPC Mode Protocol (definitive)

```
SPAWN:   omp --mode rpc [--model <model>] [--resume <session-id>]
STDOUT ← { "type": "ready" }
STDIN  → { "type": "get_state" }
STDOUT ← { "type": "response", "command": "get_state", "success": true,
           "data": { "sessionId": "abc123", "model": { "contextWindow": 131072, ... } } }
STDIN  → { "type": "prompt", "message": "refactor auth.ts" }
STDOUT ← { "type": "agent_start" }
STDOUT ← { "type": "message_update", "assistantMessageEvent": { "type": "content_block_delta",
           "delta": { "type": "text_delta", "text": "I'll refactor" } } }
STDOUT ← { "type": "tool_execution_start", "toolName": "bash", "args": {...} }
STDOUT ← { "type": "tool_execution_end", "toolName": "bash", "result": {...} }
STDOUT ← { "type": "agent_end" }
         ← process stays alive
STDIN  → { "type": "abort" }
STDIN  → { "type": "compact" }
KILL     (on tab close)
```

**Critical**: `message_update` carries `assistantMessageEvent` **delta** (`content_block_delta` with `delta.type = "text_delta"` or `"thinking_delta"`). Parse the delta, not `message.content`, to avoid replaying cumulative text.

**extension_ui_request**: OMP emits `{ type: "extension_ui_request", id, method, ... }` for tool-triggered UI. These block OMP until a response arrives. The spawner must auto-respond with `{ type: "extension_ui_response", id, cancelled: true }` on stdin for any request it cannot route to a Maestro dialog.

### Critical Interface Contracts (verified)

**`AgentErrorPatterns`** — `{ [K in AgentErrorType]?: ErrorPattern[] }` where:
```typescript
interface ErrorPattern {
  pattern: RegExp;
  message: string | ((match: RegExpMatchArray) => string);
  recoverable: boolean;
}
```
OMP patterns are added as a new entry in the **static `patternRegistry` Map** at the bottom of `error-patterns.ts` — NOT via `registerErrorPatterns` (which is test-only).

**`matchErrorPattern`** — called as `matchErrorPattern(patterns, line)` (patterns first, line second).

**`AgentSessionInfo`** — required fields: `sessionId`, `projectPath`, `timestamp`, `modifiedAt`, `firstMessage`, `messageCount`, `sizeBytes`, `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheCreationTokens`, `durationSeconds`. Optional: `costUsd`, `origin`, `sessionName`, `starred`.

**`RemoteFsResult<T>`** — `{ success: boolean, data?: T, error?: string }`. Every `readDirRemote` / `readFileRemote` / `statRemote` call must check `.success` before reading `.data`.

**`SessionMessagesResult`** — `{ messages: SessionMessage[], total: number, hasMore: boolean }`. Use `BaseSessionStorage.applyMessagePagination(messages, options)` to produce this.

**OMP `get_session_stats` tokens** — nested: `data.tokens?.input`, `data.tokens?.output` (not `data.inputTokens`).

**Context window IPC path** — `extractUsage` returning `{ inputTokens, outputTokens, contextWindow }` → `StdoutHandler` → `process:usage` → `useAgentListeners.onUsage` → `useBatchedSessionUpdates` writes `contextWindow` into `usageStats`. No new IPC channel needed.

**Session ID IPC path** — `extractSessionId` returning string → `StdoutHandler` → `process:session-id` → `useAgentListeners.onSessionId`. Already used by all agents.

**OMP session path encoding** — use `getDefaultSessionDirName(cwd)` from `packages/coding-agent/src/session/session-manager.ts` as the reference. Do NOT use a placeholder regex. Implement the same encoding logic verified against that function.

### OMP Agent Modes → Maestro UI

| Mode | Spawn args | Model source |
|---|---|---|
| default | `omp --mode rpc` | OMP's own configured default |
| ask | `omp --mode rpc --model <value>` | `modelRoles.ask` from `~/.omp/agent/config.yml` |
| orchestrator | `omp --mode rpc --model <value>` | `modelRoles.orchestrator` from config |
| plan | `omp --mode rpc --model <value>` | `modelRoles.plan` from config |

Model resolution is **synchronous** in `agent-args.ts` using `fs.readFileSync`. Manual override always wins over mode-resolved model. Unreadable config or missing role key → no `--model` flag.

### ProcessManager Architecture Gap

All current spawners handle batch agents (spawn → stdout → exit). OMP RPC requires:
1. A new `omp-rpc-spawner.ts` — keeps process alive, stdin pipe, `ready` handshake, `extension_ui_request` auto-cancel
2. New IPC handler `maestro:process:send-stdin-command` → `window.maestro.process.sendStdinCommand`
3. Input routing in `useInputProcessing.ts` uses the existing **live-process** `window.maestro.process.write(...)` path (NOT spawn), with OMP using a parallel JSON-command write
4. Abort wired in `useInterruptHandler.ts` → sends `{ type: 'abort' }` via `sendStdinCommand`
5. Compaction added as a new action in `QuickActionsModal.tsx` for OMP tabs
6. Tab close: `useTabHandlers.ts` must explicitly call `window.maestro.process.kill(sessionId)` for OMP tabs
7. OMP ready → parsed as `init` event → `extractSessionId` returns null (real session ID comes from `get_state` response) → after emitting `init`, spawner also sends `get_state` → response comes back with session ID + context window routed via existing `process:session-id` and `process:usage` channels

---

## Phased Implementation Plan

### Phase 1 — Foundation Registration (all 4 units run in parallel)

---

#### Unit 1-A — Agent Identity Registration

**Parallel safety**: Touches only `agentIds.ts`, `agentMetadata.ts`, `agentConstants.ts`.

**Target files**:
- `src/shared/agentIds.ts`
- `src/shared/agentMetadata.ts`
- `src/shared/agentConstants.ts`

**`agentIds.ts`**:
```typescript
export const AGENT_IDS = [
  'terminal', 'claude-code', 'codex', 'gemini-cli', 'qwen3-coder',
  'opencode', 'factory-droid', 'aider',
  'omp',
] as const;
```

**`agentMetadata.ts`**:
```typescript
export const AGENT_DISPLAY_NAMES: Record<AgentId, string> = {
  // ... existing entries
  'omp': 'Oh My Pi',
};
export const BETA_AGENTS: ReadonlySet<AgentId> = new Set<AgentId>([
  'codex', 'opencode', 'factory-droid',
  'omp',
]);
```

**`agentConstants.ts`** — add inline comment only; no static entry:
```typescript
// 'omp' is intentionally absent from DEFAULT_CONTEXT_WINDOWS.
// Context window is reported dynamically via the RPC get_state response
// (see OmpOutputParser.extractUsage → process:usage channel).
```

**Acceptance**: `AgentId` includes `'omp'`. TypeScript emits Record errors until 1-B completes — expected.

---

#### Unit 1-B — Agent Definition and Capabilities

**Parallel safety**: Touches only `agents/definitions.ts` and `agents/capabilities.ts`.

**`definitions.ts`** — add to `AGENT_DEFINITIONS`:
```typescript
{
  id: 'omp',
  name: 'Oh My Pi',
  binaryName: 'omp',
  command: 'omp',
  args: ['--mode', 'rpc'],
  requiresPty: false,
  resumeArgs: (sessionId: string) => ['--resume', sessionId],
  readOnlyArgs: [],
  readOnlyCliEnforced: false,
  modelArgs: (modelId: string) => ['--model', modelId],
  configOptions: [
    {
      key: 'agentMode',
      type: 'select',
      label: 'Agent Mode',
      description:
        'Which OMP role to start in. Each mode uses the corresponding modelRoles entry from ~/.omp/agent/config.yml.',
      options: ['default', 'ask', 'orchestrator', 'plan'],
      default: 'default',
      // No argBuilder — mode→model resolution is synchronous in agent-args.ts at spawn time.
    },
    {
      key: 'model',
      type: 'text',
      label: 'Model Override',
      description:
        'Override the model (e.g. "anthropic/claude-sonnet-4-6"). ' +
        'Leave empty to use the model for the selected Agent Mode.',
      default: '',
      argBuilder: (value: string) =>
        value && value.trim() ? ['--model', value.trim()] : [],
    },
  ],
},
```

**`capabilities.ts`** — add OMP entry with all 19 required boolean fields:
```typescript
'omp': {
  supportsResume: true,
  supportsReadOnlyMode: true,
  supportsJsonOutput: true,
  supportsSessionId: true,
  supportsImageInput: true,
  supportsImageInputOnResume: true,
  supportsSlashCommands: true,
  supportsSessionStorage: true,
  supportsCostTracking: false,
  supportsUsageStats: true,
  supportsBatchMode: false,
  requiresPromptToStart: false,
  supportsStreaming: true,
  supportsResultMessages: false,
  supportsModelSelection: true,
  supportsStreamJsonInput: false,
  supportsThinkingDisplay: true,
  supportsContextMerge: true,
  supportsContextExport: true,
  supportsWizard: true,
  supportsGroupChatModeration: true,
  usesJsonLineOutput: true,
  usesCombinedContextWindow: false,
},
```

**Acceptance**: All `Record<AgentId, ...>` compile errors resolve when paired with 1-A.

---

#### Unit 1-C — Output Parser and Error Patterns

**Parallel safety**: Creates `parsers/omp-output-parser.ts`. Edits `parsers/error-patterns.ts` and `parsers/index.ts`. No overlap with other Phase 1 units.

**Target files**:
- `src/main/parsers/omp-output-parser.ts` (new)
- `src/main/parsers/error-patterns.ts` (add `OMP_ERROR_PATTERNS` + registry entry)
- `src/main/parsers/index.ts` (register parser)

**OMP event → ParsedEvent mapping**:

| OMP stdout | ParsedEvent | Notes |
|---|---|---|
| `{ type: "ready" }` | `{ type: "system", text: "OMP ready" }` | Process ready |
| `{ type: "response", command: "get_state", success: true, data: { sessionId, model } }` | `{ type: "init", sessionId }` + `extractUsage` returns `{ inputTokens:0, outputTokens:0, contextWindow:N }` | Session ID + context window |
| `message_update` with `delta.type = "text_delta"` | `{ type: "text", text: delta.text, isPartial: true }` | Use DELTA only |
| `message_update` with `delta.type = "thinking_delta"` | `{ type: "text", text: delta.thinking, isPartial: true }` | Thinking stream |
| `{ type: "tool_execution_start" }` | `{ type: "tool_use", toolName, toolState: { status:"running", input:args } }` | |
| `{ type: "tool_execution_update" }` | `{ type: "tool_use", toolName, toolState: { status:"running", output:partialResult } }` | |
| `{ type: "tool_execution_end" }` | `{ type: "tool_use", toolName, toolState: { status:"completed"|"error", output:result } }` | |
| `{ type: "agent_end" }` | `{ type: "result", text: "" }` | Turn complete |
| `{ type: "response", success: false }` | `{ type: "error", text: error }` | RPC error |
| `extension_ui_request` | `null` — spawner auto-cancels on stdin | Prevents hang |

**New file `src/main/parsers/omp-output-parser.ts`**:

```typescript
/**
 * OMP (Oh My Pi) Output Parser
 *
 * Parses JSONL events from `omp --mode rpc`.
 *
 * Key points:
 * - message_update carries an assistantMessageEvent DELTA — read delta.text/thinking,
 *   NOT the accumulated message.content to avoid replaying cumulative text.
 * - Context window surfaces via extractUsage() on the get_state response.
 * - matchErrorPattern(patterns, line) — patterns first, line second.
 * - get_session_stats token counts are nested: data.tokens.input / data.tokens.output
 */
import type { AgentOutputParser, ParsedEvent } from './agent-output-parser';
import type { AgentError, ToolType } from '../../shared/types';
import { getErrorPatterns, matchErrorPattern } from './error-patterns';

export class OmpOutputParser implements AgentOutputParser {
  readonly agentId: ToolType = 'omp';

  parseJsonLine(line: string): ParsedEvent | null {
    try {
      return this.parseJsonObject(JSON.parse(line));
    } catch {
      return null;
    }
  }

  parseJsonObject(parsed: unknown): ParsedEvent | null {
    if (!parsed || typeof parsed !== 'object') return null;
    const event = parsed as Record<string, unknown>;
    const type = event.type as string;

    if (type === 'ready') {
      return { type: 'system', text: 'OMP ready', raw: event };
    }

    // get_state response: emit init with session ID; extractUsage handles context window
    if (type === 'response' && event.command === 'get_state' && event.success === true) {
      const data = event.data as Record<string, unknown> | undefined;
      return {
        type: 'init',
        sessionId: data?.sessionId as string | undefined,
        slashCommands: undefined,
        raw: event,
      };
    }

    // Streaming text — use assistantMessageEvent DELTA, not accumulated message.content
    if (type === 'message_update') {
      const ame = event.assistantMessageEvent as Record<string, unknown> | undefined;
      if (ame?.type === 'content_block_delta') {
        const delta = ame.delta as Record<string, unknown> | undefined;
        if (delta?.type === 'text_delta' && delta.text) {
          return { type: 'text', text: String(delta.text), isPartial: true, raw: event };
        }
        if (delta?.type === 'thinking_delta' && delta.thinking) {
          return { type: 'text', text: String(delta.thinking), isPartial: true, raw: event };
        }
      }
      return null;
    }

    if (type === 'tool_execution_start') {
      return {
        type: 'tool_use',
        toolName: String(event.toolName ?? ''),
        toolState: { status: 'running', input: event.args },
        raw: event,
      };
    }
    if (type === 'tool_execution_update') {
      return {
        type: 'tool_use',
        toolName: String(event.toolName ?? ''),
        toolState: { status: 'running', output: event.partialResult },
        raw: event,
      };
    }
    if (type === 'tool_execution_end') {
      return {
        type: 'tool_use',
        toolName: String(event.toolName ?? ''),
        toolState: { status: event.isError ? 'error' : 'completed', output: event.result },
        raw: event,
      };
    }

    if (type === 'agent_end') {
      return { type: 'result', text: '', raw: event };
    }

    if (type === 'response' && event.success === false) {
      return { type: 'error', text: String(event.error ?? 'OMP error'), raw: event };
    }

    // extension_ui_request: spawner auto-responds, parser returns null
    return null;
  }

  isResultMessage(event: ParsedEvent): boolean {
    return event.type === 'result';
  }

  extractSessionId(event: ParsedEvent): string | null {
    return event.sessionId ?? null;
  }

  /**
   * Extracts usage from get_state (context window) and get_session_stats (token counts).
   * Note: get_session_stats token counts are nested under data.tokens.*
   */
  extractUsage(event: ParsedEvent): ParsedEvent['usage'] | null {
    const raw = event.raw as Record<string, unknown> | undefined;
    if (!raw) return null;

    if (raw.command === 'get_state' && raw.success === true) {
      const data = raw.data as Record<string, unknown> | undefined;
      const model = data?.model as Record<string, unknown> | undefined;
      const cw = model?.contextWindow as number | undefined;
      if (cw) return { inputTokens: 0, outputTokens: 0, contextWindow: cw };
    }

    if (raw.command === 'get_session_stats' && raw.success === true) {
      const data = raw.data as Record<string, unknown> | undefined;
      // OMP SessionStats nests token counts under data.tokens
      const tokens = data?.tokens as Record<string, unknown> | undefined;
      if (tokens) {
        return {
          inputTokens: Number(tokens.input ?? 0),
          outputTokens: Number(tokens.output ?? 0),
          cacheReadTokens: Number(tokens.cacheRead ?? 0),
          cacheCreationTokens: Number(tokens.cacheWrite ?? 0),
        };
      }
    }

    return null;
  }

  extractSlashCommands(_event: ParsedEvent): string[] | null {
    // OMP slash commands are registered statically in slashCommands.ts via agentTypes.
    return null;
  }

  detectErrorFromLine(line: string): AgentError | null {
    // matchErrorPattern(patterns, line) — patterns first
    return matchErrorPattern(getErrorPatterns('omp'), line);
  }

  detectErrorFromParsed(parsed: unknown): AgentError | null {
    if (!parsed || typeof parsed !== 'object') return null;
    const event = parsed as Record<string, unknown>;
    if (event.type === 'response' && event.success === false) {
      return {
        type: 'agent_crashed',
        message: String(event.error ?? 'OMP RPC error'),
        raw: JSON.stringify(parsed),
      };
    }
    return null;
  }

  detectErrorFromExit(exitCode: number, stderr: string, _stdout: string): AgentError | null {
    if (exitCode === 0) return null;
    const fromLine = this.detectErrorFromLine(stderr);
    if (fromLine) return fromLine;
    return {
      type: 'agent_crashed',
      message: `OMP exited with code ${exitCode}`,
      raw: stderr,
    };
  }
}
```

**`error-patterns.ts`** — add `OMP_ERROR_PATTERNS` constant and register it in the static `patternRegistry` Map (follow the exact pattern used by CLAUDE/CODEX/OPENCODE/FACTORY_DROID entries):

```typescript
// Add this constant alongside the existing agent pattern constants:
const OMP_ERROR_PATTERNS: AgentErrorPatterns = {
  auth_expired: [
    { pattern: /invalid api key/i, message: 'OMP API key is invalid. Check your provider configuration.', recoverable: true },
    { pattern: /authentication failed/i, message: 'Authentication failed. Re-run `omp config` to reconfigure.', recoverable: true },
    { pattern: /unauthorized/i, message: 'Unauthorized. Check your API credentials.', recoverable: true },
    { pattern: /oauth.*expired/i, message: 'OAuth token expired. Re-authenticate.', recoverable: true },
  ],
  token_exhaustion: [
    { pattern: /context.*(?:window|length).*exceeded/i, message: 'OMP context window exceeded. Use /compact to reduce context.', recoverable: true },
    { pattern: /too many tokens/i, message: 'Token limit reached. Use /compact to reduce context.', recoverable: true },
  ],
  rate_limited: [
    { pattern: /rate limit/i, message: 'Rate limit reached. Waiting before retry.', recoverable: true },
    { pattern: /too many requests/i, message: 'Too many requests. Waiting before retry.', recoverable: true },
  ],
  network_error: [
    { pattern: /ECONNREFUSED/, message: 'Connection refused. Check your network and provider endpoint.', recoverable: false },
    { pattern: /ETIMEDOUT/, message: 'Connection timed out. Check your network connection.', recoverable: false },
    { pattern: /network.*error/i, message: 'Network error. Check your internet connection.', recoverable: false },
  ],
};

// In the patternRegistry Map initialization, add:
// ['omp', OMP_ERROR_PATTERNS],
```

The exact edit: in the `patternRegistry` Map at line ~862 in `error-patterns.ts`, add `['omp', OMP_ERROR_PATTERNS]` alongside the existing entries.

**`parsers/index.ts`** — inside `initializeOutputParsers()`:

```typescript
import { OmpOutputParser } from './omp-output-parser';
// Add in initializeOutputParsers():
registerOutputParser(new OmpOutputParser());
```

**Acceptance**: `OmpOutputParser` implements all 9 `AgentOutputParser` methods. `getErrorPatterns('omp')` returns non-empty. Agent-completeness CI passes for `supportsJsonOutput`.

---

#### Unit 1-D — Session Storage Browser

**Parallel safety**: Creates `storage/omp-session-storage.ts`. Edits `storage/index.ts` only.

**Target files**:
- `src/main/storage/omp-session-storage.ts` (new)
- `src/main/storage/index.ts` (register)

**Reference**: `CodexSessionStorage` — same JSONL-in-subdirectory structure. Follow it exactly for `RemoteFsResult` wrappers, `AgentSessionInfo` shape, and `applyMessagePagination`.

**OMP session layout**: `~/.omp/agent/sessions/<encoded-cwd>/` — exact encoding from `getDefaultSessionDirName(cwd)` in `packages/coding-agent/src/session/session-manager.ts`. Do NOT use a placeholder regex. Read and port that function's logic before finalizing `resolveSessionDir`.

**New file `src/main/storage/omp-session-storage.ts`**:

```typescript
/**
 * OMP Session Storage
 *
 * Reads OMP session JSONL files from ~/.omp/agent/sessions/<encoded-cwd>/
 * Uses CodexSessionStorage as the structural reference for RemoteFsResult
 * wrappers, AgentSessionInfo shape, and BaseSessionStorage patterns.
 *
 * CRITICAL: Before finalizing resolveSessionDir(), read
 * packages/coding-agent/src/session/session-manager.ts getDefaultSessionDirName()
 * and port its encoding logic exactly. The placeholder below is for structure only.
 */
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import fsSync from 'fs';
import { logger } from '../utils/logger';
import { captureException } from '../utils/sentry';
import { readDirRemote, readFileRemote, statRemote } from '../utils/remote-fs';
import type {
  AgentSessionInfo,
  SessionMessagesResult,
  SessionReadOptions,
  SessionMessage,
} from '../agents';
import type { ToolType, SshRemoteConfig } from '../../shared/types';
import { BaseSessionStorage, type SearchableMessage } from './base-session-storage';

const LOG_CONTEXT = '[OmpSessionStorage]';
const OMP_SESSIONS_ROOT = path.join(os.homedir(), '.omp', 'agent', 'sessions');
const MAX_SESSION_FILE_SIZE = 100 * 1024 * 1024;

export class OmpSessionStorage extends BaseSessionStorage {
  readonly agentId: ToolType = 'omp';

  async listSessions(
    projectPath: string,
    sshConfig?: SshRemoteConfig,
  ): Promise<AgentSessionInfo[]> {
    const sessionDir = this.resolveSessionDir(projectPath);
    const sessions: AgentSessionInfo[] = [];
    try {
      let entries: { name: string; isDirectory: boolean }[];
      if (sshConfig) {
        // Remote (SSH) path — use Maestro remote-fs helpers
        const dirResult = await readDirRemote(sessionDir, sshConfig);
        if (!dirResult.success || !dirResult.data) return [];
        entries = dirResult.data;
      } else {
        // Local path — use Node fs directly
        const names = await fs.readdir(sessionDir).catch(() => null);
        if (!names) return [];
        entries = names.map(name => ({ name, isDirectory: false }));
      }

      for (const entry of entries) {
        if (entry.isDirectory || !entry.name.endsWith('.jsonl')) continue;
        const filePath = path.join(sessionDir, entry.name);
        try {
          let firstLine: string;
          if (sshConfig) {
            const result = await readFileRemote(filePath, sshConfig);
            if (!result.success || !result.data) continue;
            firstLine = result.data.split('\n')[0];
          } else {
            const raw = await fs.readFile(filePath, 'utf-8').catch(() => null);
            if (!raw) continue;
            firstLine = raw.split('\n')[0];
          }
          const header = JSON.parse(firstLine);
          if (header.type !== 'session' || !header.id) continue;

          let sizeBytes = 0;
          let mtime = Date.now();
          if (sshConfig) {
            const statResult = await statRemote(filePath, sshConfig);
            if (statResult.success && statResult.data) {
              sizeBytes = statResult.data.size;
              mtime = statResult.data.mtime;
            }
          } else {
            const stat = await fs.stat(filePath).catch(() => null);
            if (stat) { sizeBytes = stat.size; mtime = stat.mtimeMs; }
          }

          sessions.push({
            sessionId: header.id,
            projectPath,
            timestamp: header.created_at ?? new Date(mtime).toISOString(),
            modifiedAt: new Date(mtime).toISOString(),
            firstMessage: header.title ?? '',
            messageCount: 0,
            sizeBytes,
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
            durationSeconds: 0,
            sessionName: header.title,
          });
        } catch (err) {
          logger.warn(`OmpSessionStorage: skipping ${entry.name}`, { err }, LOG_CONTEXT);
        }
      }
      return sessions.sort(
        (a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime(),
      );
    } catch {
      return [];
    }
  }

  async readSessionMessages(
    projectPath: string,
    sessionId: string,
    options?: SessionReadOptions,
    sshConfig?: SshRemoteConfig,
  ): Promise<SessionMessagesResult> {
    const filePath = this.getSessionPath(projectPath, sessionId, sshConfig);
    if (!filePath) return { messages: [], total: 0, hasMore: false };
    try {
      let rawContent: string;
      if (sshConfig) {
        const result = await readFileRemote(filePath, sshConfig);
        if (!result.success || !result.data) return { messages: [], total: 0, hasMore: false };
        rawContent = result.data;
      } else {
        rawContent = await fs.readFile(filePath, 'utf-8');
      }
      const lines = rawContent.split('\n').filter(Boolean);
      const messages: SessionMessage[] = [];
      for (let i = 1; i < lines.length; i++) {
        try {
          const event = JSON.parse(lines[i]);
          const msg = this.eventToSessionMessage(event);
          if (msg) messages.push(msg);
        } catch { /* skip malformed */ }
      }
      return BaseSessionStorage.applyMessagePagination(messages, options);
    } catch (err) {
      captureException(err, { operation: 'ompStorage:readSessionMessages', sessionId });
      return { messages: [], total: 0, hasMore: false };
    }
  }

  getSessionPath(
    projectPath: string,
    sessionId: string,
    _sshConfig?: SshRemoteConfig,
  ): string | null {
    const sessionDir = this.resolveSessionDir(projectPath);
    const filePath = path.join(sessionDir, `${sessionId}.jsonl`);
    return fsSync.existsSync(filePath) ? filePath : null;
  }

  async deleteMessagePair(
    _projectPath: string,
    _sessionId: string,
    _userMessageUuid: string,
    _fallbackContent?: string,
    _sshConfig?: SshRemoteConfig,
  ): Promise<{ success: boolean; error?: string; linesRemoved?: number }> {
    return { success: false, error: 'OMP sessions are append-only; message deletion is not supported.' };
  }

  protected async getSearchableMessages(
    sessionId: string,
    projectPath: string,
    sshConfig?: SshRemoteConfig,
  ): Promise<SearchableMessage[]> {
    const result = await this.readSessionMessages(projectPath, sessionId, undefined, sshConfig);
    return result.messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({ role: m.role as 'user' | 'assistant', textContent: m.content }));
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  /**
   * Resolve OMP session directory for a given project path.
   * MUST port getDefaultSessionDirName() from OMP's session-manager.ts before shipping.
   * The encoding distinguishes home-relative, temp-root, and legacy absolute paths.
   */
  private resolveSessionDir(projectPath: string): string {
    // TODO: replace with ported getDefaultSessionDirName() logic from OMP source
    // packages/coding-agent/src/session/session-manager.ts lines ~402-421
    const encoded = projectPath.replace(/\//g, '-').replace(/^-/, '');
    return path.join(OMP_SESSIONS_ROOT, encoded);
  }

  private eventToSessionMessage(event: Record<string, unknown>): SessionMessage | null {
    // Adapt to actual OMP JSONL session format confirmed during implementation
    if (event.role === 'user' && typeof event.content === 'string') {
      return {
        type: 'message',
        role: 'user',
        content: event.content,
        timestamp: String(event.timestamp ?? new Date().toISOString()),
        uuid: String(event.id ?? ''),
      };
    }
    if (event.type === 'message_end' && event.role === 'assistant') {
      const text = extractTextContent(event.content);
      if (text) {
        return {
          type: 'message',
          role: 'assistant',
          content: text,
          timestamp: String(event.timestamp ?? new Date().toISOString()),
          uuid: String(event.id ?? ''),
        };
      }
    }
    return null;
  }
}

function extractTextContent(content: unknown): string | null {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  return content
    .filter((b: { type?: string }) => b.type === 'text')
    .map((b: { text?: string }) => b.text ?? '')
    .join('') || null;
}
```

**`storage/index.ts`** — inside `initializeSessionStorages()`:
```typescript
import { OmpSessionStorage } from './omp-session-storage';
registerSessionStorage(new OmpSessionStorage());
```

**Acceptance**: `getSessionStorage('omp')` returns a non-null instance. Agent-completeness CI passes for `supportsSessionStorage`. `applyMessagePagination` ensures `total` is always present.

---

### Phase 2 — RPC Process Manager (sequential: 2-A → 2-B → 2-C)

---

#### Unit 2-A — OMP RPC Spawner

**Depends on**: Phase 1 complete.

**Target files**:
- `src/main/process-manager/spawners/omp-rpc-spawner.ts` (new)
- `src/main/process-manager/ProcessManager.ts` (add OMP side-map + `sendOmpCommand`)

**`OmpRpcProcess` type**:
```typescript
interface OmpRpcProcess {
  process: ChildProcess;
  ready: boolean;
  pendingCommands: string[];
  sendCommand: (cmd: object) => void;
  sessionId: string | null;
  maestroTabId: string; // component of the composite targetSessionId key
}
```

**`omp-rpc-spawner.ts`** — spawns `omp --mode rpc [--model x] [--resume id]` with `stdin: 'pipe'`, `stdout: 'pipe'`. On `{ type: "ready" }`:
1. Flush `pendingCommands` to stdin
2. Send `{ type: "get_state" }` to stdin — triggers session ID + context window initialization via `process:session-id` and `process:usage` events
3. Mark `ready = true`

`extension_ui_request` handler: on any `extension_ui_request` event, immediately write `JSON.stringify({ type: "extension_ui_response", id: event.id, cancelled: true }) + "\n"` to stdin.

**`ProcessManager.ts`** additions (additive, does not change existing `processes` map):
```typescript
// OMP processes are registered in BOTH maps:
//   1. Standard `processes` Map under composite key targetSessionId = `${maestroSessionId}-ai-${maestroTabId}`
//      -> ensures existing process.kill(targetSessionId) works unchanged for tab close
//   2. `ompProcesses` side map under the SAME targetSessionId key
//      -> used only for OMP stdin routing (sendOmpCommand / killOmpProcess)
private ompProcesses = new Map<string, OmpRpcProcess>();

sendOmpCommand(targetSessionId: string, cmd: object): void {
  const proc = this.ompProcesses.get(targetSessionId);
  if (!proc) return;
  if (!proc.ready) {
    proc.pendingCommands.push(JSON.stringify(cmd));
    return;
  }
  proc.sendCommand(cmd);
}

killOmpProcess(targetSessionId: string): void {
  // Removes from the OMP side map only; the standard processes Map entry is
  // cleaned up by the existing ProcessManager.kill(targetSessionId) path.
  this.ompProcesses.delete(targetSessionId);
}
```

**Acceptance**: OMP spawns, `{ type: "ready" }` received, `get_state` auto-sent, `session-id` and `usage` IPC events emitted.

---

#### Unit 2-B — Stdin Command IPC Handler

**Depends on**: 2-A.

**Target files**:
- `src/main/ipc/handlers/process.ts` (add `sendStdinCommand` handler)
- `src/main/preload/index.ts` (expose on `window.maestro.process`)
- `src/renderer/global.d.ts` (add declaration to `process` namespace)

**Main process handler** (inside `registerProcessHandlers()`):
```typescript
ipcMain.handle('maestro:process:send-stdin-command', async (_, { targetSessionId, command }) => {
  getProcessManager().sendOmpCommand(targetSessionId, command);
});
```

**Preload** — add to the existing `process` namespace object (same level as `spawn`, `write`, `kill`, etc.):
```typescript
sendStdinCommand: (targetSessionId: string, command: object) =>
  ipcRenderer.invoke('maestro:process:send-stdin-command', { targetSessionId, command }),
```

**`global.d.ts`** — add to `MaestroAPI.process`:
```typescript
sendStdinCommand: (targetSessionId: string, command: object) => Promise<void>;
```

**Acceptance**: `window.maestro.process.sendStdinCommand(targetSessionId, { type: 'get_state' })` delivers the command to OMP's stdin, where `targetSessionId` is the composite key `${maestroSessionId}-ai-${maestroTabId}`.

---

#### Unit 2-C — Renderer Routing, Abort, Compact, and Tab Close

**Depends on**: 2-B.

**Target files**:
- `src/renderer/hooks/input/useInputProcessing.ts`
- `src/renderer/hooks/agent/useInterruptHandler.ts`
- `src/renderer/components/QuickActionsModal.tsx`

**Tab-close cleanup**: The OMP RPC spawner registers each process in BOTH the standard `processes` Map AND the `ompProcesses` side map, both keyed by the composite `targetSessionId` (`${maestroSessionId}-ai-${maestroTabId}`). When a tab closes, the existing renderer path calls `window.maestro.process.kill(targetSessionId)`, which terminates the process and removes it from the standard `processes` Map. `ProcessManager.kill()` also calls `killOmpProcess(targetSessionId)` (guarded by side-map presence) to clean up `ompProcesses`. **No edit to `useTabHandlers.ts` is required.**

**Input routing — `useInputProcessing.ts`**:

`useInputProcessing` already has a live-process branch using `window.maestro.process.write(...)`. OMP uses this same live branch. Add an OMP-specific sub-branch using `activeSession.toolType` (the actual state field):

```typescript
// In the live-process routing section of processInput(), before the existing write() call.
// The live-process branch already derives a local variable for the processed message text.
if (activeSession.toolType === 'omp') {
  const targetSessionId = `${activeSession.id}-ai-${activeTabForSpawn?.id || activeTab?.id || 'default'}`;
  await window.maestro.process.sendStdinCommand(targetSessionId, {
    type: 'prompt',
    // Pass whichever local variable holds the already-processed message text at this point
    // in the live-process branch -- the same value passed to write() for non-OMP agents.
    message: effectiveInputValue,
  });
  return;
}
// existing live-process write() for other agents follows
```

> **Implementation note**: `effectiveInputValue` and `activeTabForSpawn` are best-guess names.
> The implementer MUST use the exact local variables present at the `window.maestro.process.write(...)`
> call site inside `processInput` instead.

**Abort — `useInterruptHandler.ts`**:

The existing interrupt handler derives `targetSessionId` as `` `${activeSession.id}-ai-${activeTab?.id || 'default'}` `` and calls `window.maestro.process.interrupt(targetSessionId)`. Add an OMP branch before that call:

```typescript
// Existing derivation (already in useInterruptHandler.ts):
const targetSessionId = activeSession.inputMode === 'ai'
  ? `${activeSession.id}-ai-${activeTab?.id || 'default'}`
  : `${activeSession.id}-terminal`;

// OMP: send stdin abort instead of PTY interrupt signal
if (activeSession.toolType === 'omp') {
  await window.maestro.process.sendStdinCommand(targetSessionId, { type: 'abort' });
  return;
}
// existing interrupt for other agents follows
```

**Compaction — `QuickActionsModal.tsx`**:

The modal receives `activeSessionId: string` from props and builds `mainActions: QuickAction[]` as a data array. Locate the active session object via the sessions prop or store to read `toolType`. For the active tab ID, use whichever store/hook the modal already uses to get the current active tab (e.g. the sessions store's `activeTabId` field or equivalent). Add an OMP-specific entry:

```typescript
// Add to mainActions: QuickAction[] array.
// Actual QuickAction interface: { id: string; label: string; action: () => void; subtext?: string; shortcut?: Shortcut }
// `activeSession` = sessions.find(s => s.id === activeSessionId)
// `activeTabId`   = retrieved from the same sessions/tabs store the rest of the modal uses
...(activeSession?.toolType === 'omp' ? [{
  id: 'omp-compact',
  label: 'Compact Context',
  subtext: 'Compress OMP session context to free token space',
  action: () => {
    const targetId = `${activeSessionId}-ai-${activeTabId || 'default'}`;
    window.maestro.process.sendStdinCommand(targetId, { type: 'compact' });
    setQuickActionOpen(false);
  },
}] : []),
```

> **Implementation note**: `activeTabId` must come from the same store/hook that provides the current tab elsewhere in this component. Check how other modal action closures access the active tab and use the same source.

**Acceptance**: User can send messages to an OMP tab (routes via stdin using `targetSessionId`). Abort sends `{ type: 'abort' }` to OMP via `useInterruptHandler`. Closing an OMP tab kills the process via the standard `process.kill(targetSessionId)` path (no renderer change needed). Compact action appears in Quick Actions for OMP sessions with the correct `{ id, label, action, subtext }` shape.

---

### Phase 3 — UI Integration (all 4 units run in parallel, depend on Phase 2)

---

#### Unit 3-A — Wizard Integration

**Target files**:
- `src/renderer/components/Wizard/screens/AgentSelectionScreen.tsx`
- `src/renderer/components/Wizard/services/wizardPrompts.ts`
- `src/renderer/components/Wizard/services/conversationManager.ts`

**`AgentSelectionScreen.tsx`** — add OMP to `AGENT_TILES` using the actual `AgentTile` interface (`{ id, name, supported, description, brandColor? }`):

```typescript
// Add after factory-droid (last supported agent), before coming-soon agents:
{
  id: 'omp',
  name: 'Oh My Pi',
  supported: true,
  description: 'Your Oh My Pi coding agent — parallel subagents, plan/implement workflow',
  brandColor: '#7C3AED', // purple — adjust to match branding preference
},
```

**Navigation update**: After adding OMP (7th tile), `GRID_COLS=3` and `GRID_ROWS=2` cover only 6 tiles. Update the grid to accommodate 7 tiles. Options: change to `GRID_ROWS=3` (adds an empty third row), or derive rows dynamically: `const GRID_ROWS = Math.ceil(AGENT_TILES.length / GRID_COLS)`. Update the ArrowDown bounds check accordingly.

**`wizardPrompts.ts`** — add an OMP ask-role system prompt variant alongside existing agent-specific prompts. OMP's ask role is conversational and focused on discovery. The prompt should reflect OMP's strengths: it can orchestrate parallel research agents, run a plan/implement cycle, and work across multiple files.

**`conversationManager.ts`** — update `generateSystemPrompt(...)` call to pass `selectedAgentId` so OMP's variant is selected when the user picks Oh My Pi in the wizard.

**Acceptance**: OMP tile appears in the wizard. Selecting it starts the wizard conversation using the OMP ask-role prompt.

---

#### Unit 3-B — Slash Command Autocomplete

**Target files**:
- `src/renderer/slashCommands.ts`

Add only commands **confirmed to exist in OMP's builtin registry** (`builtin-registry.ts`). Use `agentTypes: ['omp']` to filter — the same pattern as `agentTypes: ['claude-code']` already in use.

**Confirmed OMP builtins** (verified in `packages/coding-agent/src/slash-commands/builtin-registry.ts`):
```typescript
{ command: '/plan',       description: 'Start a planning session', agentTypes: ['omp'] },
{ command: '/compact',    description: 'Compress session context to free up token space', agentTypes: ['omp'] },
{ command: '/mcp',        description: 'Manage MCP server connections', agentTypes: ['omp'] },
{ command: '/background', description: 'Run current task in the background', agentTypes: ['omp'] },
```

Do NOT add `/plan-new`, `/thinking`, `/commit`, `/worktree`, or `/role` — these are not confirmed builtins (they are either file-based commands, extension-registered, or have been renamed). Confirm against live OMP source before adding any additional commands.

**Acceptance**: Typing `/` in an OMP tab shows the 4 confirmed OMP slash commands.

---

#### Unit 3-C — Agent Config UI

**Target files**:
- Verify `src/renderer/components/shared/AgentConfigPanel.tsx` renders `select` and `text` options generically

`AgentConfigPanel.tsx` already renders all four `configOptions` types (`checkbox`, `text`, `number`, `select`) generically — verified at lines 600–678. OMP's `agentMode` (select) and `model` (text) configOptions will render without special-casing. No code changes needed beyond confirming the existing UI handles them correctly.

**Acceptance**: Creating a new OMP agent displays the mode selector and model override field.

---

#### Unit 3-D — Live Context Window Display

**Target files**:
- Verify `src/renderer/hooks/agent/useAgentListeners.ts` and `useBatchedSessionUpdates.ts`

The context window pipeline is already complete: `OmpOutputParser.extractUsage` returns `{ inputTokens: 0, outputTokens: 0, contextWindow: N }` on the `get_state` response → `StdoutHandler` emits `process:usage` → `useAgentListeners.onUsage` → `useBatchedSessionUpdates` writes `contextWindow` into tab `usageStats`. No new IPC channel needed.

**Acceptance**: Starting an OMP session causes the context bar to show the model's actual token limit.

---

### Phase 4 — Mode→Model Synchronous Resolution (depends on Phase 2 + 3-C)

**Target files**:
- `src/main/utils/agent-args.ts` (add sync `resolveOmpModel` + wire into OMP arg assembly)
- `package.json` + `package-lock.json` (add `yaml` as direct dependency: `npm install yaml`)

**Problem**: `buildAgentArgs` and `applyAgentConfigOverrides` are synchronous. `AgentConfigOption.argBuilder` is also synchronous. The mode→model resolution must be **synchronous** using `fs.readFileSync`.

```typescript
import { parse as parseYaml } from 'yaml';
import fsSync from 'fs';
import path from 'path';
import os from 'os';

/**
 * Synchronously resolve the --model argument for an OMP session.
 * Precedence: manual override > mode-resolved model > no flag (OMP uses built-in default).
 */
export function resolveOmpModel(agentMode: string, modelOverride: string): string | null {
  if (modelOverride?.trim()) return modelOverride.trim();
  if (agentMode === 'default') return null;
  try {
    const configPath = path.join(os.homedir(), '.omp', 'agent', 'config.yml');
    const raw = fsSync.readFileSync(configPath, 'utf-8');
    const config = parseYaml(raw) as Record<string, unknown>;
    const modelRoles = config.modelRoles as Record<string, string> | undefined;
    return modelRoles?.[agentMode]?.trim() || null;
  } catch {
    return null;
  }
}
```

Wire into the OMP agent argument builder in `agent-args.ts`. When building args for an OMP session, call `resolveOmpModel(agentMode, modelOverride)` and if non-null, prepend `['--model', model]` to the args.

**Acceptance**:
- Mode `orchestrator`, no override → args include `--model anthropic/claude-sonnet-4-6` (from config)
- Mode `default` → no `--model` flag
- Manual override set → `--model` uses override value regardless of mode
- `config.yml` unreadable → no `--model` flag (graceful fallback)
- Role key absent from config → no `--model` flag

---

### Phase 5 — Verification (sequential)

---

#### Unit 5-A — Agent Completeness CI Test

`npm run test -- src/__tests__/main/agents/agent-completeness.test.ts`

The test enforces **19** required boolean capability fields. Phase 1 provides every prerequisite:
- 1-A: `'omp'` in `AGENT_IDS`
- 1-B: `AGENT_DEFINITIONS` entry + `AGENT_CAPABILITIES['omp']` with all 19 fields
- 1-C: `getOutputParser('omp')` → non-null; `getErrorPatterns('omp')` → non-empty
- 1-D: `getSessionStorage('omp')` → non-null

---

#### Unit 5-B — Additional Test Updates

| File | Update |
|---|---|
| `src/__tests__/main/agents/capabilities.test.ts` | Add OMP to the `knownAgents` list |
| `src/__tests__/main/agents/definitions.test.ts` | Add OMP to `knownAgents` and `toContain` checks |
| `src/__tests__/shared/agentMetadata.test.ts` | Assert `'omp'` → `'Oh My Pi'` in display names; assert `'omp'` in `BETA_AGENTS` |
| `src/__tests__/shared/agentConstants.test.ts` | Assert `'omp'` is **absent** from `DEFAULT_CONTEXT_WINDOWS` (intentional — dynamic) |
| `src/__tests__/renderer/hooks/useInlineWizard.test.ts` | Add `'omp'` to the mocked wizard-capable agent list at line 17-18 (`['claude-code', 'codex', 'opencode']` → include `'omp'`) |

**New test**: `src/__tests__/main/process-manager/omp-rpc-spawner.test.ts`

Uses a **mock OMP process** (minimal Node.js script that writes `{"type":"ready"}` and echoes stdin). Test cases:
1. Spawner emits `ready` signal after receiving `{ type: "ready" }` from mock process
2. **After `ready`, spawner automatically writes `{ type: "get_state" }` to stdin** ← required for session ID + context window
3. `sendOmpCommand` writes JSON to mock process stdin
4. Commands queued before `ready` (sent while `ready === false`) are flushed after ready fires
5. `extension_ui_request` triggers automatic `{ type: "extension_ui_response", id, cancelled: true }` on stdin
6. Calling `killOmpProcess(targetSessionId)` removes the entry from `ompProcesses` cleanly

---

#### Unit 5-C — Build and Type Check

`npm run build` or `npm run typecheck`

Verify:
- `'omp'` key present in all `Record<AgentId, ...>` usages (no missing-key errors)
- `sendStdinCommand` types align across preload, `process.ts`, and `global.d.ts`
- `OmpOutputParser` implements all 9 `AgentOutputParser` methods
- `OmpSessionStorage` implements all 5 `BaseSessionStorage` abstract methods
- `resolveOmpModel` is synchronous and returns `string | null`
- `renderer/types/index.ts` `AgentCapabilities` interface in sync with `main/agents/capabilities.ts`

---

#### Unit 5-D — Manual Smoke Test

1. `npm run dev` — Maestro starts
2. Create session → select "Oh My Pi" — `(Beta)` badge shows
3. Context bar shows correct token limit (from `get_state` → `process:usage`)
4. Send a message — response streams in real-time (delta-based)
5. Tool call → tool call card appears in UI
6. Click abort mid-response — OMP stops via stdin `{ type: "abort" }`
7. Close tab → OMP process is killed (verify via ProcessManager log)
8. Open session browser for OMP agent — past sessions listed
9. Resume a session — conversation continues correctly
10. Open wizard → select "Oh My Pi" → wizard runs ask-role prompt
11. Type `/` in OMP tab → `/plan`, `/compact`, `/mcp`, `/background` appear
12. Create OMP agent with `orchestrator` mode → spawned with `--model anthropic/claude-sonnet-4-6`
13. Create OMP agent with manual model override → override wins over mode

---

## Edge Cases

| Scenario | Handling |
|---|---|
| `omp` binary not in PATH | Agent detector marks `available: false`; UI shows "not installed" |
| OMP crashes mid-session | Process exit detected; error event emitted; UI shows restart option |
| `get_state` response delayed | Context bar hidden until first `process:usage` event arrives |
| Message sent before `ready` | Queued in `pendingCommands`; flushed after `get_state` is also sent on ready |
| `~/.omp/agent/config.yml` unreadable | `resolveOmpModel` returns `null`; OMP uses built-in default |
| Role key absent from config | Same fallback: no `--model` flag |
| `extension_ui_request` received | Spawner auto-responds `{ type: "extension_ui_response", id, cancelled: true }` |
| Large session files (> 100 MB) | `MAX_SESSION_FILE_SIZE` guard in session storage skips oversized files |
| Multiple OMP tabs | Each tab has its own spawned process in `ompProcesses` Map |
| Tab closed without `process.kill` | Prevented by explicit kill in `useTabHandlers.ts` closeTab path |
| Session path encoding assumption wrong | `resolveSessionDir` must port actual `getDefaultSessionDirName()` from OMP source |

---

## Critical Files

**Must create (new)**:
- `src/main/parsers/omp-output-parser.ts`
- `src/main/storage/omp-session-storage.ts`
- `src/main/process-manager/spawners/omp-rpc-spawner.ts`
- `src/__tests__/main/process-manager/omp-rpc-spawner.test.ts`

**Must edit (existing)**:
- `src/shared/agentIds.ts`
- `src/shared/agentMetadata.ts`
- `src/shared/agentConstants.ts`
- `src/main/agents/definitions.ts`
- `src/main/agents/capabilities.ts`
- `src/main/parsers/error-patterns.ts` — add `OMP_ERROR_PATTERNS` + `patternRegistry` entry
- `src/main/parsers/index.ts` — `registerOutputParser(new OmpOutputParser())`
- `src/main/storage/index.ts` — `registerSessionStorage(new OmpSessionStorage())`
- `src/main/process-manager/ProcessManager.ts` — `ompProcesses` map, `sendOmpCommand`, `killOmpProcess`
- `src/main/ipc/handlers/process.ts` — `maestro:process:send-stdin-command` handler
- `src/main/utils/agent-args.ts` — sync `resolveOmpModel` + mode→model wiring
- `src/main/preload/index.ts` — `sendStdinCommand` on `window.maestro.process`
- `src/renderer/global.d.ts` — `sendStdinCommand` in `MaestroAPI.process`
- `src/renderer/hooks/input/useInputProcessing.ts` — OMP live-process branch
- `src/renderer/hooks/agent/useInterruptHandler.ts` — OMP abort via `sendStdinCommand`
- `src/renderer/hooks/tabs/useTabHandlers.ts` — explicit `process.kill` on OMP tab close
- `src/renderer/slashCommands.ts` — 4 confirmed OMP commands with `agentTypes: ['omp']`
- `src/renderer/components/Wizard/screens/AgentSelectionScreen.tsx` — OMP tile + nav update
- `src/renderer/components/Wizard/services/wizardPrompts.ts` — OMP ask-role prompt
- `src/renderer/components/Wizard/services/conversationManager.ts` — thread agentId
- `src/renderer/components/QuickActionsModal.tsx` — OMP compact action
- `src/__tests__/main/agents/capabilities.test.ts`
- `src/__tests__/main/agents/definitions.test.ts`
- `src/__tests__/shared/agentMetadata.test.ts`
- `src/__tests__/shared/agentConstants.test.ts`
- `src/__tests__/renderer/hooks/useInlineWizard.test.ts`
- `package.json` + `package-lock.json` — add `yaml` direct dependency

**Must verify (sync check)**:
- `src/renderer/types/index.ts` — `AgentCapabilities` renderer copy in sync with main
- `src/renderer/hooks/agent/useAgentCapabilities.ts` — same sync check

---

## Parallel Execution Summary

```
Phase 1 (all parallel):    1-A  1-B  1-C  1-D
                              ↓    ↓    ↓    ↓
Phase 2 (sequential):      2-A → 2-B → 2-C
                                        ↓
Phase 3 (all parallel):    3-A  3-B  3-C  3-D
                              ↓    ↓    ↓    ↓
Phase 4 (single):          4 (mode→model resolution, sync)
                                   ↓
Phase 5 (sequential):      5-A → 5-B → 5-C → 5-D
```

Total implementation units: **16**
Maximum parallelizable units at once: **4** (Phase 1 and Phase 3)
Longest sequential chain: Phase 2 (3 units in series)
