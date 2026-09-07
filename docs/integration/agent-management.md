# Foundation × Agent management integration

## Inputs and authority
User-requested integration; Foundation 088a8cf; fetched upstream 3294654 (2026-09-07); common base 581d17b. Dedicated branch integration/foundation-agent-management. No main merge, publication, signing, or user-data migration execution.

## Compatibility contract
- Preserve complete upstream ancestry via a two-parent merge. Retain Foundation brand, DESIGN.md, tokens, versions, updater/signing/release settings.
- Retain Foundation host inventory, strict content truth, organization evidence, archive and undo. Existing hidden preset/tag/project storage remains compatible, but Agent-facing CLI and bundled documentation must not expose or mutate these hidden product states.
- App and CLI use the same Rust mutation services. CLI parses and presents results; it must not implement a parallel install/update/source/deployment writer.
- Ship manage-skills through compile-time embedded content, pinned to the App/CLI build. Never fetch its instructions from a moving Git branch. Dashboard authorization requires a verified matching CLI bridge and explicitly selected Agents.
- Deployment ownership is checked before replacement or removal; unowned directories and changed managed copies fail closed. Updates/reimports/source repair retain upstream removal preview and explicit acknowledgement.
- Central writes use RepoLock and sync metadata. External edits must invalidate stale organization evidence and refresh the index; watcher mute must not discard foreign writes, including writes inside a recently self-written root.

## Implementation sequence / checklist
- [x] Inspect clean worktree, fetch remotes, create integration branch.
- [x] Record design and compatibility boundaries before implementation.
- [x] Merge upstream ancestry and reconcile Foundation behavior.
- [x] Centralize CLI mutations and embed version-bound management Skill.
- [x] Close external-change, indexing, ownership and authorization loops.
- [x] Add integration coverage: authorize → install/collect → update → deploy → status; unowned target; external changes.
- [x] Run Rust/frontend tests, typecheck/build, design contract and diff checks.
- [x] Commit reviewed result and record limitations.

## Verification and risks
Use temporary repositories/Agent roots only. Test shared service behavior and CLI policy, including rejected writes preserving existing bytes. Upstream has advanced beyond the earlier conflict audit; resolve current conflicts, and review automatic merges for semantic regressions. Network/build tooling failures are reported separately from code failures. No passing claim without completed commands.

## Implemented decisions
- Upstream advanced to `3294654579d7398e63f5e0dd71bcc1c8e5dd7ec8`; Foundation remote remains `088a8cffecb1030f6a7da90ed12b91e026ddc5c4` (verified with ls-remote because this checkout only tracks origin/main).
- Schema v12 follows Foundation v8–v11 and repairs additive Foundation columns/tables when opening upstream's different v8. The upstream obsolete preference cleanup is guarded for partial historical schemas.
- `install_directory_unlocked` is shared by desktop, CLI collection/install and the bundled Skill. Agent collection and explicit deployment hold RepoLock. Desktop toggles and CLI deploy/undeploy use the same Foundation deployment service; launching the App/CLI no longer applies hidden presets.
- Explicit writes preserve committed ownership snapshots separately from the observable index. Reindex never blesses externally changed bytes. Updates, reimports and source replacement check this evidence; approved removal paths authorize only those paths. Agent copy evidence protects redeploy/removal, and status validates live content/type rather than a database flag.
- Watcher self-write and debounce events are coalesced and delivered after quiet time, including same-directory external writes. Managed reads refresh external metadata/tree changes under the repository lock. Existing strict organization evidence and archive/undo remain intact.
- The management Skill is compile-time embedded, uses source_type `builtin`, supports source/document comparison, and is upgraded in place only when unmodified. Its bridge contract includes App 1.28.5, CLI crate 1.0.0 and Foundation protocol v1. The Dashboard verifies the bridge, starts with no selected Agents, and reoffers setup when the bundled contract changes. A third-party same-name Skill is never taken over.
- CLI rejects hidden commands/options before store initialization and omits hidden state in nested JSON. Update failure/removal review returns a structured error and nonzero exit status. Remote preparation remains outside the write lock.
- Preserved byte-for-byte relative to Foundation: DESIGN.md, productSurface, tauri.conf.json, package.json, release workflow, release preparation, existing updater UI, README/changelogs and brand imagery. Retained Rust crate version 1.0.0; build.rs reads the App version to bind the CLI contract without changing release versions.

## Validation
- `cargo test --manifest-path src-tauri/Cargo.toml`: 597 library tests + 5 CLI tests pass; 4 pre-existing network/live acceptance tests ignored.
- Shared lifecycle test includes authorization, builtin upgrade, install, local update, selected Agent deployment, actual disk status, modified copy preservation, external library edits surviving reindex, and unowned target refusal.
- `cargo build --manifest-path src-tauri/Cargo.toml --bin skills-manager-cli` and `node scripts/test-foundation-cli.mjs`: actual isolated CLI processes cover install/update/deploy/status, hidden-state rejection before database creation, same-name unowned directory refusal, and external-edit rejection across launches.
- `node --experimental-strip-types --test tests/*.test.ts`: 7 frontend tests pass.
- `npm run build` (TypeScript project build + Vite), `npm run design:check` (95 tokens) and `git diff --check`: pass.

## Remaining boundaries
- RepoLock coordinates Manager processes; it cannot lock arbitrary external editors. Content guards narrow but do not eliminate the filesystem race between final verification and rename/copy. No claim of OS-level transaction isolation.
- Agent authorization distributes a management Skill to selected Agents; it is not OS process identity authentication. The shared CLI write boundary and ownership checks remain authoritative for CLI operations.
- Existing externally modified content is deliberately blocked until preserved/reviewed; update approval only covers listed removals. A same-name third-party management Skill must be preserved and removed explicitly before builtin setup.
- Packaged macOS/Windows/Linux bundle behavior and signing/updater installation were not exercised. The four ignored tests require external network/live inventory. Vite retains the existing large-chunk and Browserslist-data warnings.
- No production database migration, main merge, remote push, release or signing performed.
