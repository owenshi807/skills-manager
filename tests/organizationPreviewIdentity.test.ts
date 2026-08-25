import assert from "node:assert/strict";
import test from "node:test";
import {
  organizationArchivePreviewIdentity,
  organizationIssueSelectionIdentity,
} from "../src/lib/organizationPreviewIdentity.ts";

const basePreview = {
  active: true,
  issueId: "name:pdf",
  caseRevision: "revision-1",
  issueKind: "name_collision",
  memberIds: ["pdf", "pdf-2"],
  keepSkillId: "pdf",
  archiveSkillId: "pdf-2",
};

test("semantically identical rebuilt issues keep one preview identity", () => {
  const first = organizationArchivePreviewIdentity(basePreview);
  const rebuilt = organizationArchivePreviewIdentity({
    ...basePreview,
    memberIds: ["pdf-2", "pdf"],
  });

  assert.equal(rebuilt, first);
});

test("preview identity changes when evidence or the selected keep item changes", () => {
  const first = organizationArchivePreviewIdentity(basePreview);
  const newRevision = organizationArchivePreviewIdentity({
    ...basePreview,
    caseRevision: "revision-2",
  });
  const reversedChoice = organizationArchivePreviewIdentity({
    ...basePreview,
    keepSkillId: "pdf-2",
    archiveSkillId: "pdf",
  });

  assert.notEqual(newRevision, first);
  assert.notEqual(reversedChoice, first);
});

test("selection identity ignores object and member ordering churn", () => {
  const first = organizationIssueSelectionIdentity("name:pdf", ["pdf", "pdf-2"], "pdf");
  const rebuilt = organizationIssueSelectionIdentity("name:pdf", ["pdf-2", "pdf"], "pdf");

  assert.equal(rebuilt, first);
});

test("inactive or incomplete cases cannot start an archive preview", () => {
  assert.equal(organizationArchivePreviewIdentity({ ...basePreview, active: false }), null);
  assert.equal(organizationArchivePreviewIdentity({ ...basePreview, caseRevision: null }), null);
});
