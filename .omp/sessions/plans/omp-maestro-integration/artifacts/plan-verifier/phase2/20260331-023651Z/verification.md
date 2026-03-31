# Verification Summary

- Plan path: `/home/cbee/Repos/Maestro/.omp/sessions/plans/omp-maestro-integration/plan.md`
- Phase key: `phase2`
- Run timestamp: `20260331-023651Z`
- Verdict: `BLOCKED`

## Scope

Evaluated the Phase 2 plan section for OMP RPC process-manager work (Units 2-A through 2-C) against the current Maestro and OMP codebases.

Included:
- `src/main/process-manager/ProcessManager.ts`
- `src/main/process-manager/spawners/`
- `src/main/ipc/handlers/process.ts`
- `src/main/preload/index.ts`
- `src/main/preload/process.ts`
- `src/renderer/global.d.ts`
- `src/renderer/hooks/input/useInputProcessing.ts`
- `src/renderer/hooks/agent/useAgentListeners.ts`
- `src/renderer/hooks/agent/useInterruptHandler.ts`
- `src/renderer/hooks/tabs/useTabHandlers.ts`
- `/home/cbee/Repos/oh-my-pi/packages/coding-agent/src/modes/rpc/rpc-types.ts`
- `/home/cbee/Repos/oh-my-pi/packages/coding-agent/src/modes/rpc/rpc-mode.ts`

Explicitly excluded:
- Implementation changes
- Runtime execution of Maestro or OMP
- Post-implementation behavior verification

## Requirement Traceability

| Requirement | Planned work and acceptance | Status | Evidence |
|---|---|---|---|
| Add OMP-specific persistent process support without breaking existing agent paths | Unit 2-A adds a new spawner plus `ProcessManager` tracking and send API; acceptance is receiving `ready`, sending `get_state`, and logging session metadata | COVERED | `ProcessManager` currently dispatches only between `PtySpawner` and `ChildProcessSpawner` (`src/main/process-manager/ProcessManager.ts:32-57`), and the spawner directory is already organized as per-strategy modules (`src/main/process-manager/spawners/index.ts:1-2`). A new OMP-specific spawner is additive if gated on tool type. |
| Handle OMP readiness correctly and avoid the pre-ready race | Unit 2-A uses `{ type: "ready" }`, sends `get_state` after ready, and queues commands in `pendingCommands` before ready | COVERED | OMP RPC mode writes `{ type: "ready" }` immediately on startup (`oh-my-pi .../rpc-mode.ts:36-38`) and supports `get_state` (`rpc-types.ts:27`) plus `abort`/`compact` (`rpc-types.ts:22,44`). Queueing before ready is therefore the correct race-control approach. |
| Add renderer-to-main stdin command routing in a way that matches Maestro's existing preload and type patterns | Unit 2-B targets `process.ts`, `preload/index.ts`, and `global.d.ts`; acceptance expects `window.maestro.sendAgentStdinCommand(...)` | MISSING | The current preload surface exposes process operations under `window.maestro.process`, not as top-level methods (`src/main/preload/index.ts:56-67`, `src/main/preload/process.ts:135-158`, `src/renderer/global.d.ts:257-262`). The planned API shape and file targets do not match the existing contract. |
| Route user prompts from OMP tabs through the persistent RPC process instead of spawning a new process | Unit 2-C targets `useInputProcessing.ts` and calls `window.maestro.sendAgentStdinCommand(...)` | PARTIAL | `useInputProcessing.ts` is the correct functional area for message dispatch, but the planned call site uses the wrong API shape (`plan.md:742-748`) and therefore is not directly actionable against the current preload contract. |
| Update renderer state from OMP ready/init events | Unit 2-C expects `useAgentListeners.ts` to handle `init` and `system` ParsedEvents, including context-window updates | MISSING | `ParsedEvent` does not expose a top-level `contextWindow`; that field only exists inside `usage` (`src/main/parsers/agent-output-parser.ts:49-91`). `StdoutHandler` emits `usage`, `session-id`, `thinking-chunk`, `tool-execution`, and final result data, but does not forward generic `init` or `system` events to the renderer (`src/main/process-manager/handlers/StdoutHandler.ts:297-309, 336, 397-401, 462-487`). |
| Preserve correct abort and cleanup semantics for a per-tab persistent OMP process | Unit 2-A says tab close should kill the OMP process for that tab; Unit 2-C says the abort button should send `{ type: 'abort' }` | MISSING | Existing tab close flow only mutates renderer state via `performTabClose -> closeTab` (`src/renderer/hooks/tabs/useTabHandlers.ts:629-666`, `src/renderer/utils/tabHelpers.ts:394-493`) and does not terminate any process. Existing interrupt flow always targets `window.maestro.process.interrupt(targetSessionId)` with fallback kill (`src/renderer/hooks/agent/useInterruptHandler.ts:63-77, 229-231`). The current phase plan does not map these behaviors to the actual implementation points that must change. |

## Assumption Audit

| Assumption | Owner | Evidence status | Failure impact | Mitigation |
|---|---|---|---|---|
| OMP emits `{ type: "ready" }` before any command should be sent | Unit 2-A spawner work | VALIDATED | If false, the entire ready gate would deadlock or race incorrectly | Keep an explicit ready timeout and fail fast if the signal never arrives |
| A pre-ready command queue is sufficient to handle user input that arrives early | Unit 2-A spawner work | VALIDATED | Without it, early user input can be dropped or written before OMP accepts commands | Queue `RpcCommand` objects until ready, then flush in order |
| A new stdin command should be exposed as `window.maestro.sendAgentStdinCommand(...)` | Unit 2-B preload/API work | UNVALIDATED | Implementers following the plan will land the wrong API surface and break type declarations and call sites | Move the method into the existing `window.maestro.process` namespace and update the plan examples and acceptance text |
| `useAgentListeners.ts` can observe `init` and `system` ParsedEvents directly | Unit 2-C renderer event handling | UNVALIDATED | Ready gating and context-window/session updates will never fire as written | Either add explicit main-to-renderer IPC events for OMP state transitions or retarget the renderer to existing `onSessionId` and `onUsage` channels |
| Ignoring `extension_ui_request` is safe for the initial cut | Phase-wide OMP RPC integration | UNVALIDATED | Extension-driven turns can stall if OMP waits on a response that Maestro never sends | Either scope the phase to non-extension flows or add a minimal response policy for request types that block progress |

## Implementation Readiness

- Execution ordering/dependency readiness: Not ready. The spawner addition itself is well-scoped, but the planned IPC/preload API surface and renderer event model do not match the current codebase.
- Test strategy readiness: Not ready. The phase includes happy-path acceptance checks, but it does not define verification for tab-close cleanup, abort override behavior, or the renderer-visible ready/init path.
- Rollback/failure-path readiness: Not ready. The plan names crash-before-ready and missing binary cases, but it does not cover leaked per-tab persistent processes or the no-response extension UI case.
- Integration boundary readiness: Not ready. The current process API is namespaced, and the current parsed-event pipeline does not expose the events the plan expects the renderer to consume.

## Findings

### TRACEABILITY_GAP

#### F-001 — BLOCKING — Planned renderer API does not match Maestro's existing preload contract
- Category: `TRACEABILITY_GAP`
- Severity: `BLOCKING`
- Summary: Unit 2-B and Unit 2-C instruct implementers to add and call `window.maestro.sendAgentStdinCommand(...)`, but Maestro's existing contract exposes process operations under `window.maestro.process.*`.
- Evidence: The plan targets `src/main/preload/index.ts` and `src/renderer/global.d.ts` and uses `window.maestro.sendAgentStdinCommand(...)` (`plan.md:706-730, 742-748, 766, 773`). The current preload wiring exposes `process: createProcessApi()` in `contextBridge.exposeInMainWorld('maestro', ...)` (`src/main/preload/index.ts:56-67`), `createProcessApi()` owns methods like `spawn`, `interrupt`, and `kill` (`src/main/preload/process.ts:135-158`), and `global.d.ts` declares those methods inside `MaestroAPI.process` (`src/renderer/global.d.ts:257-262`).
- Impact: Implementers following the plan will modify the wrong files and land a renderer/main-process API that is inconsistent with the existing contract and typings.
- Recommended fix: Revise Unit 2-B and Unit 2-C so the new method is added to `src/main/preload/process.ts`, exposed as `window.maestro.process.sendAgentStdinCommand(...)`, and declared in the `process` section of `src/renderer/global.d.ts`. Update the acceptance examples accordingly.

### DEPENDENCY_CONFLICT

#### F-002 — BLOCKING — Planned ready/init handling depends on an event pipeline that does not exist
- Category: `DEPENDENCY_CONFLICT`
- Severity: `BLOCKING`
- Summary: Unit 2-C expects the renderer to react to `init` and `system` ParsedEvents, but Maestro's current main-process pipeline does not forward generic parsed events to the renderer.
- Evidence: The plan says `useAgentListeners.ts` should handle `init` ParsedEvents and `system` text `'OMP ready'` (`plan.md:758-760`). The normalized `ParsedEvent` type only carries `contextWindow` inside `usage`, not as a top-level `init` property (`src/main/parsers/agent-output-parser.ts:49-91`). `StdoutHandler` extracts and emits `usage`, `session-id`, `thinking-chunk`, `tool-execution`, and final result data (`src/main/process-manager/handlers/StdoutHandler.ts:297-309, 336, 397-401, 462-487`), but there is no renderer event for generic `init` or `system` parser output.
- Impact: The plan cannot deliver the stated ready gate or context-window/session updates as written; an implementation that follows it literally will either not compile or will never update the renderer.
- Recommended fix: Choose one design and update the phase plan consistently: either (a) add explicit main-to-renderer IPC events for OMP ready/init state, or (b) retarget the renderer to already-supported channels such as `process:session-id` and `process:usage`, with any missing ready-state signal added explicitly.

### READINESS_GAP

#### F-003 — BLOCKING — Per-tab abort and cleanup paths are not mapped to the actual control points
- Category: `READINESS_GAP`
- Severity: `BLOCKING`
- Summary: The phase says OMP uses per-tab persistent processes, but the current plan does not target the renderer control points that own tab close and abort behavior.
- Evidence: Unit 2-A says tab close should kill the OMP process for that tab (`plan.md:676-678`). Unit 2-C says the abort button should send `{ type: 'abort' }` (`plan.md:762-767`). In the current code, tab close only calls `performTabClose -> closeTab` and updates session state (`src/renderer/hooks/tabs/useTabHandlers.ts:629-666`, `src/renderer/utils/tabHelpers.ts:394-493`). The actual interrupt button path lives in `useInterruptHandler.ts`, which always calls `window.maestro.process.interrupt(targetSessionId)` and falls back to `kill(targetSessionId)` (`src/renderer/hooks/agent/useInterruptHandler.ts:63-77, 229-231`).
- Impact: Without additional planned work, OMP tabs can leak persistent processes on close, and the existing abort button will still send SIGINT/kill semantics rather than the OMP RPC abort command.
- Recommended fix: Expand Phase 2 to explicitly cover the real integration points: add per-tab process teardown to the tab-close/session-close flow, update `useInterruptHandler.ts` (and any mirrored remote interrupt path) to branch OMP tabs to `sendAgentStdinCommand({ type: 'abort' })`, and define how those branches identify the correct per-tab OMP process.

### ASSUMPTION_RISK

#### F-004 — NON_BLOCKING — Silently ignoring `extension_ui_request` can stall extension-driven turns
- Category: `ASSUMPTION_RISK`
- Severity: `NON_BLOCKING`
- Summary: The plan treats `extension_ui_request` as ignorable in the initial cut, but some OMP extension UI requests are tied to pending promises that expect a response.
- Evidence: The plan says Phase 2 initially ignores `extension_ui_request` (`plan.md:974`). In OMP RPC mode, dialog-style extension UI requests are stored in `pendingRequests` and emitted as `extension_ui_request`; the request remains pending until the client responds or an explicit timeout/abort path resolves it (`oh-my-pi .../rpc-mode.ts:78-118, 267-286`).
- Impact: Core prompt/response flows can still work, but extension-triggered interactions may appear hung if Maestro never answers the request.
- Recommended fix: Either narrow Phase 2 acceptance to non-extension scenarios, or add a minimal response policy for blocking request types so the host fails closed instead of waiting indefinitely.

## Decision

Final verdict: `BLOCKED`

Rationale:
- The ready-handshake and pre-ready queue concepts are sound against OMP's real RPC protocol.
- The new OMP-specific spawner approach is additive and fits Maestro's existing spawner architecture.
- The phase is not implementation-ready because three core plan elements are currently misaligned with the codebase: the renderer API surface, the event pipeline expected by `useAgentListeners.ts`, and the actual abort/tab-close control points.

Minimum next actions:
1. Rewrite Unit 2-B and Unit 2-C to use the existing `window.maestro.process` namespace and the correct preload/type files.
2. Decide whether OMP ready/init state is delivered through new IPC events or through the existing `session-id`/`usage` channels, and update the parser/renderer plan accordingly.
3. Add explicit plan steps for per-tab cleanup and for branching the existing interrupt flow to OMP RPC abort semantics.
4. Either scope out extension UI for this phase or define a minimal response behavior so ignored requests do not stall turns.
