# Skill library, Agent publishing, scenes, and MCP

Status: in progress. Base: `8504432`. Goal: implement all four user requirements against the single existing Manager library.

## Requirements and acceptance

- [x] R1: query all managed Skills with source and actual Agent deployment status; resolve divergent same-name groups through an explicit canonical choice or verified per-platform routing, without deleting variants or guessing equivalence.
- [x] R2: an Agent in another session can create/edit in a Manager-owned workspace and publish back; Manager records and displays the result, refreshes content facts, and updates selected managed deployments. Stale edits cannot overwrite newer work. Direct external edits remain discoverable.
- [x] R3: AI discovers named usage scenes from the whole library, persists multi-scene assignments with reasons, allows user correction, and incrementally classifies new/changed Skills. Scene metadata is independent of deployment Presets. Partial/unknown results remain visible.
- [ ] R4: a real stdio MCP server shares the same library and services; Claude Code/Codex can query, organize, inspect distribution/canonical choices, and publish via conversation. App provides an enable switch and working connection setup.
- [ ] Verify isolated full lifecycle, stale/concurrent updates, distinct variants, MCP wire protocol, real Agent scene generation, frontend interactions, and packaged local usage. Inspect actual runtime state before completion.

## Execution boundaries

- Reuse Foundation mutation services, locking, content guards, archive/Undo, and installed Agent runtime adapters.
- Do not replace the underlying library or create a second authority. New scene/canonical/publishing metadata belongs to the same Manager store.
- Do not delete or merge real user Skills without an explicit concrete choice. Canonical selection preserves originals and distinguishes platform/custom variants.
- New work is a product delivery, not a new daemon, remote scheduler, cloud backup system, or general workflow platform.
- Ordinary delegated implementation; no multi-round plan council.

## Work allocation

- Scene backend: new core/command modules and their tests.
- Agent publishing/canonical backend: new core/command modules, management Skill instructions and tests.
- MCP: stdio binary/module, enable/config commands and protocol/lifecycle tests.
- Root: frontend, shared registrations/build packaging, integration, current-library rollout and final acceptance.

## Progress

- [x] Read active goal and caveman; inspected current clean integration HEAD and shared services.
- [x] Implement all four code paths; real packaging/runtime validation in progress.
- [x] Review shared write boundaries, repair stale/canonical/candidate checks, enforce MCP framing/permissions, and verify safe two-session behavior.
- [ ] Complete runtime and packaged acceptance against every requirement.

## Verified so far (2026-09-08)

- Rust all-targets: 615 library tests + 5 CLI tests pass; 4 pre-existing live/network tests ignored.
- Frontend build, ESLint and design contract pass.
- Real MCP process integration passes create/read/scenes/manual exclusion/deploy/two-session publish/stale rejection/history/revocation.
- Real Codex gpt-5.4-mini session creates and publishes a synthetic Skill; native application sees library grow from 8 to 9.
- Real native AI organization succeeds: 8 classified, 1 explicitly unknown, 0 failed. Scene and assignments persist through restart.
- Claude native `mcp get skill-manager` confirms Connected against isolated project server. Claude model execution is not verified: even a separate empty-tools READY request times out after 60 seconds despite authenticated status.
- Packaged app initially omitted MCP binary; explicit Cargo bin declarations repair this, all three executables now present.
- User navigation correction: discovered scenes appear as Sidebar children under 使用场景; URL filtering, rename refresh, collapse/expand and automatic new-Skill count updates pass native acceptance in the isolated fixture.

## Priority coverage correction (2026-09-08)

- [x] Confirm the real library has no scene state yet: previous native results were synthetic UAT, not user-library delivery. Corrected that reporting explicitly.
- [x] Verify Business Coach, Codex Review Loop and related custom review variants are in the authoritative library; list actual coverage gaps.
- [x] Persist user-selected priority Skills, process them first, expose priority coverage and unresolved IDs. Do not infer authorship from source type.
- [x] Run classification against the actual library and verify user-named Skills individually before reporting completion.

## Actual rollout and remaining approval (2026-09-08)

- Installed and verified `/Applications/Skill Card Manager.app` 1.28.6, containing application, CLI, and MCP binaries. Previous app, database, and assistant config snapshots are retained under the project `_local_backups` folder.
- Initial real database had 409 active Skills plus 8 archived records, not 417 active Skills. Imported 22 confirmed external omissions; current active library is 431. Archived package versions were excluded, and 21 nested Skill names already inside managed parent packages were preserved in place.
- All 22 imported SKILL.md files match their original source bytes. Normal discovery integrated the existing Codex `information-architecture-navigation` directory as a managed symlink; target records are now 671, with no new recipient/path introduced.
- Recorded 40 priority IDs covering the user-named Skills, associated Business Coach family, and review/coach items. This is a priority list, not a claim that all 40 are user-authored.
- Published current Codex Review Loop content back to its existing managed identity using staged preview → publish. History `67f04929-bac2-4bf3-ba7a-6212082179ec` retains rollback; the current content includes `SCOPE_CASCADE`. Canonical selection correctly rejects this singleton active group; its prior archived record is not an active alternative.
- Priority tests: 9 pass, including priority preservation across the 80-Skill batch boundary. Updated MCP process test passes with 19 real tools, including priority tracking. Frontend TypeScript/build/ESLint and design contract pass.
- Agent capability errors now show their actual reason and allow retry; a selected default Agent no longer appears as an empty dropdown.
- Before the latest user authorization, actual scene classification had **not run**: current scene count and classified state count are both zero, priority coverage is 0/40. Automatic approval rejected sending actual Skill evidence to Codex gpt-5.4-mini without a fresh explicit data/destination confirmation. This data-transfer blocker was resolved by the latest explicit user message: “允许发送片段到GPT，建议使用更好一点的模型。5.6Luna”. Classification is now authorized using gpt-5.6-luna; the exact model returned READY in a real Codex CLI probe. Full-library classification and named-priority verification are in progress.
- Automatic approval also rejected connecting Codex persistently to Manager MCP without action-time confirmation. Codex `config.toml` and Claude `.claude.json` remain byte-identical to their backups. MCP is enabled in Manager, but global assistant registration is pending the user's confirmation.
- Claude model execution remains unverified (even an independent empty-tools request timed out); isolated native MCP handshake was Connected.

Evidence outside the application repository: `_knowledge_base/reviews/product-selection-audit-20260907/personal-skill-coverage.{json,md}` and `real-library-rollout.json`. Run the authorized real classification with gpt-5.6-luna from `/private/tmp/skill-manager-classify-real.py`; use normal client connection buttons only after access approval.

## Luna authorization and real classification (2026-09-08)

- [x] User explicitly authorized real Skill snippets to GPT and selected `gpt-5.6-luna`; exact Codex CLI model probe passed.
- [x] Installed the Luna default and direct-stdin classifier update. Native Rust classifier actually classified Business Coach Family and Codex Review Loop: 2 applied, 0 stale, 0 unknown, 0 errors.
- [x] Fixed family evidence loss: when root SKILL.md is absent, bounded evidence now reads safe root FAMILY.md/README.md with a source label. The family fixture passes.
- [x] Corrected Unix stdin EOF handling after inspecting the installed Tokio implementation; full model input is delivered through stdin, then its handle is dropped.
- [x] Invalid real model output was rejected before mutation (duplicate IDs and empty memberships); runtime batches reduced to 20, semantic instructions distinguish new scenes from unknown evidence.
- [x] Real Luna inference covers all 431 active entries: 430 classified proposals, one unknown aggregate directory (`Proma-Skills`). All 40 priorities have results.
- [x] Consolidate 233 provisional names into usable work scenarios, replay saved validated proposals, and verify final native Sidebar and persistence.
- [ ] Persistent assistant connection remains a separate approval item; this model/data authorization does not silently register an MCP server.

## Verified installed result (2026-09-08, Luna)

- 61 named scenes, 430 classified entries, 40/40 priority coverage, 0 pending, 0 errors. One aggregate directory (`Proma-Skills`) remains explicitly unknown because it lacks a root SKILL.md/FAMILY.md/README.md.
- The first broad pass over-fragmented scenes and hit the 128-scene guard. No rejected batches were applied. Reviewed same-purpose names were consolidated with a backed-up, compare-and-swap update restricted to this run’s AI metadata (no manual assignments/exclusions/descriptions existed), then saved proposals were replayed through normal MCP hash validation. No scene-limit increase, Skill content edit, or deployment change was needed.
- Semantic audit corrected UI redesign and the business deal control tower; project-code-review, github-code-review and requesting-code-review now appear in the code review scene. Business work is not collapsed into engineering.
- Native restart retained all 61 Sidebar child nodes. Clicking 商业项目推演 shows Business Coach and its family; clicking 代码审查与修复 shows 13 entries including Codex Review Loop and custom reviews. Native UI reports 430 classified and 40/40 priorities.
- Incremental classification enabled through native UI, preferred Agent Codex; persisted preference verified. Model label is gpt-5.6-luna.
- Scene module regression suite: 11 passed. TypeScript/ESLint/build pass; actual native Rust Luna probe: 2 applied, no stale/unknown/errors.
- Actual deployment target count remains 671. Codex and Claude global configuration bytes still match their backups. Persistent connection remains pending the separate access confirmation.
- Stable receipts and database/app rollback are under `_local_backups/before-scenes-mcp-20260908-104549/luna-classification`; human-readable evidence JSON is `_knowledge_base/reviews/product-selection-audit-20260907/real-luna-classification.json` outside the app repository.

## Completion audit follow-up (2026-09-08)

- Prior goal turn made real progress: installed Luna classification, applied 430 real entries, verified native scenes and automatic preferences.
- Fresh authoritative MCP audit finds **72 divergent same-name groups, all unselected**. R1 was checked prematurely at capability level; reopened until actual canonical decisions are recorded. 71 groups are GSD pairs; the remaining group is docx. Read-only per-group difference analysis is in progress.
- Fresh native `codex mcp get skill-manager --json` and `claude mcp get skill-manager` both report no such server. Manager MCP itself is available/enabled with writes enabled, but persistent assistant registration still awaits the action-time access confirmation required by the earlier automatic approval rejection. The GPT snippet permission does not resolve that separate condition.

## Real same-name resolution (2026-09-08)

- [x] Audited all 72 divergent groups in the real library, including actual file contents and runtime adapter evidence.
- [x] 71 GSD pairs are Claude/Codex platform renders of release 1.9.1; preserved both and saved explicit unique Agent → Skill ID routing. No universal canonical was invented. `gsd-surface` includes a platform state binding, accounted for in its reason.
- [x] The docx pair has byte-identical 60 shared ancillary files; root SKILL.md differs only by the explicit 1.0.1 version, with one additional installation marker in the other copy. Selected the explicit-version managed record, retaining both originals and deployments.
- [x] Applied all 71 platform resolutions through the installed Manager MCP. Verified 71 `variants_confirmed`, one `confirmed`, zero pending/stale groups, all 431 Skill records/deployments unchanged, and 142 reviewed SKILL.md SHA256 values unchanged.
- [x] Scene overview is exactly unchanged by resolution: 61 scenes, 430 classified, 40/40 priorities.
- [x] Native installed UI shows “71 组平台适配 · 1 组主版本 · 0 组待核对”; clicking a Codex variant shows its actual recorded deployment independently of the recommended target platform.
- [x] Stored routing expires on changed content, changed members, or removed/renamed custom Agent keys. Canonical and platform decisions clear each other in a single database transaction. Regression suite: 15 publishing tests pass.
- [x] Final installed binary after the custom-Agent invalidation fix: the packaged MCP reads the real 72 persisted decisions and 61 scenes; the stable bridge matches the installed binary. Release builds correctly reject the debug-only isolated EVAL_ROOT override, so the full synthetic lifecycle fixture runs against a freshly built debug binary. Assistant configs remain byte-identical to their pre-rollout backups.
- [ ] R4 remains pending persistent Codex/Claude registration; prior automatic approval rejection requires separate action-time confirmation. This is distinct from the authorized model evidence transfer.

Metadata mutation receipts and the immediate pre-mutation DB/app backup are under `_local_backups/before-scenes-mcp-20260908-104549/before-platform-variants-124558`. Durable summary: `_knowledge_base/reviews/product-selection-audit-20260907/real-platform-variants.json`.

## Codex-only access authorization and connection (2026-09-08)

User explicitly confirmed “确认接入codex，claude本级还没有配置”. Codex persistent access is authorized; Claude connection is deferred by the user because this machine is not configured. Earlier pending-registration notes above describe historical state.

- [x] Backed up current Codex and Claude configuration before connecting.
- [x] Used the installed app’s **连接 Codex** control. Native `codex mcp get skill-manager --json` now verifies the enabled stdio server at `/Users/owen/.skills-manager/bin/skills-manager-mcp`.
- [x] Verified the only semantic Codex configuration addition is the Manager entry. The Codex CLI also serializes away an unrelated `node_repl args=[]` default; omitted args are equivalent. Claude configuration remains byte-identical.
- [x] Read the persisted executable and completed a local initialize → tools/list → Manager status handshake: 20 tools, shared real library, query and file publication enabled.
- [ ] A fresh GPT-5.6-Luna conversation querying real names, IDs, scenes and publish history was rejected **before process launch** by automatic approval. The stated reason requires explicit consent for this specific metadata transfer; no alternative model invocation or indirect workaround was attempted.
- [ ] After that data-transfer confirmation, finish real connected-conversation acceptance. No second Codex registration is needed.
- [ ] Claude connection and Claude model acceptance: deferred by explicit user direction, not a current execution blocker.

Current evidence: `_knowledge_base/reviews/product-selection-audit-20260907/codex-mcp-connection.json`. The earlier 19-tool fixture receipt is historical; platform resolution added the 20th tool.
