import assert from "node:assert/strict";
import test from "node:test";
import { deckSkillSearchText } from "../src/lib/deckMatching.ts";

test("hidden legacy tags cannot affect deck matching or editor search", () => {
  const text = deckSkillSearchText({
    name: "release-check",
    description: "Verify a release candidate",
    // The runtime object can still contain preserved upstream metadata. The
    // Foundation surface must not read it into user-visible deck decisions.
    tags: ["secret-red-team-match"],
  } as { name: string; description: string; tags: string[] });

  assert.match(text, /release-check/);
  assert.match(text, /verify a release candidate/);
  assert.doesNotMatch(text, /secret-red-team-match/);
});
