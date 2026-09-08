---
name: manage-skills
description: Manage the Skill Card Manager Foundation library and explicitly selected Agent deployments through its version-matched local CLI.
---

# Skill Card Manager Foundation

This document ships inside the App. Do not download replacements from upstream.
Contract: {{CONTRACT_VERSION}}. Always use the verified local bridge:
- macOS/Linux: `$HOME/.skills-manager/bin/skills-manager-cli`
- Windows: `$HOME/.skills-manager/bin/skills-manager-cli.exe`

Before any operation read the adjacent `.version` file and run the binary with
`--version`. Both must equal {{CONTRACT_VERSION}} (the last whitespace-delimited
word of --version output). Missing or mismatched stamp/binary: stop and ask the
user to open the matching Skill Card Manager build. Never use npx, a PATH CLI,
a repository checkout, or direct database/filesystem edits as a fallback.

## Scope

The library directory is the content truth. Agent directories are deployments.
Only act on a user-requested task. Installing adds to the library; deployment
always needs explicit Agent keys. Never infer all-Agent deployment. Preserve
local external edits and report conflicts, including the exact path.
Presets, tags and projects are closed in Foundation; do not access their hidden
state, settings or compatibility commands. Organization review/archive/undo
remain in the App; do not emulate them by deleting or moving directories.

## Workflow

Use `--json` and inspect `ok`, errors and pending removals. Resolve ambiguous
names through `skills list` and use IDs for subsequent operations.

1. `agents list`: inspect available Agents.
2. `skills install <path-or-url>`: collect/install without deploying. Use
   `--local`, `--git`, or `--skillssh` when the reference is ambiguous.
   `skills adopt <directory> --dry-run` previews local collection; remove
   `--dry-run` only for the requested collection.
3. `skills check <id>` then `skills update <id>`: update from recorded source.
   Reimport of local sources uses the same update command. If held for removals,
   report every removal and use the App's review dialog for approval.
4. `skills set-source <id> --git-url <url> --dry-run`: inspect source repair.
   Apply only the requested source. `--force` overwrites content and requires
   explicit user authorization; it is never an automatic retry on a conflict.
5. `skills deploy <id> --agent <key> --dry-run`, then the same command without
   `--dry-run`: deploy to only the requested Agent.
6. `skills status <id>`: verify actual on-disk deployment after every mutation.
7. `skills undeploy <id> --agent <key>`: remove only Manager-owned deployment.

Unmanaged destination conflicts fail closed. Never delete the conflicting
folder or use a force path to get around ownership checks. Externally modified
library content must be reviewed and preserved before another update. Read-only
`skills show`, `skills list`, `skills status` support investigation.

## Agent publish workspaces

When the user asks to create or edit a Skill from this conversation, use the
Manager's publishing workflow. It has one library authority and records a
reversible local history; do not edit a deployed Agent copy or a library path
directly.

1. Inspect the library, actual deployment status and same-name alternatives.
   Same names are not versions and are never equivalent by assumption.
2. Begin an edit for one existing Skill ID, or begin a new named Skill. Work
   only in the returned Manager-owned workspace (or use its bounded stage-file
   write API when no local filesystem is available).
3. Preview the candidate. Publish only with the exact candidate digest returned
   by that preview. The Manager rejects stale bases, external library edits and
   changed managed copies; it preserves both the central Skill and the staged
   candidate for review.
4. After a successful publish, inspect distribution. Only recorded, unchanged
   copy deployments are resynced; an unmanaged or modified Agent directory is
   never replaced automatically.

Selecting a canonical Skill is an explicit, reasoned pointer among same-name
alternatives. It preserves every alternative, including platform and custom
variants. If the selected Skill changes later, revisit the selection rather
than treating the old choice as proof that alternatives are interchangeable.
