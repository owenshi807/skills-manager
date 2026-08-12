use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Stdio;
use std::time::Duration;

use super::error::AppError;

pub const METHOD_VERSION: &str = "card-master-six-gates-v1";
pub const OUTPUT_SCHEMA_VERSION: u32 = 1;
pub const DECK_METHOD_VERSION: &str = "card-master-deck-builder-v1";

#[derive(Debug, Clone, Serialize)]
pub struct AgentCapability {
    pub key: String,
    pub display_name: String,
    pub available: bool,
    pub version: Option<String>,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssessmentEvidence {
    pub strength: String,
    pub claim: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrganizationAgentAssessment {
    pub case_id: String,
    pub case_revision: String,
    pub relation_hypothesis: String,
    pub difference_summary: String,
    pub evidence: Vec<AssessmentEvidence>,
    #[serde(default)]
    pub counter_evidence: Vec<AssessmentEvidence>,
    #[serde(default)]
    pub unresolved_questions: Vec<String>,
    pub behavior_eval_required: bool,
    pub suggested_actions: Vec<String>,
    pub confidence: f64,
}

#[derive(Debug, Deserialize)]
struct AgentEnvelope {
    schema_version: u32,
    method_version: String,
    assessments: Vec<OrganizationAgentAssessment>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeckSuggestionCard {
    pub skill_id: String,
    pub stage: String,
    pub role: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeckSuggestion {
    pub title: String,
    pub summary: String,
    pub cards: Vec<DeckSuggestionCard>,
    #[serde(default)]
    pub gaps: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct DeckSuggestionEnvelope {
    schema_version: u32,
    method_version: String,
    deck: DeckSuggestion,
}

fn agent_definition(key: &str) -> Option<(&'static str, &'static str)> {
    match key {
        "codex" => Some(("codex", "Codex CLI")),
        "claude_code" => Some(("claude", "Claude Code CLI")),
        "hermes" => Some(("hermes", "Hermes CLI")),
        _ => None,
    }
}

pub async fn probe_agents() -> Vec<AgentCapability> {
    let mut capabilities = Vec::new();
    for key in ["codex", "claude_code", "hermes"] {
        let (binary, display_name) = agent_definition(key).expect("known adapter");
        let output = tokio::time::timeout(
            Duration::from_secs(3),
            tokio::process::Command::new(binary)
                .arg("--version")
                .stdin(Stdio::null())
                .output(),
        )
        .await;
        let capability = match output {
            Ok(Ok(output)) if output.status.success() => {
                let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
                AgentCapability {
                    key: key.to_string(),
                    display_name: display_name.to_string(),
                    available: true,
                    version: (!version.is_empty()).then_some(version),
                    reason: None,
                }
            }
            Ok(Ok(output)) => AgentCapability {
                key: key.to_string(),
                display_name: display_name.to_string(),
                available: false,
                version: None,
                reason: Some(String::from_utf8_lossy(&output.stderr).trim().to_string()),
            },
            Ok(Err(error)) if error.kind() == std::io::ErrorKind::NotFound => AgentCapability {
                key: key.to_string(),
                display_name: display_name.to_string(),
                available: false,
                version: None,
                reason: Some("CLI not found on PATH".to_string()),
            },
            Ok(Err(error)) => AgentCapability {
                key: key.to_string(),
                display_name: display_name.to_string(),
                available: false,
                version: None,
                reason: Some(error.to_string()),
            },
            Err(_) => AgentCapability {
                key: key.to_string(),
                display_name: display_name.to_string(),
                available: false,
                version: None,
                reason: Some("CLI probe timed out".to_string()),
            },
        };
        capabilities.push(capability);
    }
    capabilities
}

pub async fn execute(agent_key: &str, prompt: &str, cwd: &Path) -> Result<String, AppError> {
    if agent_definition(agent_key).is_none() {
        return Err(AppError::invalid_input("Unsupported organization agent"));
    }

    let mut command = match agent_key {
        "codex" => {
            let mut command = tokio::process::Command::new("codex");
            command.args([
                "exec",
                "--sandbox",
                "read-only",
                "--skip-git-repo-check",
                "--ephemeral",
                "-C",
            ]);
            command.arg(cwd).arg(prompt);
            command
        }
        "claude_code" => {
            let mut command = tokio::process::Command::new("claude");
            command.args([
                "--print",
                "--permission-mode",
                "plan",
                "--no-session-persistence",
                "--output-format",
                "text",
            ]);
            command.arg(prompt);
            command
        }
        "hermes" => {
            let mut command = tokio::process::Command::new("hermes");
            command.args(["--ignore-rules", "-z", prompt]);
            command
        }
        _ => unreachable!(),
    };
    command
        .current_dir(cwd)
        .stdin(Stdio::null())
        .kill_on_drop(true);

    let output = tokio::time::timeout(Duration::from_secs(600), command.output())
        .await
        .map_err(|_| AppError::internal("Organization agent timed out after 10 minutes"))?
        .map_err(AppError::io)?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(AppError::internal(if stderr.is_empty() {
            "Organization agent exited without a result".to_string()
        } else {
            stderr
        }));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn json_body(raw: &str) -> &str {
    let trimmed = raw.trim();
    if let Some(rest) = trimmed.strip_prefix("```json") {
        return rest.strip_suffix("```").unwrap_or(rest).trim();
    }
    if let Some(rest) = trimmed.strip_prefix("```") {
        return rest.strip_suffix("```").unwrap_or(rest).trim();
    }
    trimmed
}

pub fn parse_assessments(
    raw: &str,
    expected: &[(String, String)],
) -> Result<Vec<OrganizationAgentAssessment>, AppError> {
    let envelope: AgentEnvelope = serde_json::from_str(json_body(raw)).map_err(|error| {
        AppError::invalid_input(format!("Agent returned invalid JSON: {error}"))
    })?;
    if envelope.schema_version != OUTPUT_SCHEMA_VERSION || envelope.method_version != METHOD_VERSION
    {
        return Err(AppError::invalid_input(
            "Agent returned an unsupported judgment schema",
        ));
    }
    if envelope.assessments.len() != expected.len() {
        return Err(AppError::invalid_input(
            "Agent did not return every requested case exactly once",
        ));
    }

    let allowed_relations = [
        "confirmed_newer_revision",
        "probable_newer_revision",
        "platform_variant",
        "user_customization",
        "different_purpose",
        "exact_artifact_multi_source",
        "behavior_overlap_candidate",
        "needs_manual_compare",
    ];
    let allowed_actions = [
        "prefer_newer_archive_old",
        "keep_variants_linked",
        "keep_both_grouped",
        "keep_both_mark_fork",
        "consolidate_after_lineage_check",
        "run_behavior_eval",
        "manual_review",
    ];
    let mut seen = std::collections::HashSet::new();
    for assessment in &envelope.assessments {
        let Some((_, revision)) = expected.iter().find(|(id, _)| id == &assessment.case_id) else {
            return Err(AppError::invalid_input(
                "Agent returned an unknown organization case",
            ));
        };
        if !seen.insert(assessment.case_id.as_str()) || &assessment.case_revision != revision {
            return Err(AppError::invalid_input(
                "Agent returned a duplicate or stale organization case",
            ));
        }
        if !allowed_relations.contains(&assessment.relation_hypothesis.as_str())
            || assessment.suggested_actions.is_empty()
            || assessment
                .suggested_actions
                .iter()
                .any(|action| !allowed_actions.contains(&action.as_str()))
            || !(0.0..=1.0).contains(&assessment.confidence)
            || assessment.difference_summary.trim().is_empty()
            || assessment
                .evidence
                .iter()
                .chain(&assessment.counter_evidence)
                .any(|item| {
                    !matches!(item.strength.as_str(), "strong" | "medium" | "weak")
                        || item.claim.trim().is_empty()
                })
        {
            return Err(AppError::invalid_input(
                "Agent returned an invalid organization judgment",
            ));
        }
    }
    Ok(envelope.assessments)
}

pub fn parse_deck_suggestion(
    raw: &str,
    allowed_skill_ids: &std::collections::HashSet<String>,
) -> Result<DeckSuggestion, AppError> {
    let envelope: DeckSuggestionEnvelope = serde_json::from_str(json_body(raw))
        .map_err(|error| AppError::invalid_input(format!("Agent returned invalid deck JSON: {error}")))?;
    if envelope.schema_version != OUTPUT_SCHEMA_VERSION
        || envelope.method_version != DECK_METHOD_VERSION
    {
        return Err(AppError::invalid_input(
            "Agent returned an unsupported deck schema",
        ));
    }
    let deck = envelope.deck;
    if deck.title.trim().is_empty()
        || deck.title.chars().count() > 80
        || deck.summary.trim().is_empty()
        || deck.summary.chars().count() > 400
        || deck.cards.is_empty()
        || deck.cards.len() > 20
        || deck.gaps.len() > 12
    {
        return Err(AppError::invalid_input("Agent returned an invalid deck"));
    }
    let mut seen = std::collections::HashSet::new();
    for card in &deck.cards {
        if !allowed_skill_ids.contains(&card.skill_id)
            || !seen.insert(card.skill_id.as_str())
            || card.stage.trim().is_empty()
            || card.stage.chars().count() > 60
            || card.role.trim().is_empty()
            || card.role.chars().count() > 100
            || card.reason.trim().is_empty()
            || card.reason.chars().count() > 300
        {
            return Err(AppError::invalid_input(
                "Agent selected an unknown, duplicate, or invalid Skill",
            ));
        }
    }
    Ok(deck)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_complete_fenced_assessment() {
        let raw = r#"```json
{"schema_version":1,"method_version":"card-master-six-gates-v1","assessments":[{"case_id":"c1","case_revision":"r1","relation_hypothesis":"platform_variant","difference_summary":"Host adapter differs","evidence":[{"strength":"medium","claim":"Same workflow"}],"counter_evidence":[],"unresolved_questions":[],"behavior_eval_required":false,"suggested_actions":["keep_variants_linked"],"confidence":0.8}]}
```"#;
        let parsed = parse_assessments(raw, &[("c1".to_string(), "r1".to_string())]).unwrap();
        assert_eq!(parsed[0].case_id, "c1");
    }

    #[test]
    fn rejects_stale_or_unknown_taxonomy() {
        let raw = r#"{"schema_version":1,"method_version":"card-master-six-gates-v1","assessments":[{"case_id":"c1","case_revision":"old","relation_hypothesis":"duplicate","difference_summary":"x","evidence":[],"behavior_eval_required":false,"suggested_actions":["delete"],"confidence":1.0}]}"#;
        assert!(parse_assessments(raw, &[("c1".to_string(), "r1".to_string())]).is_err());
    }

    #[test]
    fn parses_deck_only_from_allowed_library_skills() {
        let raw = r#"{"schema_version":1,"method_version":"card-master-deck-builder-v1","deck":{"title":"Research","summary":"Find and verify facts","cards":[{"skill_id":"s1","stage":"Investigate","role":"Find evidence","reason":"Matches the requested research workflow"}],"gaps":[]}}"#;
        let allowed = std::collections::HashSet::from(["s1".to_string()]);
        let deck = parse_deck_suggestion(raw, &allowed).unwrap();
        assert_eq!(deck.cards[0].skill_id, "s1");
    }

    #[test]
    fn rejects_deck_with_invented_skill() {
        let raw = r#"{"schema_version":1,"method_version":"card-master-deck-builder-v1","deck":{"title":"Research","summary":"Find facts","cards":[{"skill_id":"invented","stage":"Research","role":"Search","reason":"Looks useful"}],"gaps":[]}}"#;
        assert!(parse_deck_suggestion(raw, &std::collections::HashSet::new()).is_err());
    }
}
