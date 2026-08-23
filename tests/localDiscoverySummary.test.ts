import assert from "node:assert/strict";
import test from "node:test";
import {
  summarizeLocalDiscovery,
  type ScanResult,
} from "../src/lib/tauri.ts";

const group = (
  name: string,
  importState: ScanResult["groups"][number]["import_state"],
  importReason: ScanResult["groups"][number]["import_reason"],
  tool = "codex",
): ScanResult["groups"][number] => ({
  name,
  fingerprint: `${name}-fingerprint`,
  locations: [{ id: `${name}-location`, tool, found_path: `/tmp/${name}` }],
  imported: importState === "imported",
  found_at: 1,
  import_state: importState,
  import_reason: importReason,
});

test("discovery summary never treats review or external groups as new importable Skills", () => {
  const result: ScanResult = {
    tools_scanned: 9,
    skills_found: 1,
    observations_found: 6,
    groups_found: 5,
    groups: [
      group("ready", "ready", null),
      group("same-name", "needs_review", "same_name_managed"),
      group("plugin", "blocked", "external_source"),
      group("broken", "blocked", "content_unavailable", "claude_code"),
      group("managed", "imported", "already_managed"),
    ],
  };

  assert.deepEqual(summarizeLocalDiscovery(result), {
    ready: 1,
    needsReview: 1,
    external: 1,
    blocked: 1,
    imported: 1,
    actionable: 3,
    observedAgents: 2,
  });
});

test("empty discovery summary is stable before the first scan", () => {
  assert.deepEqual(summarizeLocalDiscovery(null), {
    ready: 0,
    needsReview: 0,
    external: 0,
    blocked: 0,
    imported: 0,
    actionable: 0,
    observedAgents: 0,
  });
});
