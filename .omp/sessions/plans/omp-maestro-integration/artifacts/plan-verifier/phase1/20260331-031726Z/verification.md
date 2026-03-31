# Verification Summary
- Plan path: `/home/cbee/Repos/Maestro/.omp/sessions/plans/omp-maestro-integration/plan.md`
- Phase key: `phase1`
- Run timestamp: `20260331-031726Z`
- Verdict: `BLOCKED`

## Scope
- Evaluated Phase 1 (Units 1-A through 1-D) of the OMP integration plan against the live Maestro and OMP source trees.
- Re-checked the previously blocked contract issues called out for Round 3: error-pattern shape/registration, `matchErrorPattern(...)` argument order, nested `get_session_stats` token fields, session-storage contract alignment, parser/storage registration, and `resolveSessionDir()` path encoding guidance.
- Re-confirmed Unit 1-A, Unit 1-B, and the stated Phase 1 parallel file split.
- Explicitly excluded implementation code, runtime behavior, and later plan phases.

## Requirement Traceability

| Requirement | Planned work and acceptance | Status | Evidence |
|---|---|---|---|
| Unit 1-A must still register OMP only in shared identity metadata and keep context-window handling dynamic | Plan adds `omp` in `agentIds.ts` / `agentMetadata.ts` and keeps `DEFAULT_CONTEXT_WINDOWS` as comment-only guidance | COVERED | Unit 1-A still confines itself to `src/shared/agentIds.ts`, `src/shared/agentMetadata.ts`, and `src/shared/agentConstants.ts` (`plan.md:155-160`). The plan still omits a static OMP context-window entry and explains runtime reporting via RPC (`plan.md:173-178`), which matches the current shared constants split in `src/shared/agentIds.ts:14-23`, `src/shared/agentMetadata.ts:13-41`, and `src/shared/agentConstants.ts:13-20`. |
| Unit 1-B must still fit Maestro’s agent-definition and capability surfaces | Plan adds one `AGENT_DEFINITIONS` entry and one capability record for OMP | COVERED | Unit 1-B still touches only `definitions.ts` and `capabilities.ts` (`plan.md:196-198`). The proposed definition fields align with the live `AgentDefinition` shape in `src/main/agents/definitions.ts:59-90`, and the capability keys remain consistent with `AgentCapabilities` in `src/main/agents/capabilities.ts:14-79`. |
| Unit 1-C error patterns must use `AgentErrorPatterns` with `ErrorPattern[]` objects and static registry insertion | Plan should define `OMP_ERROR_PATTERNS` and add it to `patternRegistry`, not use `registerErrorPatterns(...)` for production setup | COVERED | The plan now states production OMP patterns belong in the static `patternRegistry` map and not `registerErrorPatterns(...)` (`plan.md:105-107`). The Unit 1-C sample defines `const OMP_ERROR_PATTERNS: AgentErrorPatterns = { ... }` with `{ pattern, message, recoverable }` objects (`plan.md:472-499`) and instructs adding `['omp', OMP_ERROR_PATTERNS]` to the registry (`plan.md:499-502`). That matches the live Maestro contracts in `src/main/parsers/error-patterns.ts:26-43,862-972`. |
| Unit 1-C must call `matchErrorPattern(getErrorPatterns('omp'), line)` | Parser sketch should use patterns-first argument order | COVERED | The parser sketch now calls `matchErrorPattern(getErrorPatterns('omp'), line)` in `detectErrorFromLine(...)` (`plan.md:441-443`). This matches the live function signature `matchErrorPattern(patterns, line)` in `src/main/parsers/error-patterns.ts:903-906`. |
| Unit 1-C must read nested OMP token counters from `get_session_stats.data.tokens.*` | Parser sketch should map nested `input`, `output`, `cacheRead`, and `cacheWrite` fields | COVERED | The plan now documents nested token fields (`plan.md:115,307,406`) and the parser sketch reads `tokens.input`, `tokens.output`, `tokens.cacheRead`, and `tokens.cacheWrite` into Maestro usage fields (`plan.md:419-429`). That matches OMP’s live `SessionStats.tokens` structure in `packages/coding-agent/src/session/agent-session.ts:309-326,5897-5905`. |
| Unit 1-D must use the five correct abstract methods, correct `AgentSessionInfo` fields, `SessionMessagesResult`, and `RemoteFsResult` success checks | Storage sketch should follow `BaseSessionStorage`/`AgentSessionInfo`/`SessionMessagesResult` contracts and the Codex storage reference | PARTIAL | The plan now names the correct five abstract methods (`plan.md:565-665`), uses the required `AgentSessionInfo` field names (`plan.md:109-113,573-601`), and returns `BaseSessionStorage.applyMessagePagination(messages, options)` from `readSessionMessages(...)` (`plan.md:613-633`). Those names match the live contracts in `src/main/storage/base-session-storage.ts:50-85,232-235` and `src/main/agents/session-storage.ts:45-80`. The sketch also checks `result.success` before `result.data` (`plan.md:570-585,622-623`). However, it still calls SSH-only remote-fs helpers through an optional `sshConfig` without a local branch and uses an unsupported third argument to `readFileRemote(...)` (`plan.md:570,578,584,622`), while the live helper signatures require `SshRemoteConfig` and accept no `{ maxBytes }` options object (`src/main/utils/remote-fs.ts:209-345`). The reference `CodexSessionStorage` branches on `if (sshConfig)` before using remote helpers (`src/main/storage/codex-session-storage.ts:803-805,942-958,1121-1130`). |
| Phase 1 must register both new integration surfaces | Parser/storage registration should use the standard registry calls | COVERED | The plan now registers the parser with `registerOutputParser(new OmpOutputParser())` (`plan.md:504-510`) and the storage with `registerSessionStorage(new OmpSessionStorage())` (`plan.md:722-725`). These match the live registry APIs in `src/main/parsers/index.ts:79-84` and `src/main/storage/index.ts:34-38`. |
| Unit 1-D must explicitly treat OMP session-dir encoding as a direct port of `getDefaultSessionDirName()` | Plan should warn against shipping a placeholder encoding | COVERED | The plan calls out `getDefaultSessionDirName(cwd)` as the required source of truth (`plan.md:121,526,538-540,675-682,1100`). The referenced OMP helper does indeed implement nontrivial home-relative, temp-root, and legacy-absolute encoding paths in `packages/coding-agent/src/session/session-manager.ts:400-421`. |
| Phase 1 units must remain file-disjoint for parallel execution | No file overlap between Units 1-A through 1-D | COVERED | The plan still shows four disjoint file sets: shared identity files for 1-A (`plan.md:155-160`), agent config files for 1-B (`plan.md:196-198`), parser files for 1-C (`plan.md:272-277`), and storage files for 1-D (`plan.md:518-522`). No overlap was introduced. |

## Assumption Audit

| Assumption | Owner | Evidence status | Failure impact and mitigation |
|---|---|---|---|
| OMP production error patterns must be registered statically, not through the test helper | Unit 1-C | VALIDATED | The plan now reflects Maestro’s live `patternRegistry` and `AgentErrorPatterns` contracts (`plan.md:105-107,472-502`; `src/main/parsers/error-patterns.ts:26-43,862-972`). Mitigation: keep the static-map edit as the only production registration path. |
| OMP `get_session_stats` usage data is nested under `data.tokens` | Unit 1-C | VALIDATED | The updated parser sketch matches OMP’s `SessionStats.tokens` shape (`plan.md:115,419-429`; `packages/coding-agent/src/session/agent-session.ts:309-326,5897-5905`). Mitigation: keep context-window extraction on `get_state.model.contextWindow`, not `get_session_stats`. |
| OMP session-path encoding must mirror `getDefaultSessionDirName()` exactly | Unit 1-D | VALIDATED | The plan explicitly flags the placeholder as non-shipping guidance and points implementers to OMP’s real encoding logic (`plan.md:526,538-540,675-682,1100`; `packages/coding-agent/src/session/session-manager.ts:400-421`). Mitigation: port the helper before implementation is considered done. |
| The Codex storage structure can be reused for OMP without adding local-vs-SSH branching in the sketch | Unit 1-D | UNVALIDATED | The current sketch calls `readDirRemote(sessionDir, sshConfig)`, `readFileRemote(filePath, sshConfig, { maxBytes: 8192 })`, and `statRemote(filePath, sshConfig)` directly (`plan.md:570,578,584`) even though the live remote-fs helpers require a concrete `SshRemoteConfig` and the reference `CodexSessionStorage` branches on `if (sshConfig)` before using them (`src/main/utils/remote-fs.ts:209-345`; `src/main/storage/codex-session-storage.ts:803-805,942-958,1121-1130`). Mitigation: rewrite the sketch to follow the same local/SSH split as the reference storage. |

## Implementation Readiness
- Execution ordering/dependency readiness: Ready. The Phase 1 file split remains disjoint, so the stated parallel execution model is still credible.
- Test strategy readiness: Ready for the requested Round 3 checks. The updated plan now exposes the corrected parser/storage contract details plainly enough to validate them against live source contracts.
- Rollback/failure-path readiness: Ready. Phase 1 remains additive registration/new-file work with isolated blast radius across shared, parser, and storage surfaces.
- Integration boundary readiness: Not ready. Unit 1-D’s storage sketch still mismatches the live local-vs-SSH remote-fs helper contract.

## Findings

### READINESS_GAP

#### F-001 — BLOCKING — Unit 1-D’s storage sketch still misuses Maestro’s remote-fs helper APIs
- Category: `READINESS_GAP`
- Severity: `BLOCKING`
- Summary: The updated session-storage sketch fixes the method names, field names, pagination helper, and `RemoteFsResult.success` checks, but it still does not follow the live local-vs-SSH access pattern required by Maestro’s storage and remote-fs APIs.
- Evidence: The plan now calls `readDirRemote(sessionDir, sshConfig)` (`plan.md:570`), `readFileRemote(filePath, sshConfig, { maxBytes: 8192 })` (`plan.md:578`), `statRemote(filePath, sshConfig)` (`plan.md:584`), and `readFileRemote(filePath, sshConfig)` (`plan.md:622`) directly from methods where `sshConfig` is optional. Live Maestro defines these helpers as `readDirRemote(dirPath, sshRemote)`, `readFileRemote(filePath, sshRemote)`, and `statRemote(filePath, sshRemote)` with required `SshRemoteConfig` parameters and no `{ maxBytes }` overload (`src/main/utils/remote-fs.ts:209-345`). The reference `CodexSessionStorage` branches on `if (sshConfig)` before using remote helpers and falls back to local `fs` APIs otherwise (`src/main/storage/codex-session-storage.ts:803-805,942-958,1121-1130`).
- Impact: An implementer following the plan literally will still produce a storage sketch that is not contract-correct for local vs SSH execution and may not type-check because the sample invokes `readFileRemote(...)` with an unsupported third argument.
- Recommended fix: Rewrite the Unit 1-D sketch to mirror the Codex reference structure: branch on `if (sshConfig)` before calling `readDirRemote` / `readFileRemote` / `statRemote`, use local `fs` APIs when `sshConfig` is absent, and remove the unsupported `{ maxBytes: 8192 }` argument from `readFileRemote(...)`.

## Decision
- Final verdict: `BLOCKED`
- Rationale: Units 1-A, 1-B, and all rechecked Unit 1-C fixes now align with the live Maestro and OMP contracts. Parser and storage registration guidance is also correct, the path-encoding warning is preserved, and the Phase 1 file split remains parallel-safe. However, Unit 1-D still contains a blocking storage-sketch mismatch against Maestro’s remote-fs API shape.
- Minimum next actions:
  1. Rewrite the Unit 1-D storage sketch so remote helpers are only called inside an `if (sshConfig)` branch and local reads use `fs` APIs.
  2. Remove the unsupported `{ maxBytes: 8192 }` argument from the `readFileRemote(...)` example or replace that line with a contract-correct local/SSH approach.
  3. Re-run Phase 1 verification after the storage sketch matches the live `remote-fs.ts` helper signatures and Codex storage branching pattern.
