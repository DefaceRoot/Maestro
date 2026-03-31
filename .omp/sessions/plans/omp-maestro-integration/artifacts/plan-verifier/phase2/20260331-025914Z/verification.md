# Verification Summary

- Plan path: `/home/cbee/Repos/Maestro/.omp/sessions/plans/omp-maestro-integration/plan.md`
- Phase key: `phase2`
- Run timestamp: `20260331-025914Z`
- Verdict: `BLOCKED`

Phase 2 is not implementation-ready as written. Units 2-A and most of 2-B line up with the current Maestro/OMP structure, but Unit 2-C is blocked by incorrect assumptions about how Maestro routes live agent input, where interrupt/compaction controls live, and which IPC event surfaces the renderer can currently observe.

Note: the delegation envelope did not include non-empty `constraints` or `acceptance_criteria`; this verification used the task description plus repository evidence directly.

## Scope

What was evaluated:
- Phase 2 Units 2-A through 2-C in the integration plan
- Maestro process-manager, spawner, IPC, preload, renderer listener, input-routing, interrupt, compaction, and tab-close surfaces
- OMP RPC protocol details needed to validate `ready`, `get_state`, `abort`, `compact`, and `extension_ui_request` behavior

Explicitly excluded scope:
- Implementation changes
- Runtime execution of Maestro or OMP
- Post-implementation behavior verification
- Phases outside Phase 2 except where required to validate dependency ordering

## Requirement Traceability

| Requirement | Planned work and acceptance | Status | Evidence |
|---|---|---|---|
| Add OMP-specific persistent process support without breaking existing agent paths | Unit 2-A adds a dedicated OMP process map and `sendOmpCommand` without replacing existing `processes` handling | COVERED | `ProcessManager` currently keeps a single `processes` map and routes spawns through `PtySpawner` vs `ChildProcessSpawner` (`src/main/process-manager/ProcessManager.ts:32-58`). Adding an OMP-specific side map/method is additive if dispatch stays agent-specific. |
| Put the new OMP spawner under the existing spawner extension point | Unit 2-A adds `src/main/process-manager/spawners/omp-rpc-spawner.ts` | COVERED | `src/main/process-manager/spawners/` already contains per-spawner modules (`PtySpawner.ts`, `ChildProcessSpawner.ts`) plus an index barrel (`src/main/process-manager/spawners/index.ts:1-2`). |
| Auto-cancel OMP extension UI requests correctly | Unit 2-A says respond on stdin with `{ type: 'extension_ui_response', id, cancelled: true }` | COVERED | The plan matches OMP RPC types exactly: requests are `extension_ui_request` and responses may be `{ type: 'extension_ui_response', id, cancelled: true }` (`/home/cbee/Repos/oh-my-pi/packages/coding-agent/src/modes/rpc/rpc-types.ts:187-231`). RPC mode emits extension UI requests and expects host responses on stdin (`rpc-mode.ts:118-119, 281-283`). |
| Add the new stdin-command IPC handler in the standard process handler module | Unit 2-B adds a new `ipcMain.handle(...)` to `src/main/ipc/handlers/process.ts` | COVERED | `registerProcessHandlers()` already registers `ipcMain.handle(...)` entries for spawn, write, interrupt, kill, resize, and runCommand in this file (`src/main/ipc/handlers/process.ts:81-85, 575-645`). |
| Keep the renderer API under `window.maestro.process`, not top-level `window.maestro` | Unit 2-B exposes `sendStdinCommand` on the existing process namespace | COVERED | `contextBridge.exposeInMainWorld('maestro', { process: createProcessApi(), ... })` exposes process methods beneath `window.maestro.process` (`src/main/preload/index.ts:66-67`). |
| Add the renderer declaration beneath the existing `process` namespace | Unit 2-B adds `sendStdinCommand` to `global.d.ts` under `process` | COVERED | `MaestroAPI.process` already declares process methods and listener subscriptions (`src/renderer/global.d.ts:257-326`). |
| Route OMP prompts from the correct input path | Unit 2-C proposes a branch in `useInputProcessing.ts` to send OMP prompt commands | PARTIAL | `useInputProcessing` is the correct file, but the plan’s premise is wrong: Maestro does not spawn on every AI message. It spawns only for batch-mode agents (`src/renderer/hooks/input/useInputProcessing.ts:852-855, 985-995`) and otherwise reuses a live process via `window.maestro.process.write(...)` (`useInputProcessing.ts:1107-1109`). OMP resembles the existing live-process path more than the batch spawn path. |
| Use the existing renderer listener hub for agent IPC events | Unit 2-C targets `useAgentListeners.ts` for listener setup | COVERED | `useAgentListeners` is explicitly the listener hub for `window.maestro.process.onXxx` subscriptions (`src/renderer/hooks/agent/useAgentListeners.ts:167-169`). |
| Ready, abort, compact, and tab-close control wiring must follow existing renderer control surfaces | Unit 2-C places ready handling in `useAgentListeners` and abort/compact/tab-close guidance around that flow | MISSING | Abort is centralized in `useInterruptHandler.ts`, not `useAgentListeners` (`src/renderer/hooks/agent/useInterruptHandler.ts:58-77`). Existing compaction UI is the summarize workflow exposed via `useSummarizeAndContinue`, `ContextWarningSash`, and quick actions (`src/renderer/hooks/agent/useSummarizeAndContinue.ts:338-448`, `src/renderer/components/InputArea.tsx:1121-1128`, `src/renderer/components/QuickActionsModal.tsx:724-730`). AI tab close paths mutate session state via `closeTab(...)` without calling `window.maestro.process.kill(...)` (`src/renderer/hooks/tabs/useTabHandlers.ts:629-666`, `src/renderer/hooks/remote/useRemoteIntegration.ts:313-321`). |
| Keep sequencing 2-A → 2-B → 2-C sound | 2-B must call `sendOmpCommand`; 2-C must call renderer API exposed by 2-B | COVERED | The dependency chain is coherent: Unit 2-B’s handler calls `sendOmpCommand` (`plan.md:808-825`), and Unit 2-C depends on `window.maestro.process.sendStdinCommand(...)` from 2-B (`plan.md:834-846`). |

## Assumption Audit

| Assumption | Owner | Evidence status | Failure impact and mitigation |
|---|---|---|---|
| A dedicated OMP side-map in `ProcessManager` can be added without breaking existing agent flows | Plan author | VALIDATED | Current `ProcessManager` API is additive-friendly because batch/PTy routing already hinges on dispatch logic (`src/main/process-manager/ProcessManager.ts:32-58`). Mitigation: keep existing `processes` semantics unchanged and gate OMP behavior by tool type. |
| `spawners/` is the correct home for a new OMP-specific spawner | Plan author | VALIDATED | Existing spawner organization is already one file per spawning strategy. Mitigation: add `omp-rpc-spawner.ts` alongside current spawners and export it from the barrel if needed. |
| OMP extension UI requests can be safely auto-cancelled with `{ type: 'extension_ui_response', id, cancelled: true }` | Plan author | VALIDATED | This matches the OMP RPC contract. Mitigation: send exactly that response on stdin whenever Maestro cannot render the requested UI. |
| `useInputProcessing` currently spawns every AI message, so OMP routing should branch only around spawn logic | Plan author | UNVALIDATED | Implementers may patch the wrong code path and miss the existing live-process flow. Mitigation: rewrite Unit 2-C around the current batch-vs-live split in `useInputProcessing.ts`. |
| `useAgentListeners` can observe raw OMP `init` / `system` events without new main/preload IPC channels | Plan author | UNVALIDATED | The renderer currently receives typed channels such as `onSessionId` and `onUsage`, not generic parsed events. Mitigation: either map OMP state into existing channels or plan a new explicit IPC event. |
| Existing tab close behavior already routes through `window.maestro.process.kill`, so no renderer change is needed | Plan author | UNVALIDATED | A persistent OMP process can leak after tab close. Mitigation: add explicit kill orchestration to tab-close flows or revise the plan to name that work. |
| Existing compaction UX is equivalent to sending OMP `{ type: 'compact' }` | Plan author | UNVALIDATED | Today Maestro’s compaction action creates a summarized continuation tab rather than sending an agent command. Mitigation: decide whether OMP should replace that UX, sit behind it, or remain a separate action, then update affected files and acceptance criteria. |

## Implementation Readiness

- Execution ordering/dependency readiness: `READY` for the 2-A → 2-B → 2-C sequence itself, but Phase 2 is still blocked because Unit 2-C depends on renderer surfaces that are misidentified in the plan.
- Test strategy readiness: `NOT READY`. The plan does not yet name the renderer control-path tests needed for live-process routing, interrupt behavior, compaction entry points, and tab-close cleanup.
- Rollback/failure-path readiness: `NOT READY`. Ready-state delivery and tab-close cleanup are underspecified for a persistent process, so failure behavior is not yet trustworthy.
- Integration boundary readiness: `NOT READY`. The current preload/renderer boundary exposes typed process events only; the plan assumes raw ready/system-style event access that does not exist.

## Findings

### READINESS_GAP

#### F-001 — BLOCKING — Unit 2-C is anchored to the wrong `useInputProcessing` control path
- Category: `READINESS_GAP`
- Severity: `BLOCKING`
- Summary: The plan says `useInputProcessing` currently calls `window.maestro.process.spawn(...)` for every message, but Maestro already splits AI message routing between batch-mode spawn and live-process stdin writes.
- Evidence: The plan states the spawn-for-every-message premise and proposes the OMP branch before the spawn path (`plan.md:840-848`). In the current code, batch-mode agents use spawn (`src/renderer/hooks/input/useInputProcessing.ts:852-855, 985-995`) while existing live processes use `window.maestro.process.write(...)` (`useInputProcessing.ts:1107-1109`).
- Impact: An implementation that follows the plan literally can patch the wrong branch and fail to align OMP with Maestro’s existing live-process input model.
- Recommended fix: Rewrite Unit 2-C so OMP routing is planned relative to the existing live-process branch in `useInputProcessing.ts`, with explicit handling for first-prompt vs subsequent-command behavior.

### DEPENDENCY_CONFLICT

#### F-002 — BLOCKING — Abort and compaction work is planned against the wrong renderer surfaces
- Category: `DEPENDENCY_CONFLICT`
- Severity: `BLOCKING`
- Summary: The plan places OMP abort/compact work in Unit 2-C alongside listener logic, but Maestro’s current interrupt and compaction entry points live elsewhere.
- Evidence: The plan’s abort and compact guidance is in Unit 2-C (`plan.md:858-869`). Current interrupt handling is centralized in `src/renderer/hooks/agent/useInterruptHandler.ts:58-77`, which calls `window.maestro.process.interrupt(...)`. Current context compaction is the summarize workflow exposed through `useSummarizeAndContinue` (`src/renderer/hooks/agent/useSummarizeAndContinue.ts:338-448`), the context warning sash (`src/renderer/components/InputArea.tsx:1121-1128`), and quick actions (`src/renderer/components/QuickActionsModal.tsx:724-730`).
- Impact: Implementers will touch secondary files while leaving the real interrupt and compaction entry points unchanged, producing inconsistent controls and incomplete behavior.
- Recommended fix: Move abort planning into `useInterruptHandler.ts`, then explicitly decide whether OMP `compact` replaces or augments the current summarize workflow and update the relevant UI files in the plan.

#### F-003 — BLOCKING — The renderer does not currently receive raw `init` / `system` events for OMP ready handling
- Category: `DEPENDENCY_CONFLICT`
- Severity: `BLOCKING`
- Summary: Unit 2-C assumes `useAgentListeners` can react to raw OMP ready/state events, but the current preload and renderer contracts expose only typed process subscriptions.
- Evidence: The plan expects `useAgentListeners` to react to `init` and `system` events (`plan.md:854-856`). The current process preload/global contracts expose listeners such as `onData`, `onExit`, `onSessionId`, `onThinkingChunk`, `onToolExecution`, `onSshRemote`, `onUsage`, and `onAgentError`—but no generic parsed-event or system-event subscription (`src/main/preload/process.ts:184-250, 440-450`; `src/renderer/global.d.ts:284-326`). `StdoutHandler` likewise emits specific derived events such as `usage`, `session-id`, `slash-commands`, `thinking-chunk`, and `tool-execution`, not a raw `system` channel (`src/main/process-manager/handlers/StdoutHandler.ts:266-316, 321-392`).
- Impact: The OMP ready-state behavior in the plan is not directly implementable; the renderer will never see the expected event shape without extra main/preload work.
- Recommended fix: Revise the plan to either map OMP ready/state information onto existing `session-id` / `usage` channels or add a new explicit IPC event and include its preload/global typings in Unit 2-B.

### ASSUMPTION_RISK

#### F-004 — BLOCKING — Tab-close cleanup is not already wired through `process.kill`
- Category: `ASSUMPTION_RISK`
- Severity: `BLOCKING`
- Summary: The plan says no renderer tab-close change is needed because existing tab close already routes through `window.maestro.process.kill`, but the current AI tab-close paths only update session state.
- Evidence: The plan states “Tab close — handled in `ProcessManager.ts` ... via existing `window.maestro.process.kill` path. No renderer change needed” (`plan.md:872`). Current desktop tab close uses `closeTab(...)` in `src/renderer/hooks/tabs/useTabHandlers.ts:629-666`, and remote tab close also only calls `closeTab(...)` in `src/renderer/hooks/remote/useRemoteIntegration.ts:313-321`. Neither path calls `window.maestro.process.kill(...)`.
- Impact: A persistent OMP RPC process can survive after its tab is closed, causing leaked processes and broken tab-to-process ownership.
- Recommended fix: Add explicit renderer or store-level tab-close cleanup to call `window.maestro.process.kill(...)` for the tab-scoped OMP process, and reflect that work in Unit 2-A/2-C.

## Decision

Final verdict: `BLOCKED`

Concise rationale:
- Unit 2-A is directionally correct and consistent with the OMP RPC protocol.
- Unit 2-B mostly fits Maestro’s IPC/preload/type structure.
- Unit 2-C is not actionable as written because it relies on the wrong input-routing premise, targets the wrong renderer control surfaces for abort/compaction, assumes a raw ready/system IPC path that does not exist, and assumes tab-close cleanup already happens when it currently does not.

Minimum next actions:
1. Rewrite Unit 2-C around Maestro’s actual batch-vs-live routing in `useInputProcessing.ts`.
2. Move abort planning to `useInterruptHandler.ts` and explicitly decide how OMP `compact` should relate to the existing summarize workflow.
3. Add or reuse a concrete renderer-visible IPC signal for OMP ready/state handling instead of assuming generic `init` / `system` events.
4. Add explicit tab-close cleanup planning for persistent OMP processes.