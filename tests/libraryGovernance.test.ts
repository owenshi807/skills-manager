import assert from "node:assert/strict";
import test from "node:test";
import { reconcileLibraryGovernance } from "../src/lib/libraryGovernance.ts";
import type { SkillIssue } from "../src/lib/skillOrganization.ts";
import type { CanonicalGroup } from "../src/lib/skillPublishing.ts";

const issue = (kind: SkillIssue["kind"] = "name_collision", ids = ["a", "b"]) => ({
  id: `${kind}:same-name`, kind, skills: ids.map((id) => ({ id })), decisionTier: "needs_semantic",
}) as SkillIssue;
const group = (status = "variants_confirmed", ids = ["a", "b"]) => ({
  normalized_name: "same-name", canonical_status: status,
  members: ids.map((id) => ({ skill: { id } })), unresolved_alternatives: [],
}) as unknown as CanonicalGroup;

test("confirmed platform variants replace only their exact same-name issue", () => {
  const items = [issue(), issue("format_health"), issue("sync_conflict"), issue("content_alias")];
  const result = reconcileLibraryGovernance(items, [group()], new Set());
  assert.deepEqual(result.issues.map((item) => item.kind), ["format_health", "sync_conflict", "content_alias"]);
  assert.equal(result.confirmedGroups.length, 1);
  assert.equal(result.pendingGroups.length, 0);
});

test("a canonical choice preserves outstanding comparisons and original organization decisions", () => {
  const selected = { ...group("confirmed"), unresolved_alternatives: ["b"] };
  const item = issue();
  const result = reconcileLibraryGovernance([item], [selected], new Set([item.id]));
  assert.equal(result.issues.length, 1);
  assert.ok(result.resolvedIds.has(item.id));
  assert.equal(result.confirmedGroups.length, 1);
});

test("stale version evidence reopens the existing issue without adding a duplicate task", () => {
  const item = issue();
  const result = reconcileLibraryGovernance([item], [group("stale")], new Set([item.id]));
  assert.equal(result.issues.length, 1);
  assert.equal(result.pendingGroups.length, 0);
  assert.equal(result.confirmedGroups.length, 0);
  assert.ok(!result.resolvedIds.has(item.id));
});

test("name and partial member overlap cannot hide unrelated issues", () => {
  const result = reconcileLibraryGovernance([issue()], [group("variants_confirmed", ["a", "c"])], new Set());
  assert.equal(result.issues.length, 1);
  assert.equal(result.groupsByIssue.size, 0);
});

test("a stale group with only one remaining member is still visible for review", () => {
  const result = reconcileLibraryGovernance([], [group("stale", ["a"])], new Set());
  assert.equal(result.pendingGroups.length, 1);
});
