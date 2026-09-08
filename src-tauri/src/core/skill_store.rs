use anyhow::Result;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

use super::audit_log::{AuditDraft, AuditEntry, MAX_ENTRIES as AUDIT_MAX_ENTRIES};
use super::crypto;
use super::host_discovery::{DiscoveryProvenance, DiscoverySourceKind};

/// Settings keys whose values are encrypted at rest with AES-256-GCM.
const SENSITIVE_KEYS: &[&str] = &["proxy_url", "git_backup_remote_url"];

pub struct SkillStore {
    conn: Mutex<Connection>,
    secret_key: [u8; 32],
}

#[derive(Debug, Clone, Serialize)]
pub struct SkillRecord {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub source_type: String,
    pub source_ref: Option<String>,
    pub source_ref_resolved: Option<String>,
    pub source_subpath: Option<String>,
    pub source_branch: Option<String>,
    pub source_revision: Option<String>,
    pub remote_revision: Option<String>,
    pub central_path: String,
    pub content_hash: Option<String>,
    pub enabled: bool,
    pub created_at: i64,
    pub updated_at: i64,
    pub status: String,
    pub update_status: String,
    pub last_checked_at: Option<i64>,
    pub last_check_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillTargetRecord {
    pub id: String,
    pub skill_id: String,
    pub tool: String,
    pub target_path: String,
    pub mode: String,
    pub status: String,
    pub synced_at: Option<i64>,
    pub last_error: Option<String>,
    /// SHA-256 of the central skill source at the time of the last
    /// successful sync. Compared against the current `skills.content_hash`
    /// to skip redundant Copy-mode resyncs (issue #153). `None` for rows
    /// written before this column existed, or when the source had no hash.
    pub source_hash: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct OrganizationAgentAssessmentRecord {
    pub case_key: String,
    pub case_revision: String,
    pub method_version: String,
    pub agent_key: String,
    pub payload_json: String,
    pub created_at: i64,
}

/// One row of the pending-conflict projection (merge-engine design §4).
#[derive(Debug, Clone, Serialize)]
pub struct PendingConflictRow {
    pub skill_id: String,
    pub theirs_commit: String,
    pub theirs_path: Option<String>,
    pub detected_at: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct OrganizationDecisionRecord {
    pub case_key: String,
    pub evidence_fingerprint: String,
    pub disposition: String,
    pub decided_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct OrganizationOperationRecord {
    pub operation_id: String,
    pub case_key: String,
    pub case_revision: String,
    pub kind: String,
    pub status: String,
    pub keep_skill_id: String,
    pub archive_skill_id: String,
    pub payload_json: String,
    pub error: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct OrganizationScenarioSkillRelationship {
    pub scenario_id: String,
    pub added_at: Option<i64>,
    pub sort_order: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct OrganizationScenarioToolRelationship {
    pub scenario_id: String,
    pub tool: String,
    pub enabled: bool,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct OrganizationSkillRelationshipState {
    pub scenarios: Vec<OrganizationScenarioSkillRelationship>,
    pub scenario_tools: Vec<OrganizationScenarioToolRelationship>,
    pub tags: Vec<String>,
}

/// A deterministic, reversible migration of every hidden legacy relationship
/// from the redundant Skill to the retained Skill. Both the expected before
/// and after states are persisted in the organization operation payload so
/// apply and Undo fail closed if another writer changes those relationships.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct OrganizationRelationshipMigrationPlan {
    pub keep_skill_id: String,
    pub archive_skill_id: String,
    pub before_keep: OrganizationSkillRelationshipState,
    pub before_archive: OrganizationSkillRelationshipState,
    pub after_keep: OrganizationSkillRelationshipState,
    pub after_archive: OrganizationSkillRelationshipState,
    pub before_custom_decks: Option<String>,
    pub after_custom_decks: Option<String>,
    pub before_deck_overrides: Option<String>,
    pub after_deck_overrides: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DiscoveredSkillRecord {
    pub id: String,
    pub tool: String,
    pub found_path: String,
    pub name_guess: Option<String>,
    pub fingerprint: Option<String>,
    pub content_error: Option<String>,
    pub found_at: i64,
    pub imported_skill_id: Option<String>,
    pub provenance: Option<DiscoveryProvenance>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ScenarioRecord {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub icon: Option<String>,
    pub sort_order: i32,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProjectRecord {
    pub id: String,
    pub name: String,
    pub path: String,
    pub workspace_type: String,
    pub linked_agent_key: Option<String>,
    pub linked_agent_name: Option<String>,
    pub disabled_path: Option<String>,
    pub sort_order: i32,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ScenarioSkillToolToggleRecord {
    pub scenario_id: String,
    pub skill_id: String,
    pub tool: String,
    pub enabled: bool,
    pub updated_at: i64,
}

impl SkillStore {
    pub fn new(db_path: &PathBuf) -> Result<Self> {
        let conn = Connection::open(db_path)?;
        // busy_timeout makes concurrent CLI + GUI writers wait briefly instead
        // of failing immediately with SQLITE_BUSY. 5s is generous for any
        // realistic write contention here.
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;

        super::migrations::run_migrations(&conn)?;

        // Derive key file path from the database directory.
        let key_path = db_path
            .parent()
            .map(|p| p.join(".secret.key"))
            .unwrap_or_else(|| PathBuf::from(".secret.key"));
        let secret_key = crypto::load_or_create_key(&key_path)?;

        Ok(Self {
            conn: Mutex::new(conn),
            secret_key,
        })
    }

    // ── Skills CRUD ──

    pub fn get_organization_decisions(&self) -> Result<Vec<OrganizationDecisionRecord>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT case_key, evidence_fingerprint, disposition, decided_at, updated_at
             FROM organization_decisions ORDER BY updated_at DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(OrganizationDecisionRecord {
                case_key: row.get(0)?,
                evidence_fingerprint: row.get(1)?,
                disposition: row.get(2)?,
                decided_at: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })?;
        Ok(rows.filter_map(|row| row.ok()).collect())
    }

    pub fn set_organization_decision(
        &self,
        case_key: &str,
        evidence_fingerprint: &str,
        disposition: &str,
    ) -> Result<OrganizationDecisionRecord> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "INSERT INTO organization_decisions
                (case_key, evidence_fingerprint, disposition, decided_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?4)
             ON CONFLICT(case_key) DO UPDATE SET
                evidence_fingerprint = excluded.evidence_fingerprint,
                disposition = excluded.disposition,
                updated_at = excluded.updated_at",
            params![case_key, evidence_fingerprint, disposition, now],
        )?;
        let decided_at = conn.query_row(
            "SELECT decided_at FROM organization_decisions WHERE case_key = ?1",
            params![case_key],
            |row| row.get(0),
        )?;
        Ok(OrganizationDecisionRecord {
            case_key: case_key.to_string(),
            evidence_fingerprint: evidence_fingerprint.to_string(),
            disposition: disposition.to_string(),
            decided_at,
            updated_at: now,
        })
    }

    pub fn clear_organization_decision(&self, case_key: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM organization_decisions WHERE case_key = ?1",
            params![case_key],
        )?;
        Ok(())
    }

    pub fn create_organization_operation(
        &self,
        record: &OrganizationOperationRecord,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO organization_operations
                (operation_id, case_key, case_revision, kind, status, keep_skill_id,
                 archive_skill_id, payload_json, error, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                record.operation_id,
                record.case_key,
                record.case_revision,
                record.kind,
                record.status,
                record.keep_skill_id,
                record.archive_skill_id,
                record.payload_json,
                record.error,
                record.created_at,
                record.updated_at,
            ],
        )?;
        Ok(())
    }

    pub fn update_organization_operation(
        &self,
        operation_id: &str,
        status: &str,
        error: Option<&str>,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE organization_operations SET status = ?1, error = ?2, updated_at = ?3
             WHERE operation_id = ?4",
            params![
                status,
                error,
                chrono::Utc::now().timestamp_millis(),
                operation_id
            ],
        )?;
        Ok(())
    }

    pub fn get_organization_operation(
        &self,
        operation_id: &str,
    ) -> Result<Option<OrganizationOperationRecord>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT operation_id, case_key, case_revision, kind, status, keep_skill_id,
                    archive_skill_id, payload_json, error, created_at, updated_at
             FROM organization_operations WHERE operation_id = ?1",
        )?;
        let mut rows = stmt.query_map(params![operation_id], |row| {
            Ok(OrganizationOperationRecord {
                operation_id: row.get(0)?,
                case_key: row.get(1)?,
                case_revision: row.get(2)?,
                kind: row.get(3)?,
                status: row.get(4)?,
                keep_skill_id: row.get(5)?,
                archive_skill_id: row.get(6)?,
                payload_json: row.get(7)?,
                error: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
            })
        })?;
        Ok(rows.next().and_then(|row| row.ok()))
    }

    pub fn list_organization_operations(
        &self,
        limit: usize,
    ) -> Result<Vec<OrganizationOperationRecord>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT operation_id, case_key, case_revision, kind, status, keep_skill_id,
                    archive_skill_id, payload_json, error, created_at, updated_at
             FROM organization_operations
             ORDER BY created_at DESC
             LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![limit.min(100) as i64], |row| {
            Ok(OrganizationOperationRecord {
                operation_id: row.get(0)?,
                case_key: row.get(1)?,
                case_revision: row.get(2)?,
                kind: row.get(3)?,
                status: row.get(4)?,
                keep_skill_id: row.get(5)?,
                archive_skill_id: row.get(6)?,
                payload_json: row.get(7)?,
                error: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
            })
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(Into::into)
    }

    pub fn skill_has_organization_dependencies(&self, skill_id: &str) -> Result<bool> {
        let conn = self.conn.lock().unwrap();
        let count: i64 = conn.query_row(
            "SELECT
                (SELECT COUNT(*) FROM scenario_skills WHERE skill_id = ?1) +
                (SELECT COUNT(*) FROM scenario_skill_tools WHERE skill_id = ?1) +
                (SELECT COUNT(*) FROM skill_tags WHERE skill_id = ?1)",
            params![skill_id],
            |row| row.get(0),
        )?;
        drop(conn);
        if count > 0 {
            return Ok(true);
        }
        for key in [
            "card_master_custom_decks_v1",
            "card_master_deck_overrides_v1",
        ] {
            let Some(raw) = self.get_setting(key)? else {
                continue;
            };
            let value: serde_json::Value = serde_json::from_str(&raw)?;
            let referenced = match key {
                "card_master_custom_decks_v1" => value
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|deck| deck.get("cards")?.as_array())
                    .flatten()
                    .any(|card| card.get("skill_id").and_then(|id| id.as_str()) == Some(skill_id)),
                "card_master_deck_overrides_v1" => value
                    .as_object()
                    .into_iter()
                    .flat_map(|decks| decks.values())
                    .any(|deck| {
                        deck.get("addedSkills")
                            .and_then(|items| items.as_array())
                            .into_iter()
                            .flatten()
                            .any(|card| {
                                card.get("skillId").and_then(|id| id.as_str()) == Some(skill_id)
                            })
                            || deck
                                .get("removedSkillIds")
                                .and_then(|items| items.as_array())
                                .into_iter()
                                .flatten()
                                .any(|id| id.as_str() == Some(skill_id))
                    }),
                _ => false,
            };
            if referenced {
                return Ok(true);
            }
        }
        Ok(false)
    }

    pub fn plan_organization_relationship_migration(
        &self,
        keep_skill_id: &str,
        archive_skill_id: &str,
    ) -> Result<OrganizationRelationshipMigrationPlan> {
        if keep_skill_id == archive_skill_id {
            anyhow::bail!("Keep and archive Skills must differ");
        }
        let conn = self.conn.lock().unwrap();
        let before_keep = read_skill_relationship_state(&conn, keep_skill_id)?;
        let before_archive = read_skill_relationship_state(&conn, archive_skill_id)?;
        let after_keep = merge_skill_relationship_states(&before_keep, &before_archive);
        let after_archive = OrganizationSkillRelationshipState::default();
        let before_custom_decks = read_setting_raw(&conn, "card_master_custom_decks_v1")?;
        let before_deck_overrides =
            read_setting_raw(&conn, "card_master_deck_overrides_v1")?;
        let after_custom_decks = rewrite_custom_deck_relationships(
            before_custom_decks.as_deref(),
            keep_skill_id,
            archive_skill_id,
        )?;
        let after_deck_overrides = rewrite_deck_override_relationships(
            before_deck_overrides.as_deref(),
            keep_skill_id,
            archive_skill_id,
        )?;
        Ok(OrganizationRelationshipMigrationPlan {
            keep_skill_id: keep_skill_id.to_string(),
            archive_skill_id: archive_skill_id.to_string(),
            before_keep,
            before_archive,
            after_keep,
            after_archive,
            before_custom_decks,
            after_custom_decks,
            before_deck_overrides,
            after_deck_overrides,
        })
    }

    pub fn mark_skill_archived_with_relationships(
        &self,
        skill_id: &str,
        archive_path: &str,
        transferred_targets: &[SkillTargetRecord],
        removed_target_tools: &[String],
        migration: &OrganizationRelationshipMigrationPlan,
        operation_id: &str,
    ) -> Result<()> {
        if skill_id != migration.archive_skill_id {
            anyhow::bail!("Relationship migration does not match archived Skill");
        }
        let conn = self.conn.lock().unwrap();
        let tx = conn.unchecked_transaction()?;
        assert_relationship_migration_state(&tx, migration, false)?;
        write_relationship_migration_state(&tx, migration, true)?;
        for tool in removed_target_tools {
            tx.execute(
                "DELETE FROM skill_targets WHERE skill_id = ?1 AND tool = ?2",
                params![skill_id, tool],
            )?;
        }
        for target in transferred_targets {
            tx.execute(
                "UPDATE skill_targets SET skill_id = ?1, target_path = ?2, mode = ?3,
                        source_hash = ?4, synced_at = ?5, status = 'ok', last_error = NULL
                 WHERE id = ?6",
                params![
                    target.skill_id,
                    target.target_path,
                    target.mode,
                    target.source_hash,
                    target.synced_at,
                    target.id
                ],
            )?;
        }
        tx.execute(
            "UPDATE skills SET central_path = ?1, status = 'archived', enabled = 0,
                    updated_at = ?2 WHERE id = ?3",
            params![
                archive_path,
                chrono::Utc::now().timestamp_millis(),
                skill_id
            ],
        )?;
        tx.execute(
            "UPDATE organization_operations SET status = 'complete', error = NULL, updated_at = ?1
             WHERE operation_id = ?2",
            params![chrono::Utc::now().timestamp_millis(), operation_id],
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn validate_applied_organization_relationship_migration(
        &self,
        migration: &OrganizationRelationshipMigrationPlan,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        assert_relationship_migration_state(&conn, migration, true)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn restore_archived_skill_with_relationships(
        &self,
        skill_id: &str,
        central_path: &str,
        enabled: bool,
        status: &str,
        original_targets: &[SkillTargetRecord],
        migration: &OrganizationRelationshipMigrationPlan,
        operation_id: &str,
    ) -> Result<()> {
        if skill_id != migration.archive_skill_id {
            anyhow::bail!("Relationship migration does not match archived Skill");
        }
        let conn = self.conn.lock().unwrap();
        let tx = conn.unchecked_transaction()?;
        assert_relationship_migration_state(&tx, migration, true)?;
        write_relationship_migration_state(&tx, migration, false)?;
        for target in original_targets {
            tx.execute(
                "DELETE FROM skill_targets WHERE id = ?1",
                params![target.id],
            )?;
            tx.execute(
                "INSERT INTO skill_targets
                    (id, skill_id, tool, target_path, mode, status, synced_at, last_error, source_hash)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    target.id,
                    target.skill_id,
                    target.tool,
                    target.target_path,
                    target.mode,
                    target.status,
                    target.synced_at,
                    target.last_error,
                    target.source_hash,
                ],
            )?;
        }
        tx.execute(
            "UPDATE skills SET central_path = ?1, status = ?2, enabled = ?3, updated_at = ?4
             WHERE id = ?5",
            params![
                central_path,
                status,
                enabled,
                chrono::Utc::now().timestamp_millis(),
                skill_id
            ],
        )?;
        tx.execute(
            "UPDATE organization_operations SET status = 'undone', error = NULL, updated_at = ?1
             WHERE operation_id = ?2",
            params![chrono::Utc::now().timestamp_millis(), operation_id],
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn mark_skill_archived(
        &self,
        skill_id: &str,
        archive_path: &str,
        transferred_targets: &[SkillTargetRecord],
        removed_target_tools: &[String],
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let tx = conn.unchecked_transaction()?;
        for tool in removed_target_tools {
            tx.execute(
                "DELETE FROM skill_targets WHERE skill_id = ?1 AND tool = ?2",
                params![skill_id, tool],
            )?;
        }
        for target in transferred_targets {
            tx.execute(
                "UPDATE skill_targets SET skill_id = ?1, target_path = ?2, mode = ?3,
                        source_hash = ?4, synced_at = ?5, status = 'ok', last_error = NULL
                 WHERE id = ?6",
                params![
                    target.skill_id,
                    target.target_path,
                    target.mode,
                    target.source_hash,
                    target.synced_at,
                    target.id
                ],
            )?;
        }
        tx.execute(
            "UPDATE skills SET central_path = ?1, status = 'archived', enabled = 0,
                    updated_at = ?2 WHERE id = ?3",
            params![
                archive_path,
                chrono::Utc::now().timestamp_millis(),
                skill_id
            ],
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn restore_archived_skill(
        &self,
        skill_id: &str,
        central_path: &str,
        enabled: bool,
        status: &str,
        original_targets: &[SkillTargetRecord],
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let tx = conn.unchecked_transaction()?;
        for target in original_targets {
            tx.execute(
                "DELETE FROM skill_targets WHERE id = ?1",
                params![target.id],
            )?;
            tx.execute(
                "INSERT INTO skill_targets
                    (id, skill_id, tool, target_path, mode, status, synced_at, last_error, source_hash)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    target.id,
                    target.skill_id,
                    target.tool,
                    target.target_path,
                    target.mode,
                    target.status,
                    target.synced_at,
                    target.last_error,
                    target.source_hash,
                ],
            )?;
        }
        tx.execute(
            "UPDATE skills SET central_path = ?1, status = ?2, enabled = ?3,
                    updated_at = ?4 WHERE id = ?5",
            params![
                central_path,
                status,
                enabled,
                chrono::Utc::now().timestamp_millis(),
                skill_id
            ],
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn get_organization_agent_assessments(
        &self,
    ) -> Result<Vec<OrganizationAgentAssessmentRecord>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT case_key, case_revision, method_version, agent_key, payload_json, created_at
             FROM organization_agent_assessments ORDER BY created_at DESC LIMIT 1000",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(OrganizationAgentAssessmentRecord {
                case_key: row.get(0)?,
                case_revision: row.get(1)?,
                method_version: row.get(2)?,
                agent_key: row.get(3)?,
                payload_json: row.get(4)?,
                created_at: row.get(5)?,
            })
        })?;
        Ok(rows.filter_map(|row| row.ok()).collect())
    }

    pub fn upsert_organization_agent_assessment(
        &self,
        case_key: &str,
        case_revision: &str,
        method_version: &str,
        agent_key: &str,
        payload_json: &str,
    ) -> Result<OrganizationAgentAssessmentRecord> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "INSERT INTO organization_agent_assessments
                (case_key, case_revision, method_version, agent_key, payload_json, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(case_key, case_revision, method_version, agent_key) DO UPDATE SET
                payload_json = excluded.payload_json,
                created_at = excluded.created_at",
            params![
                case_key,
                case_revision,
                method_version,
                agent_key,
                payload_json,
                now
            ],
        )?;
        Ok(OrganizationAgentAssessmentRecord {
            case_key: case_key.to_string(),
            case_revision: case_revision.to_string(),
            method_version: method_version.to_string(),
            agent_key: agent_key.to_string(),
            payload_json: payload_json.to_string(),
            created_at: now,
        })
    }

    pub fn insert_skill(&self, skill: &SkillRecord) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO skills (
                id, name, description, source_type, source_ref, source_ref_resolved, source_subpath,
                source_branch, source_revision, remote_revision, central_path, content_hash, enabled,
                created_at, updated_at, status, update_status, last_checked_at, last_check_error
             )
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)",
            params![
                skill.id,
                skill.name,
                skill.description,
                skill.source_type,
                skill.source_ref,
                skill.source_ref_resolved,
                skill.source_subpath,
                skill.source_branch,
                skill.source_revision,
                skill.remote_revision,
                skill.central_path,
                skill.content_hash,
                skill.enabled,
                skill.created_at,
                skill.updated_at,
                skill.status,
                skill.update_status,
                skill.last_checked_at,
                skill.last_check_error,
            ],
        )?;
        drop(conn);
        super::foundation_write::remember(self, skill)?;
        Ok(())
    }

    pub fn upsert_skill(&self, skill: &SkillRecord) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        Self::upsert_skill_on_connection(&conn, skill)
    }

    fn upsert_skill_on_connection(conn: &Connection, skill: &SkillRecord) -> Result<()> {
        conn.execute(
            "INSERT INTO skills (
                id, name, description, source_type, source_ref, source_ref_resolved, source_subpath,
                source_branch, source_revision, remote_revision, central_path, content_hash, enabled,
                created_at, updated_at, status, update_status, last_checked_at, last_check_error
             )
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)
             ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                description = excluded.description,
                source_type = excluded.source_type,
                source_ref = excluded.source_ref,
                source_ref_resolved = excluded.source_ref_resolved,
                source_subpath = excluded.source_subpath,
                source_branch = excluded.source_branch,
                source_revision = excluded.source_revision,
                remote_revision = excluded.remote_revision,
                central_path = excluded.central_path,
                content_hash = excluded.content_hash,
                enabled = excluded.enabled,
                updated_at = excluded.updated_at,
                status = excluded.status,
                update_status = excluded.update_status,
                last_checked_at = excluded.last_checked_at,
                last_check_error = excluded.last_check_error",
            params![
                skill.id,
                skill.name,
                skill.description,
                skill.source_type,
                skill.source_ref,
                skill.source_ref_resolved,
                skill.source_subpath,
                skill.source_branch,
                skill.source_revision,
                skill.remote_revision,
                skill.central_path,
                skill.content_hash,
                skill.enabled,
                skill.created_at,
                skill.updated_at,
                skill.status,
                skill.update_status,
                skill.last_checked_at,
                skill.last_check_error,
            ],
        )?;
        Ok(())
    }

    pub fn get_all_skills(&self) -> Result<Vec<SkillRecord>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, description, source_type, source_ref, source_ref_resolved, source_subpath,
                    source_branch, source_revision, remote_revision, central_path, content_hash, enabled,
                    created_at, updated_at, status, update_status, last_checked_at, last_check_error
             FROM skills WHERE status != 'archived' ORDER BY name",
        )?;
        let rows = stmt.query_map([], map_skill_row)?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    pub fn get_skill_by_id(&self, id: &str) -> Result<Option<SkillRecord>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, description, source_type, source_ref, source_ref_resolved, source_subpath,
                    source_branch, source_revision, remote_revision, central_path, content_hash, enabled,
                    created_at, updated_at, status, update_status, last_checked_at, last_check_error
             FROM skills WHERE id = ?1",
        )?;
        let mut rows = stmt.query_map(params![id], map_skill_row)?;
        Ok(rows.next().and_then(|r| r.ok()))
    }

    pub fn get_skill_by_central_path(&self, central_path: &str) -> Result<Option<SkillRecord>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, description, source_type, source_ref, source_ref_resolved, source_subpath,
                    source_branch, source_revision, remote_revision, central_path, content_hash, enabled,
                    created_at, updated_at, status, update_status, last_checked_at, last_check_error
             FROM skills WHERE central_path = ?1",
        )?;
        let mut rows = stmt.query_map(params![central_path], map_skill_row)?;
        Ok(rows.next().and_then(|r| r.ok()))
    }

    pub fn get_skill_by_source_ref(
        &self,
        source_type: &str,
        source_ref: &str,
    ) -> Result<Option<SkillRecord>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, description, source_type, source_ref, source_ref_resolved, source_subpath,
                    source_branch, source_revision, remote_revision, central_path, content_hash, enabled,
                    created_at, updated_at, status, update_status, last_checked_at, last_check_error
             FROM skills
             WHERE source_type = ?1 AND source_ref = ?2",
        )?;
        let mut rows = stmt.query_map(params![source_type, source_ref], map_skill_row)?;
        Ok(rows.next().and_then(|r| r.ok()))
    }

    pub fn update_skill_source_metadata(
        &self,
        id: &str,
        source_ref_resolved: Option<&str>,
        source_subpath: Option<&str>,
        source_branch: Option<&str>,
        source_revision: Option<&str>,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "UPDATE skills
             SET source_ref_resolved = ?1, source_subpath = ?2, source_branch = ?3, source_revision = ?4, updated_at = ?5
             WHERE id = ?6",
            params![
                source_ref_resolved,
                source_subpath,
                source_branch,
                source_revision,
                now,
                id
            ],
        )?;
        Ok(())
    }

    pub fn update_skill_check_state(
        &self,
        id: &str,
        remote_revision: Option<&str>,
        update_status: &str,
        last_check_error: Option<&str>,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "UPDATE skills
             SET remote_revision = ?1, update_status = ?2, last_checked_at = ?3, last_check_error = ?4
             WHERE id = ?5",
            params![remote_revision, update_status, now, last_check_error, id],
        )?;
        Ok(())
    }

    pub fn update_skill_update_status(&self, id: &str, update_status: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE skills SET update_status = ?1 WHERE id = ?2",
            params![update_status, id],
        )?;
        Ok(())
    }

    /// Refresh the facts derived from the managed central copy without
    /// changing source/update relationships or any agent projection.
    pub fn refresh_skill_facts(
        &self,
        id: &str,
        name: &str,
        description: Option<&str>,
        content_hash: Option<&str>,
        status: &str,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "UPDATE skills
             SET updated_at = CASE
                     WHEN name = ?1 AND description IS ?2 AND content_hash IS ?3 AND status = ?4
                     THEN updated_at ELSE ?5 END,
                 name = ?1, description = ?2, content_hash = ?3, status = ?4
             WHERE id = ?6",
            params![name, description, content_hash, status, now, id],
        )?;
        Ok(())
    }

    pub fn update_skill_enabled(&self, id: &str, enabled: bool) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "UPDATE skills SET enabled = ?1, updated_at = ?2 WHERE id = ?3",
            params![enabled, now, id],
        )?;
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn update_skill_after_install(
        &self,
        id: &str,
        name: &str,
        description: Option<&str>,
        source_revision: Option<&str>,
        remote_revision: Option<&str>,
        content_hash: Option<&str>,
        update_status: &str,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "UPDATE skills
             SET name = ?1, description = ?2, source_revision = ?3, remote_revision = ?4, content_hash = ?5,
                 updated_at = ?6, update_status = ?7, last_checked_at = ?6, last_check_error = NULL
             WHERE id = ?8",
            params![
                name,
                description,
                source_revision,
                remote_revision,
                content_hash,
                now,
                update_status,
                id
            ],
        )?;
        drop(conn);
        if let Some(skill) = self.get_skill_by_id(id)? { super::foundation_write::remember(self, &skill)?; }
        Ok(())
    }

    pub fn update_skill_source_ref(&self, id: &str, source_ref: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE skills SET source_ref = ?1 WHERE id = ?2",
            params![source_ref, id],
        )?;
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn update_skill_after_reinstall(
        &self,
        id: &str,
        name: &str,
        description: Option<&str>,
        source_type: &str,
        source_ref: Option<&str>,
        source_ref_resolved: Option<&str>,
        source_subpath: Option<&str>,
        source_branch: Option<&str>,
        source_revision: Option<&str>,
        remote_revision: Option<&str>,
        content_hash: Option<&str>,
        update_status: &str,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "UPDATE skills
             SET name = ?1, description = ?2, source_type = ?3, source_ref = ?4, source_ref_resolved = ?5,
                 source_subpath = ?6, source_branch = ?7, source_revision = ?8, remote_revision = ?9,
                 content_hash = ?10, updated_at = ?11, status = 'ok', update_status = ?12, last_checked_at = ?11,
                 last_check_error = NULL
             WHERE id = ?13",
            params![
                name,
                description,
                source_type,
                source_ref,
                source_ref_resolved,
                source_subpath,
                source_branch,
                source_revision,
                remote_revision,
                content_hash,
                now,
                update_status,
                id
            ],
        )?;
        drop(conn);
        if let Some(skill) = self.get_skill_by_id(id)? { super::foundation_write::remember(self, &skill)?; }
        Ok(())
    }

    /// Install one prepared active-library snapshot atomically. Temporary paths
    /// allow genuine path swaps, but stay inside this transaction: GUI/MCP
    /// readers (including other processes) see either the old or new snapshot.
    /// Archived rows are not part of this snapshot and must retain their paths.
    pub(crate) fn replace_skills_from_metadata(
        &self,
        records: &[(SkillRecord, Vec<String>)],
    ) -> Result<()> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        let expected_ids = records.iter().map(|(skill, _)| skill.id.as_str())
            .collect::<std::collections::HashSet<_>>();
        let active_ids = {
            let mut statement = tx.prepare("SELECT id FROM skills WHERE status != 'archived'")?;
            let ids = statement.query_map([], |row| row.get::<_, String>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            ids
        };
        for id in active_ids {
            if !expected_ids.contains(id.as_str()) {
                tx.execute("DELETE FROM skills WHERE id = ?1", params![id])?;
            }
        }
        tx.execute(
            "UPDATE skills SET central_path = 'sm-reindex-parked://' || id WHERE status != 'archived'",
            [],
        )?;
        for (skill, tags) in records {
            Self::upsert_skill_on_connection(&tx, skill)?;
            Self::set_tags_on_connection(&tx, &skill.id, tags)?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn delete_skill(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM skills WHERE id = ?1", params![id])?;
        Ok(())
    }

    // ── Targets ──

    pub fn insert_target(&self, target: &SkillTargetRecord) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO skill_targets (id, skill_id, tool, target_path, mode, status, synced_at, last_error, source_hash)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                target.id,
                target.skill_id,
                target.tool,
                target.target_path,
                target.mode,
                target.status,
                target.synced_at,
                target.last_error,
                target.source_hash,
            ],
        )?;
        drop(conn);
        if target.mode == "copy" && std::path::Path::new(&target.target_path).is_dir() {
            let digest = super::content_hash::hash_directory_strict_v2(std::path::Path::new(&target.target_path))?;
            self.set_setting(&format!("foundation_target_digest:{}", target.target_path), &digest)?;
            self.set_setting(&format!("foundation_target_entries:{}", target.target_path), &serde_json::to_string(
                &super::content_hash::ownership_snapshot(std::path::Path::new(&target.target_path))?)?)?;
        }
        Ok(())
    }

    pub fn get_targets_for_skill(&self, skill_id: &str) -> Result<Vec<SkillTargetRecord>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, skill_id, tool, target_path, mode, status, synced_at, last_error, source_hash FROM skill_targets WHERE skill_id = ?1",
        )?;
        let rows = stmt.query_map(params![skill_id], |row| {
            Ok(SkillTargetRecord {
                id: row.get(0)?,
                skill_id: row.get(1)?,
                tool: row.get(2)?,
                target_path: row.get(3)?,
                mode: row.get(4)?,
                status: row.get(5)?,
                synced_at: row.get(6)?,
                last_error: row.get(7)?,
                source_hash: row.get(8)?,
            })
        })?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    pub fn get_all_targets(&self) -> Result<Vec<SkillTargetRecord>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, skill_id, tool, target_path, mode, status, synced_at, last_error, source_hash FROM skill_targets",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(SkillTargetRecord {
                id: row.get(0)?,
                skill_id: row.get(1)?,
                tool: row.get(2)?,
                target_path: row.get(3)?,
                mode: row.get(4)?,
                status: row.get(5)?,
                synced_at: row.get(6)?,
                last_error: row.get(7)?,
                source_hash: row.get(8)?,
            })
        })?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// Force Copy projections through the next sync pass.
    ///
    /// `source_hash` is only a skip hint; clearing it is fail-safe and does
    /// not remove either the managed Skill or its Agent projection. Startup
    /// uses this when the managed tree changed outside Card Master, because
    /// legacy directory hashes alone cannot prove that a copy is current.
    pub fn invalidate_copy_target_source_hashes(&self) -> Result<usize> {
        let conn = self.conn.lock().unwrap();
        Ok(conn.execute(
            "UPDATE skill_targets SET source_hash = NULL
             WHERE mode = 'copy' AND source_hash IS NOT NULL",
            [],
        )?)
    }

    pub fn delete_target(&self, skill_id: &str, tool: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM skill_targets WHERE skill_id = ?1 AND tool = ?2",
            params![skill_id, tool],
        )?;
        Ok(())
    }

    // ── Discovered Skills ──

    pub fn clear_discovered(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM discovered_skills", [])?;
        Ok(())
    }

    pub fn insert_discovered(&self, rec: &DiscoveredSkillRecord) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        insert_discovered_row(&conn, rec)?;
        Ok(())
    }

    /// Replace the complete discovered snapshot atomically. Any failed insert
    /// rolls back the delete and leaves the previous snapshot intact.
    pub fn replace_discovered(&self, records: &[DiscoveredSkillRecord]) -> Result<()> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        tx.execute("DELETE FROM discovered_skills", [])?;
        {
            let mut stmt = tx.prepare(DISCOVERED_INSERT_SQL)?;
            for record in records {
                execute_discovered_insert(&mut stmt, record)?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    pub fn get_all_discovered(&self) -> Result<Vec<DiscoveredSkillRecord>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, tool, found_path, name_guess, fingerprint, found_at, imported_skill_id,
                    source_kind, owner_ref, discovery_source_ref, discovery_source_version,
                    discovery_source_revision, discovery_source_subpath, declared_repository,
                    provenance_basis, digest_algorithm, content_error
             FROM discovered_skills ORDER BY id",
        )?;
        let rows = stmt.query_map([], map_discovered_row)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    // ── Cache ──

    pub fn get_cache(&self, key: &str, ttl_secs: i64) -> Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().timestamp();
        let mut stmt = conn
            .prepare("SELECT data FROM skillssh_cache WHERE cache_key = ?1 AND fetched_at > ?2")?;
        let cutoff = now - ttl_secs;
        let mut rows = stmt.query_map(params![key, cutoff], |row| row.get::<_, String>(0))?;
        Ok(rows.next().and_then(|r| r.ok()))
    }

    pub fn set_cache(&self, key: &str, data: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().timestamp();
        conn.execute(
            "INSERT OR REPLACE INTO skillssh_cache (cache_key, data, fetched_at) VALUES (?1, ?2, ?3)",
            params![key, data, now],
        )?;
        Ok(())
    }

    // ── Pending conflicts (merge-engine design §4) ──
    // A rebuildable UI projection of the trailer-derived pending set; never
    // an input to merge decisions.

    pub fn replace_pending_conflicts(&self, rows: &[PendingConflictRow]) -> Result<()> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        tx.execute("DELETE FROM pending_conflicts", [])?;
        for row in rows {
            tx.execute(
                "INSERT OR REPLACE INTO pending_conflicts
                 (skill_id, theirs_commit, theirs_path, detected_at)
                 VALUES (?1, ?2, ?3, ?4)",
                params![
                    row.skill_id,
                    row.theirs_commit,
                    row.theirs_path,
                    row.detected_at
                ],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn list_pending_conflicts(&self) -> Result<Vec<PendingConflictRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT skill_id, theirs_commit, theirs_path, detected_at
             FROM pending_conflicts ORDER BY detected_at DESC, skill_id",
        )?;
        let rows = stmt
            .query_map([], |row| {
                Ok(PendingConflictRow {
                    skill_id: row.get(0)?,
                    theirs_commit: row.get(1)?,
                    theirs_path: row.get(2)?,
                    detected_at: row.get(3)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    // ── Settings ──

    pub fn proxy_url(&self) -> Option<String> {
        self.get_setting("proxy_url")
            .ok()
            .flatten()
            .filter(|s| !s.is_empty())
    }

    pub fn get_setting(&self, key: &str) -> Result<Option<String>> {
        // Read the raw stored value while holding the lock, then release it
        // before any write-back so we don't re-enter the mutex.
        let raw = {
            let conn = self.conn.lock().unwrap();
            let mut stmt = conn.prepare("SELECT value FROM settings WHERE key = ?1")?;
            let mut rows = stmt.query_map(params![key], |row| row.get::<_, String>(0))?;
            rows.next().and_then(|r| r.ok())
        };

        let value = match raw {
            None => return Ok(None),
            Some(v) => v,
        };

        if SENSITIVE_KEYS.contains(&key) {
            if crypto::is_encrypted(&value) {
                // Happy path: already encrypted, just decrypt.
                Ok(Some(crypto::decrypt(&self.secret_key, &value)?))
            } else {
                // Backward compat: old plaintext value — upgrade it silently.
                let encrypted = crypto::encrypt(&self.secret_key, &value)?;
                let conn = self.conn.lock().unwrap();
                conn.execute(
                    "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
                    params![key, encrypted],
                )?;
                Ok(Some(value))
            }
        } else {
            Ok(Some(value))
        }
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        let stored = if SENSITIVE_KEYS.contains(&key) {
            crypto::encrypt(&self.secret_key, value)?
        } else {
            value.to_string()
        };
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
            params![key, stored],
        )?;
        Ok(())
    }

    /// Atomically replace a small related set of settings. Callers use this
    /// when two metadata records form one logical state and a partially saved
    /// pair would be misleading after an interrupted write.
    pub fn set_settings_atomic(&self, settings: &[(&str, &str)]) -> Result<()> {
        let stored: Vec<(&str, String)> = settings
            .iter()
            .map(|(key, value)| {
                let value = if SENSITIVE_KEYS.contains(key) {
                    crypto::encrypt(&self.secret_key, value)?
                } else {
                    (*value).to_string()
                };
                Ok((*key, value))
            })
            .collect::<Result<_>>()?;
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        for (key, value) in stored {
            tx.execute(
                "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
                params![key, value],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn remap_tool_key_references(&self, old_key: &str, new_key: &str) -> Result<()> {
        if old_key == new_key {
            return Ok(());
        }
        let conn = self.conn.lock().unwrap();

        // scenario_skill_tools has a composite PK (scenario_id, skill_id, tool). If both old/new
        // rows exist for the same skill in the same scenario, keep the new-key row.
        conn.execute(
            "DELETE FROM scenario_skill_tools AS old_rows
             WHERE old_rows.tool = ?1
               AND EXISTS (
                 SELECT 1
                 FROM scenario_skill_tools AS new_rows
                 WHERE new_rows.tool = ?2
                   AND new_rows.scenario_id = old_rows.scenario_id
                   AND new_rows.skill_id = old_rows.skill_id
               )",
            params![old_key, new_key],
        )?;
        conn.execute(
            "UPDATE scenario_skill_tools SET tool = ?2 WHERE tool = ?1",
            params![old_key, new_key],
        )?;

        // skill_targets has UNIQUE(skill_id, tool). Same strategy: keep existing new-key rows.
        conn.execute(
            "DELETE FROM skill_targets AS old_rows
             WHERE old_rows.tool = ?1
               AND EXISTS (
                 SELECT 1
                 FROM skill_targets AS new_rows
                 WHERE new_rows.tool = ?2
                   AND new_rows.skill_id = old_rows.skill_id
               )",
            params![old_key, new_key],
        )?;
        conn.execute(
            "UPDATE skill_targets SET tool = ?2 WHERE tool = ?1",
            params![old_key, new_key],
        )?;

        conn.execute(
            "UPDATE discovered_skills SET tool = ?2 WHERE tool = ?1",
            params![old_key, new_key],
        )?;
        Ok(())
    }

    pub fn has_tool_key_references(&self, key: &str) -> Result<bool> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT EXISTS(SELECT 1 FROM skill_targets WHERE tool = ?1)
             OR EXISTS(SELECT 1 FROM discovered_skills WHERE tool = ?1)
             OR EXISTS(SELECT 1 FROM scenario_skill_tools WHERE tool = ?1)",
        )?;
        let exists: i64 = stmt.query_row(params![key], |row| row.get(0))?;
        Ok(exists != 0)
    }

    // ── Scenarios ──

    pub fn insert_scenario(&self, scenario: &ScenarioRecord) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO scenarios (id, name, description, icon, sort_order, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                scenario.id,
                scenario.name,
                scenario.description,
                scenario.icon,
                scenario.sort_order,
                scenario.created_at,
                scenario.updated_at,
            ],
        )?;
        Ok(())
    }

    pub fn get_all_scenarios(&self) -> Result<Vec<ScenarioRecord>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, description, icon, sort_order, created_at, updated_at FROM scenarios ORDER BY sort_order, created_at",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(ScenarioRecord {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                icon: row.get(3)?,
                sort_order: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    pub fn update_scenario(
        &self,
        id: &str,
        name: &str,
        description: Option<&str>,
        icon: Option<&str>,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "UPDATE scenarios SET name = ?1, description = ?2, icon = ?3, updated_at = ?4 WHERE id = ?5",
            params![name, description, icon, now, id],
        )?;
        Ok(())
    }

    pub fn delete_scenario(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM scenarios WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn reorder_scenarios(&self, ids: &[String]) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let tx = conn.unchecked_transaction()?;
        for (i, id) in ids.iter().enumerate() {
            tx.execute(
                "UPDATE scenarios SET sort_order = ?1 WHERE id = ?2",
                params![i as i32, id],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn reorder_projects(&self, ids: &[String]) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let tx = conn.unchecked_transaction()?;
        for (i, id) in ids.iter().enumerate() {
            tx.execute(
                "UPDATE projects SET sort_order = ?1 WHERE id = ?2",
                params![i as i32, id],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    // ── Scenario-Skill mapping ──

    pub fn add_skill_to_scenario(&self, scenario_id: &str, skill_id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "INSERT OR IGNORE INTO scenario_skills (scenario_id, skill_id, added_at) VALUES (?1, ?2, ?3)",
            params![scenario_id, skill_id, now],
        )?;
        Ok(())
    }

    pub fn remove_skill_from_scenario(&self, scenario_id: &str, skill_id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM scenario_skills WHERE scenario_id = ?1 AND skill_id = ?2",
            params![scenario_id, skill_id],
        )?;
        Ok(())
    }

    pub fn reorder_scenario_skills(&self, scenario_id: &str, skill_ids: &[String]) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let tx = conn.unchecked_transaction()?;
        for (i, skill_id) in skill_ids.iter().enumerate() {
            tx.execute(
                "UPDATE scenario_skills SET sort_order = ?1 WHERE scenario_id = ?2 AND skill_id = ?3",
                params![i as i32, scenario_id, skill_id],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn get_skill_ids_for_scenario(&self, scenario_id: &str) -> Result<Vec<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT skill_id FROM scenario_skills WHERE scenario_id = ?1 ORDER BY sort_order, added_at",
        )?;
        let rows = stmt.query_map(params![scenario_id], |row| row.get::<_, String>(0))?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    pub fn get_skills_for_scenario(&self, scenario_id: &str) -> Result<Vec<SkillRecord>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT s.id, s.name, s.description, s.source_type, s.source_ref, s.source_ref_resolved, s.source_subpath,
                    s.source_branch, s.source_revision, s.remote_revision, s.central_path, s.content_hash, s.enabled,
                    s.created_at, s.updated_at, s.status, s.update_status, s.last_checked_at, s.last_check_error
             FROM skills s
             INNER JOIN scenario_skills ss ON s.id = ss.skill_id
             WHERE ss.scenario_id = ?1
             ORDER BY ss.sort_order, s.name",
        )?;
        let rows = stmt.query_map(params![scenario_id], map_skill_row)?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    pub fn count_skills_for_scenario(&self, scenario_id: &str) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM scenario_skills WHERE scenario_id = ?1",
            params![scenario_id],
            |row| row.get(0),
        )?;
        Ok(count)
    }

    pub fn get_scenarios_for_skill(&self, skill_id: &str) -> Result<Vec<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt =
            conn.prepare("SELECT scenario_id FROM scenario_skills WHERE skill_id = ?1")?;
        let rows = stmt.query_map(params![skill_id], |row| row.get::<_, String>(0))?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn ensure_scenario_skill_tool_defaults(
        &self,
        scenario_id: &str,
        skill_id: &str,
        tools: &[String],
    ) -> Result<()> {
        if tools.is_empty() {
            return Ok(());
        }

        let conn = self.conn.lock().unwrap();
        let mut existing_stmt = conn.prepare(
            "SELECT tool
             FROM scenario_skill_tools
             WHERE scenario_id = ?1 AND skill_id = ?2",
        )?;
        let existing_rows = existing_stmt.query_map(params![scenario_id, skill_id], |row| {
            row.get::<_, String>(0)
        })?;
        let existing_tools: std::collections::HashSet<String> = existing_rows
            .collect::<rusqlite::Result<Vec<_>>>()?
            .into_iter()
            .collect();

        let missing_tools: Vec<&String> = tools
            .iter()
            .filter(|tool| !existing_tools.contains(*tool))
            .collect();
        if missing_tools.is_empty() {
            return Ok(());
        }

        let tx = conn.unchecked_transaction()?;
        let now = chrono::Utc::now().timestamp_millis();

        for tool in missing_tools {
            tx.execute(
                "INSERT OR IGNORE INTO scenario_skill_tools (scenario_id, skill_id, tool, enabled, updated_at)
                 VALUES (?1, ?2, ?3, 1, ?4)",
                params![scenario_id, skill_id, tool, now],
            )?;
        }

        tx.commit()?;
        Ok(())
    }

    pub fn set_scenario_skill_tool_enabled(
        &self,
        scenario_id: &str,
        skill_id: &str,
        tool: &str,
        enabled: bool,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "INSERT INTO scenario_skill_tools (scenario_id, skill_id, tool, enabled, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(scenario_id, skill_id, tool)
             DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at",
            params![scenario_id, skill_id, tool, enabled, now],
        )?;
        Ok(())
    }

    pub fn replace_scenarios_from_metadata(
        &self,
        scenarios: &[super::sync_metadata::ScenarioMetaFile],
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let tx = conn.unchecked_transaction()?;
        let metadata_ids: std::collections::HashSet<&str> =
            scenarios.iter().map(|s| s.scenario_id.as_str()).collect();
        {
            let mut stmt = tx.prepare("SELECT id FROM scenarios")?;
            let ids = stmt
                .query_map([], |row| row.get::<_, String>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            for id in ids {
                if !metadata_ids.contains(id.as_str()) {
                    tx.execute("DELETE FROM scenarios WHERE id = ?1", params![id])?;
                }
            }
        }
        let now = chrono::Utc::now().timestamp_millis();
        for scenario in scenarios {
            tx.execute(
                "INSERT INTO scenarios (id, name, description, icon, sort_order, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
                 ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    description = excluded.description,
                    icon = excluded.icon,
                    sort_order = excluded.sort_order,
                    updated_at = excluded.updated_at",
                params![
                    scenario.scenario_id,
                    scenario.name,
                    scenario.description,
                    scenario.icon,
                    scenario.sort_order,
                    now,
                ],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn replace_scenario_memberships_from_metadata(
        &self,
        memberships: &[super::sync_metadata::ScenarioSkillMetaFile],
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let tx = conn.unchecked_transaction()?;
        tx.execute("DELETE FROM scenario_skill_tools", [])?;
        tx.execute("DELETE FROM scenario_skills", [])?;

        // OR IGNORE / OR REPLACE don't suppress FK violations in SQLite, so we
        // must skip memberships that reference skills or scenarios no longer in the DB.
        let valid_skill_ids: std::collections::HashSet<String> = {
            let mut stmt = tx.prepare("SELECT id FROM skills")?;
            let ids: rusqlite::Result<std::collections::HashSet<String>> =
                stmt.query_map([], |row| row.get::<_, String>(0))?.collect();
            ids?
        };
        let valid_scenario_ids: std::collections::HashSet<String> = {
            let mut stmt = tx.prepare("SELECT id FROM scenarios")?;
            let ids: rusqlite::Result<std::collections::HashSet<String>> =
                stmt.query_map([], |row| row.get::<_, String>(0))?.collect();
            ids?
        };

        let now = chrono::Utc::now().timestamp_millis();
        for member in memberships {
            if !valid_skill_ids.contains(&member.skill_id)
                || !valid_scenario_ids.contains(&member.scenario_id)
            {
                log::warn!(
                    "Skipping stale scenario membership (scenario_id={}, skill_id={}): referenced skill or scenario no longer exists",
                    member.scenario_id,
                    member.skill_id
                );
                continue;
            }
            tx.execute(
                "INSERT OR IGNORE INTO scenario_skills (scenario_id, skill_id, added_at, sort_order)
                 VALUES (?1, ?2, ?3, ?4)",
                params![
                    member.scenario_id,
                    member.skill_id,
                    now,
                    member.sort_order,
                ],
            )?;
            for (tool, enabled) in &member.tools {
                tx.execute(
                    "INSERT OR REPLACE INTO scenario_skill_tools (scenario_id, skill_id, tool, enabled, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![
                        member.scenario_id,
                        member.skill_id,
                        tool,
                        enabled,
                        now,
                    ],
                )?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    pub fn get_scenario_skill_tool_toggles(
        &self,
        scenario_id: &str,
        skill_id: &str,
    ) -> Result<Vec<ScenarioSkillToolToggleRecord>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT scenario_id, skill_id, tool, enabled, updated_at
             FROM scenario_skill_tools
             WHERE scenario_id = ?1 AND skill_id = ?2
             ORDER BY tool",
        )?;
        let rows = stmt.query_map(params![scenario_id, skill_id], |row| {
            Ok(ScenarioSkillToolToggleRecord {
                scenario_id: row.get(0)?,
                skill_id: row.get(1)?,
                tool: row.get(2)?,
                enabled: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn get_enabled_tools_for_scenario_skill(
        &self,
        scenario_id: &str,
        skill_id: &str,
    ) -> Result<Vec<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT tool
             FROM scenario_skill_tools
             WHERE scenario_id = ?1 AND skill_id = ?2 AND enabled = 1",
        )?;
        let rows = stmt.query_map(params![scenario_id, skill_id], |row| {
            row.get::<_, String>(0)
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    // ── Active Scenario ──

    pub fn get_active_scenario_id(&self) -> Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt =
            conn.prepare("SELECT scenario_id FROM active_scenario WHERE key = 'current'")?;
        let mut rows = stmt.query_map([], |row| row.get::<_, Option<String>>(0))?;
        Ok(rows.next().and_then(|r| r.ok()).flatten())
    }

    pub fn clear_active_scenario(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM active_scenario WHERE key = 'current'", [])?;
        Ok(())
    }

    pub fn set_active_scenario(&self, scenario_id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO active_scenario (key, scenario_id) VALUES ('current', ?1)",
            params![scenario_id],
        )?;
        Ok(())
    }

    // ── Projects ──

    pub fn insert_project(&self, project: &ProjectRecord) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO projects (
                id, name, path, workspace_type, linked_agent_key, linked_agent_name, disabled_path,
                sort_order, created_at, updated_at
             )
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                project.id,
                project.name,
                project.path,
                project.workspace_type,
                project.linked_agent_key,
                project.linked_agent_name,
                project.disabled_path,
                project.sort_order,
                project.created_at,
                project.updated_at,
            ],
        )?;
        Ok(())
    }

    pub fn get_all_projects(&self) -> Result<Vec<ProjectRecord>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, path, workspace_type, linked_agent_key, linked_agent_name, disabled_path,
                    sort_order, created_at, updated_at
             FROM projects
             ORDER BY sort_order, created_at",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(ProjectRecord {
                id: row.get(0)?,
                name: row.get(1)?,
                path: row.get(2)?,
                workspace_type: row.get(3)?,
                linked_agent_key: row.get(4)?,
                linked_agent_name: row.get(5)?,
                disabled_path: row.get(6)?,
                sort_order: row.get(7)?,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
            })
        })?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    pub fn get_project_by_id(&self, id: &str) -> Result<Option<ProjectRecord>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, path, workspace_type, linked_agent_key, linked_agent_name, disabled_path,
                    sort_order, created_at, updated_at
             FROM projects
             WHERE id = ?1",
        )?;
        let mut rows = stmt.query_map(params![id], |row| {
            Ok(ProjectRecord {
                id: row.get(0)?,
                name: row.get(1)?,
                path: row.get(2)?,
                workspace_type: row.get(3)?,
                linked_agent_key: row.get(4)?,
                linked_agent_name: row.get(5)?,
                disabled_path: row.get(6)?,
                sort_order: row.get(7)?,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
            })
        })?;
        Ok(rows.next().and_then(|r| r.ok()))
    }

    pub fn delete_project(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM projects WHERE id = ?1", params![id])?;
        Ok(())
    }

    // ── Skill Tags ──

    pub fn get_all_tags(&self) -> Result<Vec<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT DISTINCT tag FROM skill_tags ORDER BY tag")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    pub fn set_tags_for_skill(&self, skill_id: &str, tags: &[String]) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        Self::set_tags_on_connection(&conn, skill_id, tags)
    }

    fn set_tags_on_connection(conn: &Connection, skill_id: &str, tags: &[String]) -> Result<()> {
        conn.execute(
            "DELETE FROM skill_tags WHERE skill_id = ?1",
            params![skill_id],
        )?;
        for tag in tags {
            let trimmed = tag.trim();
            if !trimmed.is_empty() {
                conn.execute(
                    "INSERT OR IGNORE INTO skill_tags (skill_id, tag) VALUES (?1, ?2)",
                    params![skill_id, trimmed],
                )?;
            }
        }
        Ok(())
    }

    pub fn get_tags_map(&self) -> Result<std::collections::HashMap<String, Vec<String>>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT skill_id, tag FROM skill_tags ORDER BY tag")?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        let mut map: std::collections::HashMap<String, Vec<String>> =
            std::collections::HashMap::new();
        for row in rows.filter_map(|r| r.ok()) {
            map.entry(row.0).or_default().push(row.1);
        }
        Ok(map)
    }

    /// Globally rename a tag across every skill that carries it. Returns the
    /// ids of the affected skills so the caller can refresh their metadata.
    /// If a skill already has `new`, the rows are merged (no duplicate) thanks
    /// to `UPDATE OR IGNORE` followed by removing any leftover old rows.
    pub fn rename_tag(&self, old: &str, new: &str) -> Result<Vec<String>> {
        let conn = self.conn.lock().unwrap();
        let affected: Vec<String> = {
            let mut stmt =
                conn.prepare("SELECT DISTINCT skill_id FROM skill_tags WHERE tag = ?1")?;
            let rows = stmt.query_map(params![old], |row| row.get::<_, String>(0))?;
            rows.filter_map(|r| r.ok()).collect()
        };
        // Guard self-rename: the cleanup DELETE below would otherwise wipe the
        // tag entirely (the UPDATE is a no-op when old == new).
        if old == new {
            return Ok(affected);
        }
        // One transaction so a crash can't leave the tag half-renamed (the
        // non-conflicting rows updated while merged rows still hold `old`).
        let tx = conn.unchecked_transaction()?;
        tx.execute(
            "UPDATE OR IGNORE skill_tags SET tag = ?1 WHERE tag = ?2",
            params![new, old],
        )?;
        tx.execute("DELETE FROM skill_tags WHERE tag = ?1", params![old])?;
        tx.commit()?;
        Ok(affected)
    }

    /// Globally remove a tag from every skill that carries it. Returns the ids
    /// of the affected skills so the caller can refresh their metadata.
    pub fn delete_tag(&self, name: &str) -> Result<Vec<String>> {
        let conn = self.conn.lock().unwrap();
        let affected: Vec<String> = {
            let mut stmt =
                conn.prepare("SELECT DISTINCT skill_id FROM skill_tags WHERE tag = ?1")?;
            let rows = stmt.query_map(params![name], |row| row.get::<_, String>(0))?;
            rows.filter_map(|r| r.ok()).collect()
        };
        conn.execute("DELETE FROM skill_tags WHERE tag = ?1", params![name])?;
        Ok(affected)
    }

    // ── Audit log ──

    /// Append an audit entry. Best-effort: errors are swallowed so callers
    /// never have to wrap or propagate them. Auto-prunes when the table
    /// grows beyond AUDIT_MAX_ENTRIES.
    pub fn log_audit(&self, draft: AuditDraft) {
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);

        let conn = match self.conn.lock() {
            Ok(c) => c,
            Err(_) => return,
        };
        let insert = conn.execute(
            "INSERT INTO audit_log (ts, action, skill_id, skill_name, tool, success, detail)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                ts,
                draft.action,
                draft.skill_id,
                draft.skill_name,
                draft.tool,
                draft.success as i32,
                draft.detail,
            ],
        );
        if insert.is_err() {
            return;
        }
        // Prune to MAX_ENTRIES newest. Cheap when under the cap (DELETE matches 0 rows).
        let _ = conn.execute(
            "DELETE FROM audit_log WHERE id IN (
                 SELECT id FROM audit_log ORDER BY id DESC LIMIT -1 OFFSET ?1
             )",
            params![AUDIT_MAX_ENTRIES],
        );
    }

    /// Read the most recent audit entries (newest first). When `limit` is
    /// `None`, returns everything.
    pub fn list_audit(&self, limit: Option<i64>) -> Result<Vec<AuditEntry>> {
        let conn = self.conn.lock().unwrap();
        let sql = if limit.is_some() {
            "SELECT id, ts, action, skill_id, skill_name, tool, success, detail
             FROM audit_log ORDER BY id DESC LIMIT ?1"
        } else {
            "SELECT id, ts, action, skill_id, skill_name, tool, success, detail
             FROM audit_log ORDER BY id DESC"
        };
        let mut stmt = conn.prepare(sql)?;
        let map_row = |row: &rusqlite::Row<'_>| -> rusqlite::Result<AuditEntry> {
            Ok(AuditEntry {
                id: row.get(0)?,
                ts: row.get(1)?,
                action: row.get(2)?,
                skill_id: row.get(3)?,
                skill_name: row.get(4)?,
                tool: row.get(5)?,
                success: row.get::<_, i32>(6)? != 0,
                detail: row.get(7)?,
            })
        };
        let rows = if let Some(n) = limit {
            stmt.query_map(params![n], map_row)?
                .collect::<rusqlite::Result<Vec<_>>>()?
        } else {
            stmt.query_map([], map_row)?
                .collect::<rusqlite::Result<Vec<_>>>()?
        };
        Ok(rows)
    }
}

fn read_setting_raw(conn: &Connection, key: &str) -> Result<Option<String>> {
    let mut stmt = conn.prepare("SELECT value FROM settings WHERE key = ?1")?;
    let mut rows = stmt.query_map(params![key], |row| row.get::<_, String>(0))?;
    Ok(rows.next().transpose()?)
}

fn write_setting_raw(conn: &Connection, key: &str, value: Option<&str>) -> Result<()> {
    if let Some(value) = value {
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
            params![key, value],
        )?;
    } else {
        conn.execute("DELETE FROM settings WHERE key = ?1", params![key])?;
    }
    Ok(())
}

fn read_skill_relationship_state(
    conn: &Connection,
    skill_id: &str,
) -> Result<OrganizationSkillRelationshipState> {
    let scenarios = {
        let mut stmt = conn.prepare(
            "SELECT scenario_id, added_at, sort_order FROM scenario_skills
             WHERE skill_id = ?1 ORDER BY scenario_id",
        )?;
        let rows = stmt.query_map(params![skill_id], |row| {
            Ok(OrganizationScenarioSkillRelationship {
                scenario_id: row.get(0)?,
                added_at: row.get(1)?,
                sort_order: row.get(2)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
        rows
    };
    let scenario_tools = {
        let mut stmt = conn.prepare(
            "SELECT scenario_id, tool, enabled, updated_at FROM scenario_skill_tools
             WHERE skill_id = ?1 ORDER BY scenario_id, tool",
        )?;
        let rows = stmt.query_map(params![skill_id], |row| {
            Ok(OrganizationScenarioToolRelationship {
                scenario_id: row.get(0)?,
                tool: row.get(1)?,
                enabled: row.get::<_, i64>(2)? != 0,
                updated_at: row.get(3)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
        rows
    };
    let tags = {
        let mut stmt =
            conn.prepare("SELECT tag FROM skill_tags WHERE skill_id = ?1 ORDER BY tag")?;
        let rows = stmt
            .query_map(params![skill_id], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        rows
    };
    Ok(OrganizationSkillRelationshipState {
        scenarios,
        scenario_tools,
        tags,
    })
}

fn merge_skill_relationship_states(
    keep: &OrganizationSkillRelationshipState,
    archive: &OrganizationSkillRelationshipState,
) -> OrganizationSkillRelationshipState {
    let mut scenarios = keep.scenarios.clone();
    for relationship in &archive.scenarios {
        if !scenarios
            .iter()
            .any(|existing| existing.scenario_id == relationship.scenario_id)
        {
            scenarios.push(relationship.clone());
        }
    }
    scenarios.sort_by(|a, b| a.scenario_id.cmp(&b.scenario_id));

    let mut scenario_tools = keep.scenario_tools.clone();
    for relationship in &archive.scenario_tools {
        if let Some(existing) = scenario_tools.iter_mut().find(|existing| {
            existing.scenario_id == relationship.scenario_id
                && existing.tool == relationship.tool
        }) {
            existing.enabled |= relationship.enabled;
            existing.updated_at = existing.updated_at.max(relationship.updated_at);
        } else {
            scenario_tools.push(relationship.clone());
        }
    }
    scenario_tools.sort_by(|a, b| {
        (&a.scenario_id, &a.tool).cmp(&(&b.scenario_id, &b.tool))
    });

    let mut tags = keep.tags.clone();
    for tag in &archive.tags {
        if !tags.contains(tag) {
            tags.push(tag.clone());
        }
    }
    tags.sort();
    OrganizationSkillRelationshipState {
        scenarios,
        scenario_tools,
        tags,
    }
}

fn replace_skill_relationship_state(
    conn: &Connection,
    skill_id: &str,
    state: &OrganizationSkillRelationshipState,
) -> Result<()> {
    conn.execute(
        "DELETE FROM scenario_skill_tools WHERE skill_id = ?1",
        params![skill_id],
    )?;
    conn.execute(
        "DELETE FROM scenario_skills WHERE skill_id = ?1",
        params![skill_id],
    )?;
    conn.execute(
        "DELETE FROM skill_tags WHERE skill_id = ?1",
        params![skill_id],
    )?;
    for relationship in &state.scenarios {
        conn.execute(
            "INSERT INTO scenario_skills (scenario_id, skill_id, added_at, sort_order)
             VALUES (?1, ?2, ?3, ?4)",
            params![
                relationship.scenario_id,
                skill_id,
                relationship.added_at,
                relationship.sort_order
            ],
        )?;
    }
    for relationship in &state.scenario_tools {
        conn.execute(
            "INSERT INTO scenario_skill_tools
                (scenario_id, skill_id, tool, enabled, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                relationship.scenario_id,
                skill_id,
                relationship.tool,
                relationship.enabled,
                relationship.updated_at
            ],
        )?;
    }
    for tag in &state.tags {
        conn.execute(
            "INSERT INTO skill_tags (skill_id, tag) VALUES (?1, ?2)",
            params![skill_id, tag],
        )?;
    }
    Ok(())
}

fn assert_relationship_migration_state(
    conn: &Connection,
    migration: &OrganizationRelationshipMigrationPlan,
    applied: bool,
) -> Result<()> {
    let (expected_keep, expected_archive, expected_custom, expected_overrides) = if applied {
        (
            &migration.after_keep,
            &migration.after_archive,
            &migration.after_custom_decks,
            &migration.after_deck_overrides,
        )
    } else {
        (
            &migration.before_keep,
            &migration.before_archive,
            &migration.before_custom_decks,
            &migration.before_deck_overrides,
        )
    };
    if read_skill_relationship_state(conn, &migration.keep_skill_id)? != *expected_keep
        || read_skill_relationship_state(conn, &migration.archive_skill_id)? != *expected_archive
        || read_setting_raw(conn, "card_master_custom_decks_v1")? != *expected_custom
        || read_setting_raw(conn, "card_master_deck_overrides_v1")? != *expected_overrides
    {
        anyhow::bail!("Skill relationships changed; refresh before applying this operation");
    }
    Ok(())
}

fn write_relationship_migration_state(
    conn: &Connection,
    migration: &OrganizationRelationshipMigrationPlan,
    applied: bool,
) -> Result<()> {
    let (keep, archive, custom, overrides) = if applied {
        (
            &migration.after_keep,
            &migration.after_archive,
            migration.after_custom_decks.as_deref(),
            migration.after_deck_overrides.as_deref(),
        )
    } else {
        (
            &migration.before_keep,
            &migration.before_archive,
            migration.before_custom_decks.as_deref(),
            migration.before_deck_overrides.as_deref(),
        )
    };
    replace_skill_relationship_state(conn, &migration.keep_skill_id, keep)?;
    replace_skill_relationship_state(conn, &migration.archive_skill_id, archive)?;
    write_setting_raw(conn, "card_master_custom_decks_v1", custom)?;
    write_setting_raw(conn, "card_master_deck_overrides_v1", overrides)?;
    Ok(())
}

fn rewrite_custom_deck_relationships(
    raw: Option<&str>,
    keep_skill_id: &str,
    archive_skill_id: &str,
) -> Result<Option<String>> {
    let Some(raw) = raw else { return Ok(None) };
    let mut value: serde_json::Value = serde_json::from_str(raw)?;
    let decks = value
        .as_array_mut()
        .ok_or_else(|| anyhow::anyhow!("Custom deck data is not an array"))?;
    let mut changed = false;
    for deck in decks {
        let Some(cards) = deck.get_mut("cards").and_then(|cards| cards.as_array_mut()) else {
            continue;
        };
        let mut keep_seen = cards.iter().any(|card| {
            card.get("skill_id").and_then(|id| id.as_str()) == Some(keep_skill_id)
        });
        let mut rewritten = Vec::with_capacity(cards.len());
        for mut card in std::mem::take(cards) {
            if card.get("skill_id").and_then(|id| id.as_str()) == Some(archive_skill_id) {
                changed = true;
                if keep_seen {
                    continue;
                }
                let object = card
                    .as_object_mut()
                    .ok_or_else(|| anyhow::anyhow!("Custom deck card is not an object"))?;
                object.insert(
                    "skill_id".to_string(),
                    serde_json::Value::String(keep_skill_id.to_string()),
                );
                keep_seen = true;
            }
            rewritten.push(card);
        }
        *cards = rewritten;
    }
    if changed {
        Ok(Some(serde_json::to_string(&value)?))
    } else {
        Ok(Some(raw.to_string()))
    }
}

fn rewrite_deck_override_relationships(
    raw: Option<&str>,
    keep_skill_id: &str,
    archive_skill_id: &str,
) -> Result<Option<String>> {
    let Some(raw) = raw else { return Ok(None) };
    let mut value: serde_json::Value = serde_json::from_str(raw)?;
    let overrides = value
        .as_object_mut()
        .ok_or_else(|| anyhow::anyhow!("Deck override data is not an object"))?;
    let mut changed = false;
    for deck in overrides.values_mut() {
        if let Some(removed) = deck
            .get_mut("removedSkillIds")
            .and_then(|items| items.as_array_mut())
        {
            let mut keep_seen = removed.iter().any(|id| id.as_str() == Some(keep_skill_id));
            let mut rewritten = Vec::with_capacity(removed.len());
            for id in std::mem::take(removed) {
                if id.as_str() == Some(archive_skill_id) {
                    changed = true;
                    if keep_seen {
                        continue;
                    }
                    rewritten.push(serde_json::Value::String(keep_skill_id.to_string()));
                    keep_seen = true;
                } else {
                    rewritten.push(id);
                }
            }
            *removed = rewritten;
        }
        if let Some(added) = deck
            .get_mut("addedSkills")
            .and_then(|items| items.as_array_mut())
        {
            let mut keep_seen = added.iter().any(|item| {
                item.get("skillId").and_then(|id| id.as_str()) == Some(keep_skill_id)
            });
            let mut rewritten = Vec::with_capacity(added.len());
            for mut item in std::mem::take(added) {
                if item.get("skillId").and_then(|id| id.as_str()) == Some(archive_skill_id) {
                    changed = true;
                    if keep_seen {
                        continue;
                    }
                    let object = item
                        .as_object_mut()
                        .ok_or_else(|| anyhow::anyhow!("Deck override entry is not an object"))?;
                    object.insert(
                        "skillId".to_string(),
                        serde_json::Value::String(keep_skill_id.to_string()),
                    );
                    keep_seen = true;
                }
                rewritten.push(item);
            }
            *added = rewritten;
        }
        let keep_is_explicitly_added = deck
            .get("addedSkills")
            .and_then(|items| items.as_array())
            .into_iter()
            .flatten()
            .any(|item| {
                item.get("skillId").and_then(|id| id.as_str()) == Some(keep_skill_id)
            });
        if keep_is_explicitly_added {
            if let Some(removed) = deck
                .get_mut("removedSkillIds")
                .and_then(|items| items.as_array_mut())
            {
                let previous_len = removed.len();
                removed.retain(|id| id.as_str() != Some(keep_skill_id));
                changed |= removed.len() != previous_len;
            }
        }
    }
    if changed {
        Ok(Some(serde_json::to_string(&value)?))
    } else {
        Ok(Some(raw.to_string()))
    }
}

#[cfg(test)]
mod organization_fact_tests {
    use super::*;
    use tempfile::tempdir;

    fn skill() -> SkillRecord {
        SkillRecord {
            id: "skill-1".to_string(),
            name: "old-name".to_string(),
            description: Some("old description".to_string()),
            source_type: "import".to_string(),
            source_ref: Some("/external/source".to_string()),
            source_ref_resolved: None,
            source_subpath: None,
            source_branch: None,
            source_revision: None,
            remote_revision: None,
            central_path: "/central/skill-1".to_string(),
            content_hash: Some("old-hash".to_string()),
            enabled: true,
            created_at: 1,
            updated_at: 42,
            status: "ok".to_string(),
            update_status: "update_available".to_string(),
            last_checked_at: None,
            last_check_error: None,
        }
    }

    #[test]
    fn refresh_skill_facts_is_noop_for_unchanged_snapshot_and_preserves_source_state() {
        let tmp = tempdir().unwrap();
        let store = SkillStore::new(&tmp.path().join("test.db")).unwrap();
        store.insert_skill(&skill()).unwrap();

        store
            .refresh_skill_facts(
                "skill-1",
                "old-name",
                Some("old description"),
                Some("old-hash"),
                "ok",
            )
            .unwrap();
        let unchanged = store.get_skill_by_id("skill-1").unwrap().unwrap();
        assert_eq!(unchanged.updated_at, 42);

        store
            .refresh_skill_facts(
                "skill-1",
                "new-name",
                Some("new description"),
                Some("new-hash"),
                "ok",
            )
            .unwrap();
        let refreshed = store.get_skill_by_id("skill-1").unwrap().unwrap();
        assert_eq!(refreshed.name, "new-name");
        assert_eq!(refreshed.content_hash.as_deref(), Some("new-hash"));
        assert!(refreshed.updated_at > 42);
        assert_eq!(refreshed.source_ref.as_deref(), Some("/external/source"));
        assert_eq!(refreshed.update_status, "update_available");
    }
}

#[cfg(test)]
mod audit_log_tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn log_audit_appends_and_lists_newest_first() {
        let tmp = tempdir().unwrap();
        let store = SkillStore::new(&tmp.path().join("test.db")).unwrap();

        store.log_audit(AuditDraft::new("install").skill("id1", "first").ok());
        store.log_audit(AuditDraft::new("install").skill("id2", "second").ok());
        store.log_audit(
            AuditDraft::new("remove")
                .skill("id1", "first")
                .fail("missing"),
        );

        let entries = store.list_audit(None).unwrap();
        assert_eq!(entries.len(), 3);
        // Newest first
        assert_eq!(entries[0].action, "remove");
        assert!(!entries[0].success);
        assert_eq!(entries[0].detail.as_deref(), Some("missing"));
        assert_eq!(entries[2].action, "install");
        assert_eq!(entries[2].skill_name.as_deref(), Some("first"));
    }

    #[test]
    fn log_audit_respects_limit() {
        let tmp = tempdir().unwrap();
        let store = SkillStore::new(&tmp.path().join("test.db")).unwrap();
        for i in 0..5 {
            store.log_audit(AuditDraft::new("sync").detail(format!("{i}")).ok());
        }
        let entries = store.list_audit(Some(2)).unwrap();
        assert_eq!(entries.len(), 2);
        // Newest first — latest detail is "4".
        assert_eq!(entries[0].detail.as_deref(), Some("4"));
    }
}

#[cfg(test)]
mod scenario_membership_tests {
    use super::*;
    use crate::core::sync_metadata::ScenarioSkillMetaFile;
    use std::collections::BTreeMap;
    use tempfile::tempdir;

    fn sample_skill(id: &str) -> SkillRecord {
        SkillRecord {
            id: id.to_string(),
            name: id.to_string(),
            description: None,
            source_type: "import".to_string(),
            source_ref: None,
            source_ref_resolved: None,
            source_subpath: None,
            source_branch: None,
            source_revision: None,
            remote_revision: None,
            central_path: format!("/tmp/{id}"),
            content_hash: None,
            enabled: true,
            created_at: 1,
            updated_at: 1,
            status: "ok".to_string(),
            update_status: "local_only".to_string(),
            last_checked_at: None,
            last_check_error: None,
        }
    }

    fn membership(scenario_id: &str, skill_id: &str) -> ScenarioSkillMetaFile {
        let mut tools = BTreeMap::new();
        tools.insert("ToolA".to_string(), true);
        ScenarioSkillMetaFile {
            schema_version: 1,
            scenario_id: scenario_id.to_string(),
            skill_id: skill_id.to_string(),
            sort_order: 0,
            tools,
        }
    }

    #[test]
    fn skips_memberships_referencing_missing_skill_or_scenario() {
        let tmp = tempdir().unwrap();
        let store = SkillStore::new(&tmp.path().join("test.db")).unwrap();

        store
            .insert_scenario(&ScenarioRecord {
                id: "s1".to_string(),
                name: "S1".to_string(),
                description: None,
                icon: None,
                sort_order: 0,
                created_at: 1,
                updated_at: 1,
            })
            .unwrap();
        store.upsert_skill(&sample_skill("k1")).unwrap();

        let memberships = vec![
            membership("s1", "k1"),      // valid
            membership("s1", "ghost"),   // skill missing
            membership("ghost-s", "k1"), // scenario missing
        ];

        // Must not panic with a FOREIGN KEY constraint failure.
        store
            .replace_scenario_memberships_from_metadata(&memberships)
            .unwrap();

        assert_eq!(store.get_skill_ids_for_scenario("s1").unwrap(), vec!["k1"]);
        assert_eq!(
            store
                .get_enabled_tools_for_scenario_skill("s1", "k1")
                .unwrap(),
            vec!["ToolA"]
        );
        assert!(store
            .get_enabled_tools_for_scenario_skill("ghost-s", "k1")
            .unwrap()
            .is_empty());
    }
}

const DISCOVERED_INSERT_SQL: &str = "
    INSERT INTO discovered_skills (
        id, tool, found_path, name_guess, fingerprint, found_at, imported_skill_id,
        source_kind, owner_ref, discovery_source_ref, discovery_source_version,
        discovery_source_revision, discovery_source_subpath, declared_repository,
        provenance_basis, digest_algorithm, content_error
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)";

fn insert_discovered_row(conn: &Connection, record: &DiscoveredSkillRecord) -> Result<()> {
    let mut stmt = conn.prepare(DISCOVERED_INSERT_SQL)?;
    execute_discovered_insert(&mut stmt, record)?;
    Ok(())
}

fn execute_discovered_insert(
    stmt: &mut rusqlite::Statement<'_>,
    record: &DiscoveredSkillRecord,
) -> rusqlite::Result<usize> {
    let provenance = record.provenance.as_ref();
    stmt.execute(params![
        record.id,
        record.tool,
        record.found_path,
        record.name_guess,
        record.fingerprint,
        record.found_at,
        record.imported_skill_id,
        provenance.map(|value| value.source_kind.as_str()),
        provenance.map(|value| value.owner_ref.as_str()),
        provenance.map(|value| value.source_ref.as_str()),
        provenance.and_then(|value| value.source_version.as_deref()),
        provenance.and_then(|value| value.source_revision.as_deref()),
        provenance.and_then(|value| value.source_subpath.as_deref()),
        provenance.and_then(|value| value.declared_repository.as_deref()),
        provenance.map(|value| value.provenance_basis.as_str()),
        provenance.map(|value| value.digest_algorithm.as_str()),
        record.content_error,
    ])
}

fn discovered_decode_error(index: usize, message: impl Into<String>) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(
        index,
        rusqlite::types::Type::Text,
        Box::new(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            message.into(),
        )),
    )
}

fn map_discovered_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<DiscoveredSkillRecord> {
    let source_kind: Option<String> = row.get(7)?;
    let owner_ref: Option<String> = row.get(8)?;
    let source_ref: Option<String> = row.get(9)?;
    let source_version: Option<String> = row.get(10)?;
    let source_revision: Option<String> = row.get(11)?;
    let source_subpath: Option<String> = row.get(12)?;
    let declared_repository: Option<String> = row.get(13)?;
    let provenance_basis: Option<String> = row.get(14)?;
    let digest_algorithm: Option<String> = row.get(15)?;
    let any_provenance = source_kind.is_some()
        || owner_ref.is_some()
        || source_ref.is_some()
        || source_version.is_some()
        || source_revision.is_some()
        || source_subpath.is_some()
        || declared_repository.is_some()
        || provenance_basis.is_some()
        || digest_algorithm.is_some();
    let provenance = if any_provenance {
        let kind_text = source_kind
            .as_deref()
            .ok_or_else(|| discovered_decode_error(7, "provenance source_kind is missing"))?;
        let source_kind = DiscoverySourceKind::parse(kind_text).ok_or_else(|| {
            discovered_decode_error(7, format!("unknown provenance source_kind: {kind_text}"))
        })?;
        Some(DiscoveryProvenance {
            source_kind,
            owner_ref: owner_ref
                .ok_or_else(|| discovered_decode_error(8, "provenance owner_ref is missing"))?,
            source_ref: source_ref
                .ok_or_else(|| discovered_decode_error(9, "provenance source_ref is missing"))?,
            source_version,
            source_revision,
            source_subpath,
            declared_repository,
            provenance_basis: provenance_basis.ok_or_else(|| {
                discovered_decode_error(14, "provenance provenance_basis is missing")
            })?,
            digest_algorithm: digest_algorithm.ok_or_else(|| {
                discovered_decode_error(15, "provenance digest_algorithm is missing")
            })?,
        })
    } else {
        None
    };

    Ok(DiscoveredSkillRecord {
        id: row.get(0)?,
        tool: row.get(1)?,
        found_path: row.get(2)?,
        name_guess: row.get(3)?,
        fingerprint: row.get(4)?,
        found_at: row.get(5)?,
        imported_skill_id: row.get(6)?,
        provenance,
        content_error: row.get(16)?,
    })
}

#[cfg(test)]
mod discovered_snapshot_tests {
    use super::*;
    use crate::core::host_discovery::{DiscoveryProvenance, DiscoverySourceKind};
    use tempfile::tempdir;

    fn record(id: &str, owner: &str) -> DiscoveredSkillRecord {
        DiscoveredSkillRecord {
            id: id.to_string(),
            tool: "codex".to_string(),
            found_path: format!("/tmp/{id}"),
            name_guess: Some(id.to_string()),
            fingerprint: Some(format!("digest-{id}")),
            content_error: None,
            found_at: 42,
            imported_skill_id: None,
            provenance: Some(DiscoveryProvenance {
                source_kind: DiscoverySourceKind::CodexPlugin,
                owner_ref: owner.to_string(),
                source_ref: "/tmp/plugin".to_string(),
                source_version: Some("1.2.3".to_string()),
                source_revision: Some("rev-1".to_string()),
                source_subpath: Some(format!("skills/{id}")),
                declared_repository: Some("https://example.test/repo".to_string()),
                provenance_basis: "test".to_string(),
                digest_algorithm: "scm-dir-v2".to_string(),
            }),
        }
    }

    #[test]
    fn discovered_provenance_round_trips() {
        let tmp = tempdir().unwrap();
        let store = SkillStore::new(&tmp.path().join("test.db")).unwrap();
        let mut expected = record("alpha", "plugin@market");
        expected.fingerprint = None;
        expected.content_error = Some("content unavailable".to_string());
        store.insert_discovered(&expected).unwrap();
        let rows = store.get_all_discovered().unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, expected.id);
        assert_eq!(rows[0].provenance, expected.provenance);
        assert_eq!(rows[0].content_error, expected.content_error);
    }

    #[test]
    fn replace_discovered_commits_complete_snapshot() {
        let tmp = tempdir().unwrap();
        let store = SkillStore::new(&tmp.path().join("test.db")).unwrap();
        store
            .insert_discovered(&record("old", "old@market"))
            .unwrap();
        store
            .replace_discovered(&[record("alpha", "a@market"), record("beta", "b@market")])
            .unwrap();
        let ids = store
            .get_all_discovered()
            .unwrap()
            .into_iter()
            .map(|row| row.id)
            .collect::<Vec<_>>();
        assert_eq!(ids, vec!["alpha", "beta"]);
    }

    #[test]
    fn failed_replace_rolls_back_previous_snapshot() {
        let tmp = tempdir().unwrap();
        let store = SkillStore::new(&tmp.path().join("test.db")).unwrap();
        store
            .insert_discovered(&record("old", "old@market"))
            .unwrap();
        assert!(store
            .replace_discovered(&[
                record("duplicate", "a@market"),
                record("duplicate", "b@market"),
            ])
            .is_err());
        let rows = store.get_all_discovered().unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, "old");
    }

    #[test]
    fn partial_provenance_fails_strict_row_collection() {
        let tmp = tempdir().unwrap();
        let store = SkillStore::new(&tmp.path().join("test.db")).unwrap();
        {
            let conn = store.conn.lock().unwrap();
            conn.execute(
                "INSERT INTO discovered_skills
                 (id, tool, found_path, found_at, source_kind)
                 VALUES ('bad', 'codex', '/tmp/bad', 1, 'codex_plugin')",
                [],
            )
            .unwrap();
        }
        assert!(store.get_all_discovered().is_err());
    }
}

fn map_skill_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<SkillRecord> {
    Ok(SkillRecord {
        id: row.get(0)?,
        name: row.get(1)?,
        description: row.get(2)?,
        source_type: row.get(3)?,
        source_ref: row.get(4)?,
        source_ref_resolved: row.get(5)?,
        source_subpath: row.get(6)?,
        source_branch: row.get(7)?,
        source_revision: row.get(8)?,
        remote_revision: row.get(9)?,
        central_path: row.get(10)?,
        content_hash: row.get(11)?,
        enabled: row.get::<_, i32>(12)? != 0,
        created_at: row.get(13)?,
        updated_at: row.get(14)?,
        status: row.get(15)?,
        update_status: row.get(16)?,
        last_checked_at: row.get(17)?,
        last_check_error: row.get(18)?,
    })
}

#[cfg(test)]
mod organization_decision_tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn decision_round_trips_updates_and_clears() {
        let tmp = tempdir().unwrap();
        let store = SkillStore::new(&tmp.path().join("test.db")).unwrap();

        let first = store
            .set_organization_decision("name:docx", &"a".repeat(64), "related")
            .unwrap();
        assert_eq!(first.disposition, "related");
        assert_eq!(store.get_organization_decisions().unwrap().len(), 1);

        let updated = store
            .set_organization_decision("name:docx", &"b".repeat(64), "intentional_distinct")
            .unwrap();
        assert_eq!(updated.disposition, "intentional_distinct");
        assert_eq!(updated.decided_at, first.decided_at);
        let stored = store.get_organization_decisions().unwrap();
        assert_eq!(stored.len(), 1);
        assert_eq!(stored[0].evidence_fingerprint, "b".repeat(64));

        store.clear_organization_decision("name:docx").unwrap();
        assert!(store.get_organization_decisions().unwrap().is_empty());
    }
}

#[cfg(test)]
mod organization_agent_assessment_tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn validated_assessment_round_trips_and_replaces_same_evidence_key() {
        let tmp = tempdir().unwrap();
        let store = SkillStore::new(&tmp.path().join("test.db")).unwrap();
        store
            .upsert_organization_agent_assessment(
                "name:docx",
                "revision-1",
                "method-1",
                "codex",
                r#"{"confidence":0.7}"#,
            )
            .unwrap();
        store
            .upsert_organization_agent_assessment(
                "name:docx",
                "revision-1",
                "method-1",
                "codex",
                r#"{"confidence":0.9}"#,
            )
            .unwrap();

        let rows = store.get_organization_agent_assessments().unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].case_key, "name:docx");
        assert!(rows[0].payload_json.contains("0.9"));
    }
}

#[cfg(test)]
mod organization_operation_tests {
    use super::*;
    use tempfile::tempdir;

    fn skill(id: &str, path: &str) -> SkillRecord {
        SkillRecord {
            id: id.to_string(),
            name: "find-skills".to_string(),
            description: None,
            source_type: "import".to_string(),
            source_ref: None,
            source_ref_resolved: None,
            source_subpath: None,
            source_branch: None,
            source_revision: None,
            remote_revision: None,
            central_path: path.to_string(),
            content_hash: Some(format!("hash-{id}")),
            enabled: true,
            created_at: 1,
            updated_at: 1,
            status: "ok".to_string(),
            update_status: "local_only".to_string(),
            last_checked_at: None,
            last_check_error: None,
        }
    }

    #[test]
    fn archive_and_restore_round_trip_target_ownership() {
        let tmp = tempdir().unwrap();
        let store = SkillStore::new(&tmp.path().join("test.db")).unwrap();
        let keep = skill("keep", "/central/keep");
        let archived = skill("archive", "/central/archive");
        store.insert_skill(&keep).unwrap();
        store.insert_skill(&archived).unwrap();
        let original_target = SkillTargetRecord {
            id: "target-1".to_string(),
            skill_id: archived.id.clone(),
            tool: "codex".to_string(),
            target_path: "/agent/find-skills".to_string(),
            mode: "symlink".to_string(),
            status: "ok".to_string(),
            synced_at: Some(1),
            last_error: None,
            source_hash: archived.content_hash.clone(),
        };
        store.insert_target(&original_target).unwrap();
        let mut transferred = original_target.clone();
        transferred.skill_id = keep.id.clone();
        transferred.target_path = "/agent/find-skills-source".to_string();
        transferred.mode = "copy".to_string();
        transferred.source_hash = keep.content_hash.clone();

        store
            .mark_skill_archived(
                &archived.id,
                "/trash/archive",
                &[transferred],
                &[],
            )
            .unwrap();

        assert_eq!(store.get_all_skills().unwrap().len(), 1);
        let kept_targets = store.get_targets_for_skill(&keep.id).unwrap();
        assert_eq!(kept_targets.len(), 1);
        assert_eq!(kept_targets[0].target_path, "/agent/find-skills-source");
        assert_eq!(kept_targets[0].mode, "copy");
        assert_eq!(
            store.get_skill_by_id(&archived.id).unwrap().unwrap().status,
            "archived"
        );

        store
            .restore_archived_skill(
                &archived.id,
                &archived.central_path,
                archived.enabled,
                &archived.status,
                std::slice::from_ref(&original_target),
            )
            .unwrap();

        assert_eq!(store.get_all_skills().unwrap().len(), 2);
        assert!(store.get_targets_for_skill(&keep.id).unwrap().is_empty());
        assert_eq!(store.get_targets_for_skill(&archived.id).unwrap().len(), 1);
    }

    #[test]
    fn invalidating_copy_targets_preserves_symlink_freshness() {
        let tmp = tempdir().unwrap();
        let store = SkillStore::new(&tmp.path().join("test.db")).unwrap();
        let managed = skill("managed", "/central/managed");
        store.insert_skill(&managed).unwrap();
        for (id, mode) in [("copy-target", "copy"), ("symlink-target", "symlink")] {
            store
                .insert_target(&SkillTargetRecord {
                    id: id.to_string(),
                    skill_id: managed.id.clone(),
                    tool: id.to_string(),
                    target_path: format!("/agent/{id}"),
                    mode: mode.to_string(),
                    status: "ok".to_string(),
                    synced_at: Some(1),
                    last_error: None,
                    source_hash: Some("legacy-collision-prone-hash".to_string()),
                })
                .unwrap();
        }

        assert_eq!(store.invalidate_copy_target_source_hashes().unwrap(), 1);
        let targets = store.get_all_targets().unwrap();
        let copy = targets.iter().find(|target| target.mode == "copy").unwrap();
        let symlink = targets
            .iter()
            .find(|target| target.mode == "symlink")
            .unwrap();
        assert!(copy.source_hash.is_none());
        assert_eq!(
            symlink.source_hash.as_deref(),
            Some("legacy-collision-prone-hash")
        );
    }

    #[test]
    fn dependency_guard_detects_tags() {
        let tmp = tempdir().unwrap();
        let store = SkillStore::new(&tmp.path().join("test.db")).unwrap();
        let archived = skill("archive", "/central/archive");
        store.insert_skill(&archived).unwrap();
        assert!(!store
            .skill_has_organization_dependencies(&archived.id)
            .unwrap());
        store
            .set_tags_for_skill(&archived.id, &["research".to_string()])
            .unwrap();
        assert!(store
            .skill_has_organization_dependencies(&archived.id)
            .unwrap());
    }

    #[test]
    fn dependency_guard_detects_custom_and_overridden_decks() {
        let tmp = tempdir().unwrap();
        let store = SkillStore::new(&tmp.path().join("test.db")).unwrap();
        let custom = skill("custom-card", "/central/custom-card");
        let override_card = skill("override-card", "/central/override-card");
        store.insert_skill(&custom).unwrap();
        store.insert_skill(&override_card).unwrap();
        store
            .set_setting(
                "card_master_custom_decks_v1",
                r#"[{"cards":[{"skill_id":"custom-card"}]}]"#,
            )
            .unwrap();
        store
            .set_setting(
                "card_master_deck_overrides_v1",
                r#"{"vibe-coding":{"removedSkillIds":[],"addedSkills":[{"skillId":"override-card","stageId":"verify"}]}}"#,
            )
            .unwrap();

        assert!(store
            .skill_has_organization_dependencies(&custom.id)
            .unwrap());
        assert!(store
            .skill_has_organization_dependencies(&override_card.id)
            .unwrap());
    }

    #[test]
    fn relationship_merge_preserves_enabled_tool_assignment() {
        let keep = OrganizationSkillRelationshipState {
            scenarios: Vec::new(),
            scenario_tools: vec![OrganizationScenarioToolRelationship {
                scenario_id: "legacy-preset".to_string(),
                tool: "codex".to_string(),
                enabled: false,
                updated_at: 10,
            }],
            tags: Vec::new(),
        };
        let archive = OrganizationSkillRelationshipState {
            scenarios: Vec::new(),
            scenario_tools: vec![OrganizationScenarioToolRelationship {
                scenario_id: "legacy-preset".to_string(),
                tool: "codex".to_string(),
                enabled: true,
                updated_at: 20,
            }],
            tags: Vec::new(),
        };

        let merged = merge_skill_relationship_states(&keep, &archive);
        assert_eq!(merged.scenario_tools.len(), 1);
        assert!(merged.scenario_tools[0].enabled);
        assert_eq!(merged.scenario_tools[0].updated_at, 20);
    }

    fn insert_planned_archive_operation(
        store: &SkillStore,
        keep: &SkillRecord,
        archive: &SkillRecord,
        operation_id: &str,
    ) {
        store
            .create_organization_operation(&OrganizationOperationRecord {
                operation_id: operation_id.to_string(),
                case_key: "case-1".to_string(),
                case_revision: "revision-1".to_string(),
                kind: "archive_redundant".to_string(),
                status: "planned".to_string(),
                keep_skill_id: keep.id.clone(),
                archive_skill_id: archive.id.clone(),
                payload_json: "{}".to_string(),
                error: None,
                created_at: 1,
                updated_at: 1,
            })
            .unwrap();
    }

    #[test]
    fn relationship_migration_moves_hidden_dependencies_and_undo_restores_them() {
        let tmp = tempdir().unwrap();
        let store = SkillStore::new(&tmp.path().join("test.db")).unwrap();
        let keep = skill("keep", "/central/keep");
        let archive = skill("archive", "/central/archive");
        store.insert_skill(&keep).unwrap();
        store.insert_skill(&archive).unwrap();
        store
            .insert_scenario(&ScenarioRecord {
                id: "legacy-preset".to_string(),
                name: "Legacy Preset".to_string(),
                description: None,
                icon: None,
                sort_order: 0,
                created_at: 1,
                updated_at: 1,
            })
            .unwrap();
        store
            .add_skill_to_scenario("legacy-preset", &archive.id)
            .unwrap();
        store
            .set_scenario_skill_tool_enabled("legacy-preset", &archive.id, "codex", false)
            .unwrap();
        store
            .set_tags_for_skill(&archive.id, &["research".to_string()])
            .unwrap();
        let custom_before = r#"[{"id":"one","cards":[{"skill_id":"archive","stage":"do"}]},{"id":"two","cards":[{"skill_id":"keep"},{"skill_id":"archive"}]}]"#;
        let overrides_before = r#"{"vibe":{"removedSkillIds":["archive"],"addedSkills":[{"skillId":"archive","stageId":"verify"}]}}"#;
        store
            .set_setting("card_master_custom_decks_v1", custom_before)
            .unwrap();
        store
            .set_setting("card_master_deck_overrides_v1", overrides_before)
            .unwrap();

        let migration = store
            .plan_organization_relationship_migration(&keep.id, &archive.id)
            .unwrap();
        assert_eq!(migration.after_keep.scenarios.len(), 1);
        assert_eq!(migration.after_keep.scenario_tools.len(), 1);
        assert_eq!(migration.after_keep.tags, vec!["research".to_string()]);
        assert!(!migration
            .after_custom_decks
            .as_deref()
            .unwrap()
            .contains("archive"));
        assert!(!migration
            .after_deck_overrides
            .as_deref()
            .unwrap()
            .contains("archive"));
        let overrides_after: serde_json::Value = serde_json::from_str(
            migration.after_deck_overrides.as_deref().unwrap(),
        )
        .unwrap();
        let vibe = &overrides_after["vibe"];
        assert_eq!(vibe["removedSkillIds"], serde_json::json!([]));
        assert_eq!(vibe["addedSkills"][0]["skillId"], "keep");

        insert_planned_archive_operation(&store, &keep, &archive, "operation-1");
        store
            .mark_skill_archived_with_relationships(
                &archive.id,
                "/trash/archive",
                &[],
                &[],
                &migration,
                "operation-1",
            )
            .unwrap();
        assert!(!store
            .skill_has_organization_dependencies(&archive.id)
            .unwrap());
        assert!(store
            .skill_has_organization_dependencies(&keep.id)
            .unwrap());
        assert_eq!(
            store
                .get_organization_operation("operation-1")
                .unwrap()
                .unwrap()
                .status,
            "complete"
        );

        store
            .restore_archived_skill_with_relationships(
                &archive.id,
                &archive.central_path,
                archive.enabled,
                &archive.status,
                &[],
                &migration,
                "operation-1",
            )
            .unwrap();
        assert!(store
            .skill_has_organization_dependencies(&archive.id)
            .unwrap());
        let restored = store
            .plan_organization_relationship_migration(&keep.id, &archive.id)
            .unwrap();
        assert_eq!(restored, migration);
        assert_eq!(
            store
                .get_setting("card_master_custom_decks_v1")
                .unwrap()
                .as_deref(),
            Some(custom_before)
        );
        assert_eq!(
            store
                .get_setting("card_master_deck_overrides_v1")
                .unwrap()
                .as_deref(),
            Some(overrides_before)
        );
        assert_eq!(
            store
                .get_organization_operation("operation-1")
                .unwrap()
                .unwrap()
                .status,
            "undone"
        );
    }

    #[test]
    fn relationship_migration_fails_closed_when_dependencies_change_after_preview() {
        let tmp = tempdir().unwrap();
        let store = SkillStore::new(&tmp.path().join("test.db")).unwrap();
        let keep = skill("keep", "/central/keep");
        let archive = skill("archive", "/central/archive");
        store.insert_skill(&keep).unwrap();
        store.insert_skill(&archive).unwrap();
        let migration = store
            .plan_organization_relationship_migration(&keep.id, &archive.id)
            .unwrap();
        store
            .set_tags_for_skill(&archive.id, &["changed-later".to_string()])
            .unwrap();
        insert_planned_archive_operation(&store, &keep, &archive, "operation-2");

        assert!(store
            .mark_skill_archived_with_relationships(
                &archive.id,
                "/trash/archive",
                &[],
                &[],
                &migration,
                "operation-2",
            )
            .is_err());
        assert_eq!(
            store.get_skill_by_id(&archive.id).unwrap().unwrap().status,
            "ok"
        );
    }
}

#[cfg(test)]
mod tag_tests {
    use super::*;
    use tempfile::tempdir;

    fn skill(id: &str) -> SkillRecord {
        SkillRecord {
            id: id.to_string(),
            name: id.to_string(),
            description: None,
            source_type: "import".to_string(),
            source_ref: None,
            source_ref_resolved: None,
            source_subpath: None,
            source_branch: None,
            source_revision: None,
            remote_revision: None,
            central_path: format!("/tmp/{id}"),
            content_hash: None,
            enabled: true,
            created_at: 1,
            updated_at: 1,
            status: "ok".to_string(),
            update_status: "local_only".to_string(),
            last_checked_at: None,
            last_check_error: None,
        }
    }

    #[test]
    fn rename_tag_updates_all_and_merges_into_existing() {
        let tmp = tempdir().unwrap();
        let store = SkillStore::new(&tmp.path().join("test.db")).unwrap();
        store.insert_skill(&skill("a")).unwrap();
        store.insert_skill(&skill("b")).unwrap();
        store.set_tags_for_skill("a", &["old".into()]).unwrap();
        // b already carries the target name, so the rename must merge, not dup.
        store
            .set_tags_for_skill("b", &["old".into(), "new".into()])
            .unwrap();

        let mut affected = store.rename_tag("old", "new").unwrap();
        affected.sort();
        assert_eq!(affected, vec!["a".to_string(), "b".to_string()]);

        assert_eq!(store.get_all_tags().unwrap(), vec!["new".to_string()]);
        let map = store.get_tags_map().unwrap();
        assert_eq!(map.get("a").unwrap(), &vec!["new".to_string()]);
        assert_eq!(map.get("b").unwrap(), &vec!["new".to_string()]);
    }

    #[test]
    fn rename_tag_to_itself_is_noop_not_delete() {
        let tmp = tempdir().unwrap();
        let store = SkillStore::new(&tmp.path().join("test.db")).unwrap();
        store.insert_skill(&skill("a")).unwrap();
        store.set_tags_for_skill("a", &["keep".into()]).unwrap();

        let affected = store.rename_tag("keep", "keep").unwrap();
        assert_eq!(affected, vec!["a".to_string()]);
        // The tag must survive a self-rename, not be wiped.
        assert_eq!(store.get_all_tags().unwrap(), vec!["keep".to_string()]);
    }

    #[test]
    fn delete_tag_removes_from_all_skills() {
        let tmp = tempdir().unwrap();
        let store = SkillStore::new(&tmp.path().join("test.db")).unwrap();
        store.insert_skill(&skill("a")).unwrap();
        store.insert_skill(&skill("b")).unwrap();
        store
            .set_tags_for_skill("a", &["keep".into(), "drop".into()])
            .unwrap();
        store.set_tags_for_skill("b", &["drop".into()]).unwrap();

        let mut affected = store.delete_tag("drop").unwrap();
        affected.sort();
        assert_eq!(affected, vec!["a".to_string(), "b".to_string()]);
        assert_eq!(store.get_all_tags().unwrap(), vec!["keep".to_string()]);
        let map = store.get_tags_map().unwrap();
        assert_eq!(map.get("a").unwrap(), &vec!["keep".to_string()]);
        assert!(map.get("b").is_none());
    }
}
