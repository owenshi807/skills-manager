# Skill library, Agent publishing, scenes, and MCP

Status: in progress. Base: `8504432`. Goal: implement all four user requirements against the single existing Manager library.

## Requirements and acceptance

- [x] R1: query all managed Skills with source and actual Agent deployment status; identify divergent duplicates and persist an explicit canonical choice without deleting variants or guessing equivalence.
- [x] R2: an Agent in another session can create/edit in a Manager-owned workspace and publish back; Manager records and displays the result, refreshes content facts, and updates selected managed deployments. Stale edits cannot overwrite newer work. Direct external edits remain discoverable.
- [ ] R3: AI discovers named usage scenes from the whole library, persists multi-scene assignments with reasons, allows user correction, and incrementally classifies new/changed Skills. Scene metadata is independent of deployment Presets. Partial/unknown results remain visible.
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
- [ ] Run classification against the actual library and verify user-named Skills individually before reporting completion.

## Actual rollout and remaining approval (2026-09-08)

- Installed and verified `/Applications/Skill Card Manager.app` 1.28.6, containing application, CLI, and MCP binaries. Previous app, database, and assistant config snapshots are retained under the project `_local_backups` folder.
- Initial real database had 409 active Skills plus 8 archived records, not 417 active Skills. Imported 22 confirmed external omissions; current active library is 431. Archived package versions were excluded, and 21 nested Skill names already inside managed parent packages were preserved in place.
- All 22 imported SKILL.md files match their original source bytes. Normal discovery integrated the existing Codex `information-architecture-navigation` directory as a managed symlink; target records are now 671, with no new recipient/path introduced.
- Recorded 40 priority IDs covering the user-named Skills, associated Business Coach family, and review/coach items. This is a priority list, not a claim that all 40 are user-authored.
- Published current Codex Review Loop content back to its existing managed identity using staged preview → publish. History `67f04929-bac2-4bf3-ba7a-6212082179ec` retains rollback; the current content includes `SCOPE_CASCADE`. Canonical selection correctly rejects this singleton active group; its prior archived record is not an active alternative.
- Priority tests: 9 pass, including priority preservation across the 80-Skill batch boundary. Updated MCP process test passes with 19 real tools, including priority tracking. Frontend TypeScript/build/ESLint and design contract pass.
- Agent capability errors now show their actual reason and allow retry; a selected default Agent no longer appears as an empty dropdown.
- Actual scene classification has **not run**: current scene count and classified state count are both zero, priority coverage is 0/40. Automatic approval rejected sending actual Skill evidence to Codex gpt-5.4-mini without a fresh explicit data/destination confirmation. An async confirmation question is pending. Do not route around this through another executor or the app button.
- Automatic approval also rejected connecting Codex persistently to Manager MCP without action-time confirmation. Codex `config.toml` and Claude `.claude.json` remain byte-identical to their backups. MCP is enabled in Manager, but global assistant registration is pending the user's confirmation.
- Claude model execution remains unverified (even an independent empty-tools request timed out); isolated native MCP handshake was Connected.

Evidence outside the application repository: `_knowledge_base/reviews/product-selection-audit-20260907/personal-skill-coverage.{json,md}` and `real-library-rollout.json`. Resume real classification from the prepared `/private/tmp/skill-manager-classify-real.py` only after explicit approval of the stated Skill evidence and Codex destination; use normal client connection buttons only after access approval.
