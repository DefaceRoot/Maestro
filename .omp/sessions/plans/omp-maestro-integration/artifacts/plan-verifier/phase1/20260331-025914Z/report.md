# Verification Summary
- Plan path: `/home/cbee/Repos/Maestro/.omp/sessions/plans/omp-maestro-integration/plan.md`
- Phase key: `phase1`
- Run timestamp: `20260331-025914Z`
- Verdict: `BLOCKED`

## Scope
- Evaluated Phase 1 (Units 1-A through 1-D) against the live Maestro and OMP codebases.
- Checked target file existence, proposed edits, interface/contract alignment, parser/storage registration patterns, capability coverage, and stated Phase 1 file-level parallel safety.
- Explicitly excluded implementation code changes, runtime execution of an OMP integration, and later plan phases.

## Requirement Traceability

| Requirement | Planned work and acceptance | Status | Evidence |
|---|---|---|---|
| Unit 1-A must register `omp` in shared identity metadata without adding a static default context window | Add `omp` to `AGENT_IDS`, add display name `Oh My Pi`, add to `BETA_AGENTS`, and keep `DEFAULT_CONTEXT_WINDOWS` dynamic-only | COVERED | The target files exist and the proposed edits align with their current responsibilities: `src/shared/agentIds.ts:16-25`, `src/shared/agentMetadata.ts:15-45`, and `src/shared/agentConstants.ts:16-22`. The plan’s omission of a static context window is consistent with OMP RPC state carrying model context at runtime via `get_state` (`packages/coding-agent/src/modes/rpc/rpc-mode.ts:483-499`). |
| Unit 1-B must add an OMP definition and capabilities entry that satisfies the current completeness contract | Update `definitions.ts` and `capabilities.ts`; cover the 19 booleans enforced by the completeness test; keep `supportsBatchMode: false` for RPC mode | COVERED | `src/main/agents/definitions.ts` and `src/main/agents/capabilities.ts` exist. The completeness test currently enforces 19 required boolean fields at `src/__tests__/main/agents/agent-completeness.test.ts:63-82`. OMP RPC is a long-lived JSONL stdin/stdout server, not a one-shot batch invocation (`packages/coding-agent/src/modes/rpc/rpc-mode.ts:36-40,680-695`), so `supportsBatchMode: false` is consistent with the live OMP protocol. |
| Unit 1-C must add an `OmpOutputParser` that fully matches Maestro’s parser contracts and registration conventions | Implement all 9 `AgentOutputParser` methods, register the parser in `initializeOutputParsers()`, and register OMP error patterns following existing Maestro conventions | PARTIAL | The interface and registration targets exist (`src/main/parsers/agent-output-parser.ts:151-227`, `src/main/parsers/index.ts:80-84`), but the plan’s sample code diverges from live contracts in blocking ways: `matchErrorPattern` is called with reversed arguments in the plan (`plan.md:461-462`) while the live signature is `matchErrorPattern(patterns, line)` (`src/main/parsers/error-patterns.ts:903-906`); the plan’s `registerErrorPatterns('omp', { ...regexes })` sample (`plan.md:494-519`) does not match the live `ErrorPattern` object shape and production static-registry pattern (`src/main/parsers/error-patterns.ts:862-867,964-971`); and the `get_session_stats` extraction reads nonexistent top-level fields (`plan.md:444-448`) instead of OMP’s nested `tokens` object (`packages/coding-agent/src/session/agent-session.ts:309-326,5842-5906`). |
| Unit 1-D must add an `OmpSessionStorage` that matches Maestro’s storage abstractions and registration conventions | Implement the 5 required abstract methods, register in `initializeSessionStorages()`, and follow Codex storage patterns while verifying OMP path encoding | PARTIAL | The abstract method list and registration target are correct (`src/main/storage/base-session-storage.ts:50-87`, `src/main/storage/index.ts:34-38`), but the implementation sketch is not aligned with live Maestro contracts. It treats `readDirRemote`/`readFileRemote`/`statRemote` as raw values instead of `RemoteFsResult` wrappers (`plan.md:597-611,701-703` vs `src/main/utils/remote-fs.ts:209-345`), builds `AgentSessionInfo` objects with fields like `title`, `createdAt`, and `filePath` that are not part of the interface (`plan.md:607-612` vs `src/main/agents/session-storage.ts:45-82`), and returns `SessionMessagesResult` objects without the required `total` field instead of using `BaseSessionStorage.applyMessagePagination(...)` like the reference implementations (`src/main/storage/codex-session-storage.ts:947-955,1105-1109`). |
| Phase 1 units must remain file-disjoint so they can be implemented independently | No two Units 1-A through 1-D should edit the same file | COVERED | The plan’s stated file sets are disjoint: 1-A uses shared files only (`plan.md:143-148`), 1-B uses `definitions.ts` and `capabilities.ts` (`plan.md:186-191`), 1-C uses parser files only (`plan.md:280-285`), and 1-D uses storage files only (`plan.md:540-544`). |

## Assumption Audit

| Assumption | Owner | Evidence status | Failure impact and mitigation |
|---|---|---|---|
| OMP should not get a static `DEFAULT_CONTEXT_WINDOWS` entry because context window comes from live RPC state | Unit 1-A | VALIDATED | OMP `get_state` returns runtime model information in RPC mode (`packages/coding-agent/src/modes/rpc/rpc-mode.ts:483-499`), so omitting a static fallback entry is reasonable. Mitigation: keep the shared-file comment, and ensure the parser surfaces runtime context window from `get_state`. |
| OMP RPC is a persistent control protocol, so `supportsBatchMode: false` is the right capability value | Unit 1-B | VALIDATED | OMP RPC emits a startup `{ type: "ready" }`, streams events via `session.subscribe(...)`, and keeps reading JSONL commands from stdin (`packages/coding-agent/src/modes/rpc/rpc-mode.ts:36-40,424-426,680-695`). Mitigation: keep batch mode disabled and implement the later spawner/process-manager work as a persistent session. |
| Maestro error patterns can be added for OMP via `registerErrorPatterns(...)` using bare regex arrays | Unit 1-C | UNVALIDATED | Live Maestro production patterns are registered statically in `patternRegistry`, and `registerErrorPatterns(...)` is documented as test-only (`src/main/parsers/error-patterns.ts:862-867,964-971`). The helper also expects `AgentErrorPatterns` with `ErrorPattern` objects, not arrays of raw regex literals. Mitigation: define a concrete `OMP_ERROR_PATTERNS` object shaped like the existing agent pattern sets and add it to the registry map. |
| OMP `get_session_stats` exposes `inputTokens`, `outputTokens`, and `contextWindow` as top-level response fields | Unit 1-C | UNVALIDATED | Live OMP `SessionStats` exposes `tokens.input`, `tokens.output`, `tokens.cacheRead`, and `tokens.cacheWrite` under a nested `tokens` object (`packages/coding-agent/src/session/agent-session.ts:317-326,5897-5902`). Context window comes from the model/state path, not from `get_session_stats`. Mitigation: update the parser sketch to read nested token stats and derive context window from `get_state.model.contextWindow`. |
| OMP session directories can be resolved by a simple `projectPath.replace(/\//g, '-')` encoding | Unit 1-D | UNVALIDATED | OMP’s actual session directory encoding distinguishes home-relative, temp-root, and legacy absolute paths (`packages/coding-agent/src/session/session-manager.ts:402-421`). Mitigation: either port the real encoding algorithm or call a shared helper; do not finalize `getSessionPath()` with the placeholder transform. |

## Implementation Readiness
- Execution ordering/dependency readiness: Ready at the file-splitting level. Units 1-A through 1-D do not overlap on files, so the stated parallelization is credible.
- Test strategy readiness: Not ready. Phase acceptance for 1-C and 1-D only requires parser/storage registration and the completeness gate (`plan.md:534-535,740`), which would not catch the current `get_session_stats` mapping bug or broken session-browser metadata/path handling.
- Rollback/failure-path readiness: Not ready. The phase is additive, but the parser and storage sketches currently encode incorrect contracts rather than explicit failure handling guidance, so implementers do not have a truthful failure-path template to follow.
- Integration boundary readiness: Not ready. Unit 1-C currently disagrees with Maestro’s parser/error-pattern contracts, and Unit 1-D currently disagrees with Maestro’s storage and remote-fs contracts.

## Findings

### READINESS_GAP

#### F-001 — BLOCKING — Unit 1-C’s OMP error-pattern registration example does not match Maestro’s live error-pattern contract
- Category: `READINESS_GAP`
- Severity: `BLOCKING`
- Summary: The plan instructs implementers to register OMP error patterns via `registerErrorPatterns('omp', { ...raw regex arrays... })`, but live Maestro registers production patterns statically and expects `ErrorPattern` objects with `pattern`, `message`, and `recoverable` fields.
- Evidence: The plan’s example uses `registerErrorPatterns('omp', { auth_expired: [ /authentication.*failed/i, ... ] })` at `plan.md:494-519`. Live Maestro initializes production patterns in `patternRegistry` (`src/main/parsers/error-patterns.ts:862-867`), documents `registerErrorPatterns(...)` as test-only (`src/main/parsers/error-patterns.ts:964-971`), and matches `pattern.pattern` fields in `matchErrorPattern(...)` (`src/main/parsers/error-patterns.ts:903-931`).
- Impact: An implementer following the plan literally will either fail type-checking or add OMP patterns in a way that diverges from the production registration convention already used by the parser subsystem.
- Recommended fix: Replace the sample with a concrete `OMP_ERROR_PATTERNS: AgentErrorPatterns` constant that mirrors the existing agent pattern objects and add it to the `patternRegistry` initialization in `error-patterns.ts`.

#### F-002 — BLOCKING — Unit 1-C’s parser sketch mismatches live parser function signatures and OMP `get_session_stats` response shape
- Category: `READINESS_GAP`
- Severity: `BLOCKING`
- Summary: The parser sketch reverses the `matchErrorPattern(...)` argument order and reads nonexistent top-level usage fields from OMP `get_session_stats` responses.
- Evidence: The plan uses `return matchErrorPattern(line, getErrorPatterns('omp'));` at `plan.md:461-462`, but Maestro’s live signature is `matchErrorPattern(patterns, line)` (`src/main/parsers/error-patterns.ts:903-906`). The plan extracts `data.inputTokens`, `data.outputTokens`, and `data.contextWindow` at `plan.md:444-448`, while OMP `SessionStats` exposes `tokens.input`, `tokens.output`, `tokens.cacheRead`, and `tokens.cacheWrite` under `data.tokens` (`packages/coding-agent/src/session/agent-session.ts:317-326,5842-5906`).
- Impact: The planned parser implementation would either fail to compile or silently report zero/incorrect usage data, leaving Maestro’s usage and context reporting inaccurate.
- Recommended fix: Update the sketch to call `matchErrorPattern(getErrorPatterns('omp'), line)`, implement the full `detectErrorFromExit(exitCode, stderr, stdout)` signature from `AgentOutputParser`, and map `get_session_stats.data.tokens.*` while keeping context-window extraction on `get_state.model.contextWindow`.

#### F-003 — BLOCKING — Unit 1-D’s session-storage sketch does not match Maestro’s live storage and remote-fs contracts
- Category: `READINESS_GAP`
- Severity: `BLOCKING`
- Summary: The OMP storage sketch treats remote-fs helpers as raw arrays/objects and constructs return values that do not satisfy Maestro’s `AgentSessionInfo` and `SessionMessagesResult` interfaces.
- Evidence: The plan uses `const entries = await readDirRemote(sessionDir, sshConfig); for (const entry of entries.filter(...))` and `const stat = await statRemote(filePath, sshConfig);` at `plan.md:597-611`, but live helpers return `RemoteFsResult<T>` wrappers (`src/main/utils/remote-fs.ts:209-345`) and existing storages check `result.success`/`result.data` before use (`src/main/storage/codex-session-storage.ts:541-571,606-614,903-909`). The plan populates `AgentSessionInfo` with `title`, `createdAt`, and `filePath` at `plan.md:607-612`, but the live interface requires `timestamp`, `modifiedAt`, `firstMessage`, `messageCount`, `sizeBytes`, token counts, and duration fields (`src/main/agents/session-storage.ts:45-82`). The plan also returns `{ messages, hasMore: false }` from `readSessionMessages`, but the live result shape includes `total`, and reference implementations use `BaseSessionStorage.applyMessagePagination(...)` (`src/main/storage/codex-session-storage.ts:947-955,1105-1109`).
- Impact: An implementer following the plan cannot land a compiling, contract-correct session storage implementation, and SSH-backed session browsing would be especially error-prone.
- Recommended fix: Rewrite the sketch against the live `AgentSessionInfo`, `SessionMessagesResult`, and `RemoteFsResult` contracts, using `CodexSessionStorage` or `ClaudeSessionStorage` as the structural template rather than the current pseudocode.

### ASSUMPTION_RISK

#### F-004 — NON_BLOCKING — Unit 1-D correctly flags path-encoding verification as necessary, but the placeholder encoding is materially different from OMP’s live algorithm
- Category: `ASSUMPTION_RISK`
- Severity: `NON_BLOCKING`
- Summary: The plan already warns that OMP path encoding must be verified, and that warning is justified because the placeholder implementation only covers the simplest slash-to-dash case.
- Evidence: The placeholder helper uses `projectPath.replace(/\//g, '-').replace(/^-/, '')` at `plan.md:692-696`. Live OMP session directories use separate home-relative, temp-root, and legacy-absolute encodings in `getDefaultSessionDirName(...)` (`packages/coding-agent/src/session/session-manager.ts:402-421`).
- Impact: If an implementer copies the placeholder without replacing it, `listSessions()`/`getSessionPath()` will miss sessions for many valid project roots, especially symlinked home paths and temp-root projects.
- Recommended fix: Keep the phase intent, but replace the placeholder helper in the plan with the real encoding rules or a pointer to the exact OMP helper to mirror.

### TESTABILITY_GAP

#### F-005 — NON_BLOCKING — Phase 1 acceptance checks are too narrow to catch the current 1-C and 1-D contract bugs
- Category: `TESTABILITY_GAP`
- Severity: `NON_BLOCKING`
- Summary: The phase’s acceptance criteria rely on parser/storage registration and the completeness test, but they do not exercise usage extraction or session-browser behavior.
- Evidence: Unit 1-C acceptance stops at `getErrorPatterns('omp')` being non-empty and the completeness gate passing (`plan.md:534-535`). Unit 1-D acceptance stops at `getSessionStorage('omp')` returning an instance and the same completeness gate passing (`plan.md:740`). The completeness test only checks parser/storage presence, not parser usage mapping or session storage list/read/path correctness (`src/__tests__/main/agents/agent-completeness.test.ts:93-116`).
- Impact: Phase 1 could appear complete while OMP usage stats remain wrong and the session browser fails to locate or parse OMP sessions.
- Recommended fix: Add targeted tests for `OmpOutputParser.extractUsage()` on `get_state` and `get_session_stats`, plus `OmpSessionStorage.listSessions()`, `readSessionMessages()`, and `getSessionPath()` using representative local and SSH-aware fixtures.

## Decision
- Final verdict: `BLOCKED`
- Rationale: Units 1-A and 1-B are actionable as written, and the Phase 1 file split is clean. However, Unit 1-C’s parser/error-pattern examples and Unit 1-D’s storage sketch currently disagree with live Maestro and OMP contracts in ways that would mislead implementation.
- Minimum next actions:
  1. Replace Unit 1-C’s error-pattern guidance with a contract-correct `AgentErrorPatterns` example and static registry insertion.
  2. Correct Unit 1-C’s parser sample to use the live `matchErrorPattern(...)` signature and OMP’s nested `get_session_stats.data.tokens` shape.
  3. Rewrite Unit 1-D’s storage pseudocode against `RemoteFsResult`, `AgentSessionInfo`, and `SessionMessagesResult`, using a real Maestro storage implementation as the template.
  4. Preserve the path-encoding verification note, but replace the placeholder encoding helper with OMP’s actual rules.
  5. Add targeted tests so Phase 1 acceptance covers parser usage extraction and session-browser behavior, not just registry presence.