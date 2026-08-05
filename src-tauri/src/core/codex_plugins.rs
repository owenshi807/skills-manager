//! Codex runtime projection discovery.
//!
//! `codex plugin list --json` is the owner truth. It already applies Codex's
//! config layering and active-version rules. We map only its installed +
//! enabled rows to exact cache roots; recursively scanning the whole cache
//! would falsely activate disabled and historical plugins.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Component, Path, PathBuf};
use std::process::Command;

use super::scanner;
use super::skill_metadata;
use super::skill_store::{DiscoveredSkillRecord, DiscoveryProvenance};

#[derive(Debug, Clone, Serialize)]
pub struct DiscoveryDiagnostic {
    pub code: String,
    pub owner_id: Option<String>,
    pub message: String,
}

#[derive(Debug, Default)]
pub struct CodexPluginScan {
    pub enabled_plugins: usize,
    pub discovered: Vec<DiscoveredSkillRecord>,
    pub diagnostics: Vec<DiscoveryDiagnostic>,
}

#[derive(Debug, Deserialize)]
struct PluginListResponse {
    #[serde(default)]
    installed: Vec<PluginListEntry>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginListEntry {
    plugin_id: String,
    name: String,
    marketplace_name: String,
    version: String,
    installed: bool,
    enabled: bool,
    source: Option<PluginSource>,
    marketplace_source: Option<MarketplaceSource>,
}

#[derive(Debug, Deserialize)]
struct PluginSource {
    source: Option<String>,
    path: Option<String>,
    url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MarketplaceSource {
    source_type: Option<String>,
    source: Option<String>,
}

#[derive(Debug, Deserialize)]
struct PluginManifest {
    name: String,
    #[serde(default)]
    skills: Option<SkillRoots>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum SkillRoots {
    One(String),
    Many(Vec<String>),
}

impl SkillRoots {
    fn into_vec(self) -> Vec<String> {
        match self {
            Self::One(path) => vec![path],
            Self::Many(paths) => paths,
        }
    }
}

fn diagnostic(
    code: &str,
    owner_id: Option<&str>,
    message: impl Into<String>,
) -> DiscoveryDiagnostic {
    DiscoveryDiagnostic {
        code: code.to_string(),
        owner_id: owner_id.map(str::to_string),
        message: message.into(),
    }
}

fn codex_home() -> Option<PathBuf> {
    std::env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .or_else(|| dirs::home_dir().map(|home| home.join(".codex")))
}

/// Query Codex's own runtime view. Failure is diagnostic, not fatal to loose
/// Skill discovery.
pub fn scan_active_plugin_skills(managed_paths: &[String]) -> CodexPluginScan {
    let Some(codex_home) = codex_home() else {
        return CodexPluginScan {
            diagnostics: vec![diagnostic(
                "codex_home_unavailable",
                None,
                "Cannot determine Codex home",
            )],
            ..Default::default()
        };
    };

    let output = match Command::new("codex")
        .args(["plugin", "list", "--json"])
        .output()
    {
        Ok(output) => output,
        Err(err) => {
            return CodexPluginScan {
                diagnostics: vec![diagnostic(
                    "codex_plugin_command_unavailable",
                    None,
                    format!("Cannot run `codex plugin list --json`: {err}"),
                )],
                ..Default::default()
            };
        }
    };
    if !output.status.success() {
        return CodexPluginScan {
            diagnostics: vec![diagnostic(
                "codex_plugin_command_failed",
                None,
                format!("`codex plugin list --json` exited with {}", output.status),
            )],
            ..Default::default()
        };
    }

    let json = match String::from_utf8(output.stdout) {
        Ok(json) => json,
        Err(_) => {
            return CodexPluginScan {
                diagnostics: vec![diagnostic(
                    "codex_plugin_output_invalid_utf8",
                    None,
                    "Codex plugin JSON is not UTF-8",
                )],
                ..Default::default()
            };
        }
    };
    scan_plugin_list_json(&json, &codex_home, managed_paths)
}

pub fn scan_plugin_list_json(
    json: &str,
    codex_home: &Path,
    managed_paths: &[String],
) -> CodexPluginScan {
    let response: PluginListResponse = match serde_json::from_str(json) {
        Ok(response) => response,
        Err(err) => {
            return CodexPluginScan {
                diagnostics: vec![diagnostic(
                    "codex_plugin_output_invalid_json",
                    None,
                    format!("Cannot parse Codex plugin JSON: {err}"),
                )],
                ..Default::default()
            };
        }
    };

    let mut result = CodexPluginScan::default();
    let mut owner_ids = HashSet::new();
    for plugin in response
        .installed
        .into_iter()
        .filter(|plugin| plugin.installed && plugin.enabled)
    {
        result.enabled_plugins += 1;
        if !owner_ids.insert(plugin.plugin_id.clone()) {
            result.diagnostics.push(diagnostic(
                "codex_plugin_duplicate_owner",
                Some(&plugin.plugin_id),
                "Codex reported duplicate enabled plugin owner",
            ));
            continue;
        }
        scan_plugin(plugin, codex_home, managed_paths, &mut result);
    }
    result
}

fn scan_plugin(
    plugin: PluginListEntry,
    codex_home: &Path,
    managed_paths: &[String],
    result: &mut CodexPluginScan,
) {
    if !valid_plugin_segment(&plugin.name)
        || !valid_plugin_segment(&plugin.marketplace_name)
        || !valid_version_segment(&plugin.version)
        || plugin.plugin_id != format!("{}@{}", plugin.name, plugin.marketplace_name)
    {
        result.diagnostics.push(diagnostic(
            "codex_plugin_identity_invalid",
            Some(&plugin.plugin_id),
            "Codex plugin identity contains invalid or inconsistent path segments",
        ));
        return;
    }

    let plugin_root = codex_home
        .join("plugins/cache")
        .join(&plugin.marketplace_name)
        .join(&plugin.name)
        .join(&plugin.version);
    if !plugin_root.is_dir() {
        result.diagnostics.push(diagnostic(
            "codex_plugin_cache_missing",
            Some(&plugin.plugin_id),
            format!(
                "Active plugin cache root is missing: {}",
                plugin_root.display()
            ),
        ));
        return;
    }
    let canonical_plugin_root = match std::fs::canonicalize(&plugin_root) {
        Ok(path) => path,
        Err(err) => {
            result.diagnostics.push(diagnostic(
                "codex_plugin_cache_unreadable",
                Some(&plugin.plugin_id),
                format!("Cannot resolve active plugin cache root: {err}"),
            ));
            return;
        }
    };

    let manifest_path = [
        plugin_root.join(".codex-plugin/plugin.json"),
        plugin_root.join("plugin.json"),
    ]
    .into_iter()
    .find(|path| path.is_file());
    let Some(manifest_path) = manifest_path else {
        result.diagnostics.push(diagnostic(
            "codex_plugin_manifest_missing",
            Some(&plugin.plugin_id),
            "Active plugin has no readable plugin.json",
        ));
        return;
    };
    let manifest: PluginManifest = match std::fs::read_to_string(&manifest_path)
        .ok()
        .and_then(|contents| serde_json::from_str(&contents).ok())
    {
        Some(manifest) => manifest,
        None => {
            result.diagnostics.push(diagnostic(
                "codex_plugin_manifest_invalid",
                Some(&plugin.plugin_id),
                "Active plugin manifest is invalid",
            ));
            return;
        }
    };
    if manifest.name != plugin.name {
        result.diagnostics.push(diagnostic(
            "codex_plugin_manifest_name_mismatch",
            Some(&plugin.plugin_id),
            "Active plugin manifest name does not match runtime owner",
        ));
        return;
    }
    let Some(skill_roots) = manifest.skills else {
        return;
    };

    let source_type = plugin
        .source
        .as_ref()
        .and_then(|source| source.source.clone())
        .or_else(|| {
            plugin
                .marketplace_source
                .as_ref()
                .and_then(|source| source.source_type.clone())
        });
    let marketplace_ref = plugin
        .marketplace_source
        .as_ref()
        .and_then(|source| source.source.clone());
    let source_ref = if source_type.as_deref() == Some("git") {
        marketplace_ref.or_else(|| {
            plugin
                .source
                .as_ref()
                .and_then(|source| source.url.clone().or_else(|| source.path.clone()))
        })
    } else {
        plugin
            .source
            .as_ref()
            .and_then(|source| source.path.clone().or_else(|| source.url.clone()))
            .or(marketplace_ref)
    };

    for declared_root in skill_roots.into_vec() {
        let Some(skill_root) = resolve_declared_root(&plugin_root, &declared_root) else {
            result.diagnostics.push(diagnostic(
                "codex_plugin_skills_path_unsafe",
                Some(&plugin.plugin_id),
                format!("Plugin skills path escapes active root: {declared_root}"),
            ));
            continue;
        };
        let mut skill_dirs = if skill_metadata::is_valid_skill_dir(&skill_root) {
            vec![skill_root]
        } else {
            scanner::collect_skill_dirs(&skill_root)
        };
        skill_dirs.sort();
        skill_dirs.dedup();

        for skill_dir in skill_dirs {
            let source_subpath = skill_dir
                .strip_prefix(&canonical_plugin_root)
                .ok()
                .map(|path| path.to_string_lossy().replace('\\', "/"));
            let provenance = DiscoveryProvenance {
                owner_type: "codex_plugin".to_string(),
                owner_id: plugin.plugin_id.clone(),
                source_marketplace: Some(plugin.marketplace_name.clone()),
                source_type: source_type.clone(),
                source_ref: source_ref.clone(),
                source_revision: Some(plugin.version.clone()),
                source_subpath,
            };
            if let Some(record) =
                scanner::discovered_record("codex", skill_dir, managed_paths, Some(provenance))
            {
                result.discovered.push(record);
            }
        }
    }
}

fn valid_plugin_segment(value: &str) -> bool {
    !value.is_empty()
        && !matches!(value, "." | "..")
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
}

fn valid_version_segment(value: &str) -> bool {
    !value.is_empty()
        && !matches!(value, "." | "..")
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.' | '+'))
}

fn resolve_declared_root(plugin_root: &Path, declared: &str) -> Option<PathBuf> {
    let declared_path = Path::new(declared);
    if declared_path.is_absolute() {
        return None;
    }
    let mut relative = PathBuf::new();
    for component in declared_path.components() {
        match component {
            Component::CurDir => {}
            Component::Normal(segment) => relative.push(segment),
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => return None,
        }
    }
    let canonical_root = std::fs::canonicalize(plugin_root).ok()?;
    let canonical_candidate = std::fs::canonicalize(plugin_root.join(relative)).ok()?;
    canonical_candidate
        .starts_with(&canonical_root)
        .then_some(canonical_candidate)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    fn write_plugin(home: &Path, marketplace: &str, name: &str, revision: &str, skills: &str) {
        let root = home
            .join("plugins/cache")
            .join(marketplace)
            .join(name)
            .join(revision);
        fs::create_dir_all(root.join(".codex-plugin")).unwrap();
        fs::write(
            root.join(".codex-plugin/plugin.json"),
            format!(r#"{{"name":"{name}","version":"manifest-version","skills":"{skills}"}}"#),
        )
        .unwrap();
    }

    fn plugin_json(entries: &str) -> String {
        format!(r#"{{"installed":[{entries}],"available":[]}}"#)
    }

    fn entry(id: &str, name: &str, marketplace: &str, revision: &str, enabled: bool) -> String {
        format!(
            r#"{{"pluginId":"{id}","name":"{name}","marketplaceName":"{marketplace}","version":"{revision}","installed":true,"enabled":{enabled},"source":{{"source":"git","url":"https://example.test/repo.git"}}}}"#
        )
    }

    #[test]
    fn scans_only_enabled_runtime_projection_with_provenance() {
        let tmp = tempdir().unwrap();
        write_plugin(tmp.path(), "market", "active", "rev-1", "./skills/");
        write_plugin(tmp.path(), "market", "disabled", "rev-2", "./skills/");
        let active_skill = tmp
            .path()
            .join("plugins/cache/market/active/rev-1/skills/alpha");
        fs::create_dir_all(&active_skill).unwrap();
        fs::write(active_skill.join("SKILL.md"), "---\nname: alpha\n---\n").unwrap();
        let disabled_skill = tmp
            .path()
            .join("plugins/cache/market/disabled/rev-2/skills/beta");
        fs::create_dir_all(&disabled_skill).unwrap();
        fs::write(disabled_skill.join("SKILL.md"), "---\nname: beta\n---\n").unwrap();

        let json = plugin_json(&format!(
            "{},{}",
            entry("active@market", "active", "market", "rev-1", true),
            entry("disabled@market", "disabled", "market", "rev-2", false)
        ));
        let scan = scan_plugin_list_json(&json, tmp.path(), &[]);

        assert_eq!(scan.enabled_plugins, 1);
        assert_eq!(scan.discovered.len(), 1);
        assert!(scan.diagnostics.is_empty());
        let provenance = scan.discovered[0].provenance.as_ref().unwrap();
        assert_eq!(provenance.owner_id, "active@market");
        assert_eq!(provenance.source_marketplace.as_deref(), Some("market"));
        assert_eq!(provenance.source_revision.as_deref(), Some("rev-1"));
        assert_eq!(provenance.source_subpath.as_deref(), Some("skills/alpha"));
    }

    #[test]
    fn runtime_revision_selects_exact_cache_even_when_manifest_version_differs() {
        let tmp = tempdir().unwrap();
        write_plugin(tmp.path(), "market", "tool", "commit-ish", "./skills/");
        let skill = tmp
            .path()
            .join("plugins/cache/market/tool/commit-ish/skills/alpha");
        fs::create_dir_all(&skill).unwrap();
        fs::write(skill.join("SKILL.md"), "---\nname: alpha\n---\n").unwrap();

        let json = plugin_json(&entry("tool@market", "tool", "market", "commit-ish", true));
        let scan = scan_plugin_list_json(&json, tmp.path(), &[]);
        assert_eq!(scan.discovered.len(), 1);
        assert_eq!(
            scan.discovered[0]
                .provenance
                .as_ref()
                .and_then(|p| p.source_revision.as_deref()),
            Some("commit-ish")
        );
    }

    #[test]
    fn rejects_identity_and_declared_path_traversal() {
        let tmp = tempdir().unwrap();
        write_plugin(tmp.path(), "market", "unsafe", "rev", "../outside");
        let identity_attack = entry("unsafe@../market", "unsafe", "../market", "rev", true);
        let path_attack = entry("unsafe@market", "unsafe", "market", "rev", true);

        let identity_scan = scan_plugin_list_json(&plugin_json(&identity_attack), tmp.path(), &[]);
        assert_eq!(identity_scan.discovered.len(), 0);
        assert_eq!(
            identity_scan.diagnostics[0].code,
            "codex_plugin_identity_invalid"
        );

        let path_scan = scan_plugin_list_json(&plugin_json(&path_attack), tmp.path(), &[]);
        assert_eq!(path_scan.discovered.len(), 0);
        assert_eq!(
            path_scan.diagnostics[0].code,
            "codex_plugin_skills_path_unsafe"
        );
    }

    #[test]
    fn duplicate_runtime_owner_is_not_counted_twice() {
        let tmp = tempdir().unwrap();
        write_plugin(tmp.path(), "market", "tool", "rev", "./skills/");
        let skill = tmp
            .path()
            .join("plugins/cache/market/tool/rev/skills/alpha");
        fs::create_dir_all(&skill).unwrap();
        fs::write(skill.join("SKILL.md"), "---\nname: alpha\n---\n").unwrap();
        let row = entry("tool@market", "tool", "market", "rev", true);

        let scan = scan_plugin_list_json(&plugin_json(&format!("{row},{row}")), tmp.path(), &[]);
        assert_eq!(scan.discovered.len(), 1);
        assert!(scan
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.code == "codex_plugin_duplicate_owner"));
    }
}
