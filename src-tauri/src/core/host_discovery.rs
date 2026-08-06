//! Read-only host discovery contracts.
//!
//! Deployment adapters continue to describe where Skills are projected. This
//! module freezes the roots that inventory may read and resolves Codex plugin
//! ownership from one `CODEX_HOME`, without scanning cache history.

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};
use std::path::{Component, Path, PathBuf};

use super::content_hash::STRICT_DIRECTORY_DIGEST_ALGORITHM;
use super::tool_adapters::ToolAdapter;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Traversal {
    Flat,
    Recursive,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DiscoverySourceKind {
    Loose,
    CodexPlugin,
}

impl DiscoverySourceKind {
    pub(crate) fn as_str(&self) -> &'static str {
        match self {
            Self::Loose => "loose",
            Self::CodexPlugin => "codex_plugin",
        }
    }

    pub(crate) fn parse(value: &str) -> Option<Self> {
        match value {
            "loose" => Some(Self::Loose),
            "codex_plugin" => Some(Self::CodexPlugin),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DiscoveryProvenance {
    pub source_kind: DiscoverySourceKind,
    pub owner_ref: String,
    pub source_ref: String,
    pub source_version: Option<String>,
    pub source_revision: Option<String>,
    pub source_subpath: Option<String>,
    pub declared_repository: Option<String>,
    pub provenance_basis: String,
    pub digest_algorithm: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiscoveryRoot {
    pub host_key: String,
    pub path: PathBuf,
    pub traversal: Traversal,
    pub provenance: DiscoveryProvenance,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DiscoveryDiagnostic {
    pub code: String,
    pub owner_ref: Option<String>,
    pub found_path: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, Default)]
pub struct DiscoveryInput {
    pub roots: Vec<DiscoveryRoot>,
    pub diagnostics: Vec<DiscoveryDiagnostic>,
}

#[derive(Debug, Default, Deserialize)]
struct CodexConfig {
    #[serde(default)]
    plugins: BTreeMap<String, CodexPluginConfig>,
}

#[derive(Debug, Default, Deserialize)]
struct CodexPluginConfig {
    enabled: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct PluginManifest {
    name: String,
    version: Option<String>,
    repository: Option<String>,
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

pub struct CodexHostDescriptor {
    home: PathBuf,
}

impl CodexHostDescriptor {
    pub fn new(home: PathBuf) -> Self {
        Self { home }
    }

    pub fn resolve(&self) -> Result<DiscoveryInput> {
        let config_path = self.home.join("config.toml");
        match std::fs::symlink_metadata(&config_path) {
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(DiscoveryInput::default());
            }
            Err(error) => {
                return Err(error).with_context(|| {
                    format!("Failed to inspect Codex config {}", config_path.display())
                });
            }
        }
        let config_text = std::fs::read_to_string(&config_path)
            .with_context(|| format!("Failed to read Codex config {}", config_path.display()))?;
        self.resolve_config_text(&config_text)
    }

    fn resolve_config_text(&self, config_text: &str) -> Result<DiscoveryInput> {
        let config: CodexConfig =
            toml::from_str(config_text).context("Failed to parse Codex config.toml")?;
        let mut roots = Vec::new();
        for (owner_ref, _) in config
            .plugins
            .into_iter()
            .filter(|(_, plugin)| plugin.enabled == Some(true))
        {
            roots.extend(self.resolve_enabled_owner(&owner_ref)?);
        }
        Ok(DiscoveryInput {
            roots,
            diagnostics: Vec::new(),
        })
    }

    fn resolve_enabled_owner(&self, owner_ref: &str) -> Result<Vec<DiscoveryRoot>> {
        let (plugin, marketplace) = parse_owner_ref(owner_ref)?;
        let cache_root = self.home.join("plugins/cache");
        let owner_dir = cache_root.join(marketplace).join(plugin);
        let canonical_cache_root = std::fs::canonicalize(&cache_root).with_context(|| {
            format!(
                "Codex plugin cache is unavailable: {}",
                cache_root.display()
            )
        })?;
        let canonical_owner = std::fs::canonicalize(&owner_dir)
            .with_context(|| format!("Enabled Codex plugin cache is missing for {owner_ref}"))?;
        if !canonical_owner.starts_with(&canonical_cache_root) {
            bail!("Enabled Codex plugin cache escapes CODEX_HOME for {owner_ref}");
        }

        let mut candidates = Vec::new();
        for item in std::fs::read_dir(&canonical_owner)
            .with_context(|| format!("Cannot enumerate cache candidates for {owner_ref}"))?
        {
            let entry =
                item.with_context(|| format!("Cannot inspect cache candidate for {owner_ref}"))?;
            // Codex may expose `latest` as a convenience symlink beside the
            // immutable revision directory. It is an alias, not an observed
            // revision candidate; count only real directory entries.
            if !entry
                .file_type()
                .with_context(|| format!("Cannot inspect cache candidate for {owner_ref}"))?
                .is_dir()
            {
                continue;
            }
            let revision = entry
                .file_name()
                .to_str()
                .context("Codex cache revision is not valid UTF-8")?
                .to_string();
            if !valid_segment(&revision, true) {
                bail!("Unsafe Codex cache revision for {owner_ref}: {revision}");
            }
            candidates.push((revision, entry.path()));
        }
        if candidates.len() != 1 {
            bail!(
                "Enabled Codex plugin {owner_ref} has {} cache revision candidates; expected exactly one",
                candidates.len()
            );
        }
        let (observed_revision, candidate) = candidates.pop().expect("length checked");
        let plugin_root = std::fs::canonicalize(&candidate)
            .with_context(|| format!("Cannot resolve cache candidate for {owner_ref}"))?;
        if !plugin_root.starts_with(&canonical_cache_root) {
            bail!("Codex cache candidate escapes CODEX_HOME for {owner_ref}");
        }

        // enabled owner -> unique cache leaf -> manifest-declared roots
        let manifest_path = plugin_root.join(".codex-plugin/plugin.json");
        let manifest_text = std::fs::read_to_string(&manifest_path)
            .with_context(|| format!("Enabled Codex plugin manifest is missing for {owner_ref}"))?;
        let manifest: PluginManifest = serde_json::from_str(&manifest_text)
            .with_context(|| format!("Invalid Codex plugin manifest for {owner_ref}"))?;
        if manifest.name != plugin {
            bail!(
                "Codex plugin manifest name '{}' does not match enabled owner {owner_ref}",
                manifest.name
            );
        }
        if manifest.version.as_deref().is_some_and(str::is_empty) {
            bail!("Codex plugin manifest has an empty version for {owner_ref}");
        }
        if manifest.repository.as_deref().is_some_and(str::is_empty) {
            bail!("Codex plugin manifest has an empty repository for {owner_ref}");
        }

        let Some(skill_roots) = manifest.skills else {
            return Ok(Vec::new());
        };
        let source_ref = path_text(&plugin_root, "Codex plugin source root")?;
        let mut roots = Vec::new();
        let mut unique_roots = HashSet::new();
        for declared in skill_roots.into_vec() {
            let root = resolve_declared_root(&plugin_root, &declared)
                .with_context(|| format!("Unsafe skills root for {owner_ref}: {declared}"))?;
            if !unique_roots.insert(root.clone()) {
                continue;
            }
            roots.push(DiscoveryRoot {
                host_key: "codex".to_string(),
                path: root,
                traversal: Traversal::Recursive,
                provenance: DiscoveryProvenance {
                    source_kind: DiscoverySourceKind::CodexPlugin,
                    owner_ref: owner_ref.to_string(),
                    source_ref: source_ref.clone(),
                    source_version: manifest.version.clone(),
                    source_revision: Some(observed_revision.clone()),
                    source_subpath: None,
                    declared_repository: manifest.repository.clone(),
                    provenance_basis: "codex_config+unique_cache_candidate+manifest_declared"
                        .to_string(),
                    digest_algorithm: STRICT_DIRECTORY_DIGEST_ALGORITHM.to_string(),
                },
            });
        }
        Ok(roots)
    }
}

pub fn resolve_codex_home() -> Result<PathBuf> {
    if let Some(value) = std::env::var_os("CODEX_HOME") {
        if value.is_empty() {
            bail!("CODEX_HOME is empty");
        }
        return Ok(PathBuf::from(value));
    }
    dirs::home_dir()
        .map(|home| home.join(".codex"))
        .context("Cannot determine CODEX_HOME")
}

pub fn discovery_input_for_adapters(adapters: &[ToolAdapter]) -> Result<DiscoveryInput> {
    let codex_home = resolve_codex_home()?;
    discovery_input_for_adapters_at_home(adapters, &codex_home, true)
}

pub fn static_discovery_input(adapters: &[ToolAdapter]) -> Result<DiscoveryInput> {
    let codex_home = resolve_codex_home()?;
    discovery_input_for_adapters_at_home(adapters, &codex_home, false)
}

fn discovery_input_for_adapters_at_home(
    adapters: &[ToolAdapter],
    codex_home: &Path,
    include_codex_plugins: bool,
) -> Result<DiscoveryInput> {
    let mut input = DiscoveryInput::default();
    for adapter in adapters {
        let primary = if adapter.key == "codex" && adapter.override_skills_dir.is_none() {
            codex_home.join("skills")
        } else {
            adapter.skills_dir()
        };
        let installed = if adapter.key == "codex" && adapter.override_skills_dir.is_none() {
            codex_home.exists()
        } else {
            adapter.is_installed()
        };
        let additional = adapter.additional_existing_scan_dirs();
        if installed && primary.exists() {
            input.roots.push(loose_root(
                &adapter.key,
                primary,
                if adapter.recursive_scan {
                    Traversal::Recursive
                } else {
                    Traversal::Flat
                },
            )?);
        }
        for path in additional {
            input
                .roots
                .push(loose_root(&adapter.key, path, Traversal::Flat)?);
        }
    }
    if include_codex_plugins && adapters.iter().any(|adapter| adapter.key == "codex") {
        let plugin_input = CodexHostDescriptor::new(codex_home.to_path_buf()).resolve()?;
        input.roots.extend(plugin_input.roots);
        input.diagnostics.extend(plugin_input.diagnostics);
    }
    Ok(input)
}

fn loose_root(host_key: &str, path: PathBuf, traversal: Traversal) -> Result<DiscoveryRoot> {
    let source_ref = path_text(&path, "Loose discovery root")?;
    Ok(DiscoveryRoot {
        host_key: host_key.to_string(),
        path,
        traversal,
        provenance: DiscoveryProvenance {
            source_kind: DiscoverySourceKind::Loose,
            owner_ref: format!("{host_key}:{source_ref}"),
            source_ref,
            source_version: None,
            source_revision: None,
            source_subpath: None,
            declared_repository: None,
            provenance_basis: "tool_adapter".to_string(),
            digest_algorithm: STRICT_DIRECTORY_DIGEST_ALGORITHM.to_string(),
        },
    })
}

fn parse_owner_ref(owner_ref: &str) -> Result<(&str, &str)> {
    let (plugin, marketplace) = owner_ref
        .split_once('@')
        .with_context(|| format!("Invalid Codex plugin owner: {owner_ref}"))?;
    if owner_ref.matches('@').count() != 1
        || !valid_segment(plugin, false)
        || !valid_segment(marketplace, false)
    {
        bail!("Invalid Codex plugin owner: {owner_ref}");
    }
    Ok((plugin, marketplace))
}

fn valid_segment(value: &str, revision: bool) -> bool {
    !value.is_empty()
        && !matches!(value, "." | "..")
        && value.chars().all(|ch| {
            ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.') || (revision && ch == '+')
        })
}

fn resolve_declared_root(plugin_root: &Path, declared: &str) -> Result<PathBuf> {
    if declared.is_empty() {
        bail!("empty skills paths are not allowed");
    }
    let declared_path = Path::new(declared);
    if declared_path.is_absolute() {
        bail!("absolute paths are not allowed");
    }
    let mut relative = PathBuf::new();
    for component in declared_path.components() {
        match component {
            Component::CurDir => {}
            Component::Normal(segment) => relative.push(segment),
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                bail!("parent/root path components are not allowed")
            }
        }
    }
    let root = std::fs::canonicalize(plugin_root)?;
    let candidate = std::fs::canonicalize(plugin_root.join(relative))?;
    if !candidate.starts_with(&root) {
        bail!("declared skills root escapes plugin root");
    }
    Ok(candidate)
}

fn path_text(path: &Path, label: &str) -> Result<String> {
    path.to_str()
        .map(str::to_string)
        .with_context(|| format!("{label} is not valid UTF-8: {}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    fn write_plugin(
        home: &Path,
        marketplace: &str,
        name: &str,
        revision: &str,
        manifest: &str,
    ) -> PathBuf {
        let root = home
            .join("plugins/cache")
            .join(marketplace)
            .join(name)
            .join(revision);
        fs::create_dir_all(root.join(".codex-plugin")).unwrap();
        fs::write(root.join(".codex-plugin/plugin.json"), manifest).unwrap();
        root
    }

    #[test]
    fn missing_config_has_no_enabled_plugins() {
        let tmp = tempdir().unwrap();
        let input = CodexHostDescriptor::new(tmp.path().to_path_buf())
            .resolve()
            .unwrap();
        assert!(input.roots.is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn broken_config_symlink_is_not_treated_as_missing() {
        let tmp = tempdir().unwrap();
        std::os::unix::fs::symlink(
            tmp.path().join("missing.toml"),
            tmp.path().join("config.toml"),
        )
        .unwrap();
        assert!(CodexHostDescriptor::new(tmp.path().to_path_buf())
            .resolve()
            .is_err());
    }

    #[test]
    fn one_codex_home_controls_loose_config_and_cache_roots() {
        let tmp = tempdir().unwrap();
        fs::create_dir_all(tmp.path().join("skills/loose")).unwrap();
        fs::write(tmp.path().join("skills/loose/SKILL.md"), "# loose").unwrap();
        let plugin = write_plugin(
            tmp.path(),
            "market",
            "active",
            "rev-1",
            r#"{"name":"active","skills":"./skills/"}"#,
        );
        fs::create_dir_all(plugin.join("skills/plugin-skill")).unwrap();
        fs::write(
            tmp.path().join("config.toml"),
            "[plugins.\"active@market\"]\nenabled = true\n",
        )
        .unwrap();
        let adapter = ToolAdapter {
            key: "codex".to_string(),
            display_name: "Codex".to_string(),
            relative_skills_dir: ".codex/skills".to_string(),
            relative_detect_dir: ".codex".to_string(),
            additional_scan_dirs: Vec::new(),
            override_skills_dir: None,
            is_custom: false,
            recursive_scan: false,
            project_relative_skills_dir: None,
            category: Default::default(),
        };
        let input = discovery_input_for_adapters_at_home(&[adapter], tmp.path(), true).unwrap();
        assert_eq!(input.roots.len(), 2);
        let expected_home = fs::canonicalize(tmp.path()).unwrap();
        assert!(input.roots.iter().all(|root| {
            fs::canonicalize(&root.path)
                .unwrap()
                .starts_with(&expected_home)
                && fs::canonicalize(Path::new(&root.provenance.source_ref))
                    .unwrap()
                    .starts_with(&expected_home)
        }));
    }

    #[test]
    fn only_explicit_true_resolves_unique_candidate_with_provenance() {
        let tmp = tempdir().unwrap();
        let root = write_plugin(
            tmp.path(),
            "market",
            "active",
            "rev-1",
            r#"{"name":"active","version":"1.2.3","repository":"https://example.test/repo","skills":"./skills/"}"#,
        );
        fs::create_dir_all(root.join("skills/alpha")).unwrap();
        fs::write(root.join("skills/alpha/SKILL.md"), "# alpha").unwrap();
        let disabled = write_plugin(
            tmp.path(),
            "market",
            "disabled",
            "rev-2",
            r#"{"name":"disabled","skills":"./skills/"}"#,
        );
        fs::create_dir_all(disabled.join("skills/beta")).unwrap();

        let config = r#"
            [plugins."active@market"]
            enabled = true
            ignored = "field"
            [plugins."disabled@market"]
            enabled = false
            [plugins."missing-flag@market"]
        "#;
        let input = CodexHostDescriptor::new(tmp.path().to_path_buf())
            .resolve_config_text(config)
            .unwrap();
        assert_eq!(input.roots.len(), 1);
        let root = &input.roots[0];
        assert_eq!(root.provenance.owner_ref, "active@market");
        assert_eq!(root.provenance.source_revision.as_deref(), Some("rev-1"));
        assert_eq!(root.provenance.source_version.as_deref(), Some("1.2.3"));
        assert_eq!(
            root.provenance.declared_repository.as_deref(),
            Some("https://example.test/repo")
        );
    }

    #[cfg(unix)]
    #[test]
    fn cache_alias_symlink_does_not_create_a_second_revision_candidate() {
        let tmp = tempdir().unwrap();
        let root = write_plugin(
            tmp.path(),
            "market",
            "active",
            "rev-1",
            r#"{"name":"active","skills":"./skills/"}"#,
        );
        fs::create_dir_all(root.join("skills/alpha")).unwrap();
        std::os::unix::fs::symlink(&root, tmp.path().join("plugins/cache/market/active/latest"))
            .unwrap();
        let config = "[plugins.\"active@market\"]\nenabled = true\n";
        let input = CodexHostDescriptor::new(tmp.path().to_path_buf())
            .resolve_config_text(config)
            .unwrap();
        assert_eq!(input.roots.len(), 1);
        assert_eq!(
            input.roots[0].provenance.source_revision.as_deref(),
            Some("rev-1")
        );
    }

    #[test]
    fn malformed_config_and_ambiguous_or_missing_cache_fail_closed() {
        let tmp = tempdir().unwrap();
        let descriptor = CodexHostDescriptor::new(tmp.path().to_path_buf());
        assert!(descriptor.resolve_config_text("[plugins").is_err());

        fs::create_dir_all(tmp.path().join("plugins/cache/market/missing")).unwrap();
        let missing = "[plugins.\"missing@market\"]\nenabled = true\n";
        assert!(descriptor.resolve_config_text(missing).is_err());

        write_plugin(tmp.path(), "market", "many", "one", r#"{"name":"many"}"#);
        write_plugin(tmp.path(), "market", "many", "two", r#"{"name":"many"}"#);
        let many = "[plugins.\"many@market\"]\nenabled = true\n";
        assert!(descriptor.resolve_config_text(many).is_err());
    }

    #[test]
    fn validates_manifest_identity_and_declared_root_containment() {
        let tmp = tempdir().unwrap();
        let mismatch = write_plugin(
            tmp.path(),
            "market",
            "tool",
            "rev",
            r#"{"name":"other","skills":"./skills"}"#,
        );
        fs::create_dir_all(mismatch.join("skills")).unwrap();
        let config = "[plugins.\"tool@market\"]\nenabled = true\n";
        assert!(CodexHostDescriptor::new(tmp.path().to_path_buf())
            .resolve_config_text(config)
            .is_err());

        let escape_home = tempdir().unwrap();
        let root = write_plugin(
            escape_home.path(),
            "market",
            "tool",
            "rev",
            r#"{"name":"tool","skills":"../outside"}"#,
        );
        fs::create_dir_all(root.parent().unwrap().join("outside")).unwrap();
        assert!(CodexHostDescriptor::new(escape_home.path().to_path_buf())
            .resolve_config_text(config)
            .is_err());
    }

    #[test]
    fn malformed_manifest_and_absolute_skills_root_fail_closed() {
        let malformed_home = tempdir().unwrap();
        write_plugin(malformed_home.path(), "market", "tool", "rev", "{");
        let config = "[plugins.\"tool@market\"]\nenabled = true\n";
        assert!(
            CodexHostDescriptor::new(malformed_home.path().to_path_buf())
                .resolve_config_text(config)
                .is_err()
        );

        let absolute_home = tempdir().unwrap();
        write_plugin(
            absolute_home.path(),
            "market",
            "tool",
            "rev",
            r#"{"name":"tool","skills":"/tmp/escape"}"#,
        );
        assert!(CodexHostDescriptor::new(absolute_home.path().to_path_buf())
            .resolve_config_text(config)
            .is_err());
    }

    #[test]
    fn supports_many_or_no_declared_skill_roots() {
        let tmp = tempdir().unwrap();
        let root = write_plugin(
            tmp.path(),
            "market",
            "many",
            "rev",
            r#"{"name":"many","skills":["skills/a","skills/b"]}"#,
        );
        fs::create_dir_all(root.join("skills/a")).unwrap();
        fs::create_dir_all(root.join("skills/b")).unwrap();
        let config = "[plugins.\"many@market\"]\nenabled = true\n";
        let input = CodexHostDescriptor::new(tmp.path().to_path_buf())
            .resolve_config_text(config)
            .unwrap();
        assert_eq!(input.roots.len(), 2);

        let empty_home = tempdir().unwrap();
        write_plugin(
            empty_home.path(),
            "market",
            "empty",
            "rev",
            r#"{"name":"empty"}"#,
        );
        let empty_config = "[plugins.\"empty@market\"]\nenabled = true\n";
        assert!(CodexHostDescriptor::new(empty_home.path().to_path_buf())
            .resolve_config_text(empty_config)
            .unwrap()
            .roots
            .is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlink_escape_from_declared_skills_root() {
        let tmp = tempdir().unwrap();
        let root = write_plugin(
            tmp.path(),
            "market",
            "tool",
            "rev",
            r#"{"name":"tool","skills":"skills"}"#,
        );
        let outside = tmp.path().join("outside");
        fs::create_dir(&outside).unwrap();
        std::os::unix::fs::symlink(&outside, root.join("skills")).unwrap();
        let config = "[plugins.\"tool@market\"]\nenabled = true\n";
        assert!(CodexHostDescriptor::new(tmp.path().to_path_buf())
            .resolve_config_text(config)
            .is_err());
    }
}
