use std::path::Path;

pub struct SkillMeta {
    pub name: Option<String>,
    pub description: Option<String>,
}

fn is_marker_file(entry: &std::fs::DirEntry, follow_file_symlinks: bool) -> bool {
    if follow_file_symlinks {
        // Agent installers may link only SKILL.md. Path::is_file follows a
        // readable file symlink while still rejecting directories and broken
        // links, matching what the Agent itself can consume.
        entry.path().is_file()
    } else {
        entry
            .file_type()
            .map(|file_type| file_type.is_file())
            .unwrap_or(false)
    }
}

fn read_named_file_exact(
    dir: &Path,
    target_name: &str,
    follow_file_symlinks: bool,
) -> Option<String> {
    let entries = std::fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        if !is_marker_file(&entry, follow_file_symlinks) {
            continue;
        }
        if entry.file_name().to_string_lossy() == target_name {
            return std::fs::read_to_string(entry.path()).ok();
        }
    }
    None
}

fn has_named_file_exact(dir: &Path, target_name: &str, follow_file_symlinks: bool) -> bool {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return false;
    };
    entries.flatten().any(|entry| {
        is_marker_file(&entry, follow_file_symlinks)
            && entry.file_name().to_string_lossy() == target_name
    })
}

pub fn parse_skill_md(dir: &Path) -> SkillMeta {
    parse_skill_md_with_candidates(dir, &["SKILL.md", "skill.md"], false)
}

/// Parse metadata for the strict discovery path, where a readable file
/// symlink is a valid Agent-consumable marker. Legacy callers intentionally
/// stay on [`parse_skill_md`] until they also adopt `scm-dir-v2` identity.
pub fn parse_skill_md_with_file_symlinks(dir: &Path) -> SkillMeta {
    parse_skill_md_with_candidates(dir, &["SKILL.md", "skill.md"], true)
}

fn parse_skill_md_with_candidates(
    dir: &Path,
    candidates: &[&str],
    follow_file_symlinks: bool,
) -> SkillMeta {
    for candidate in candidates {
        if let Some(content) = read_named_file_exact(dir, candidate, follow_file_symlinks) {
            return parse_frontmatter(&content);
        }
    }
    SkillMeta {
        name: None,
        description: None,
    }
}

fn parse_frontmatter(content: &str) -> SkillMeta {
    let trimmed = content.trim();
    if !trimmed.starts_with("---") {
        return SkillMeta {
            name: None,
            description: None,
        };
    }

    let rest = &trimmed[3..];
    if let Some(end) = rest.find("---") {
        let yaml_str = &rest[..end];
        if let Ok(yaml) = serde_yaml::from_str::<serde_yaml::Value>(yaml_str) {
            let name = yaml
                .get("name")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let description = yaml
                .get("description")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            return SkillMeta { name, description };
        }
    }

    SkillMeta {
        name: None,
        description: None,
    }
}

/// Skill directory marker files used across the application.
const SKILL_DIR_MARKERS: &[&str] = &["SKILL.md", "skill.md"];

/// Check whether a directory looks like a valid skill directory
/// (contains at least one recognised marker file).
pub fn is_valid_skill_dir(dir: &Path) -> bool {
    dir.is_dir()
        && SKILL_DIR_MARKERS
            .iter()
            .any(|name| has_named_file_exact(dir, name, false))
}

/// Strict discovery predicate that accepts a readable file-symlink marker.
/// It is deliberately side-by-side with the legacy predicate so PR1 cannot
/// expose linked markers to the lossy legacy fingerprint/identity pipeline.
pub fn is_valid_skill_dir_with_file_symlinks(dir: &Path) -> bool {
    dir.is_dir()
        && SKILL_DIR_MARKERS
            .iter()
            .any(|name| has_named_file_exact(dir, name, true))
}

/// Characters that are invalid in Windows file/directory names.
const WINDOWS_RESERVED: &[char] = &['<', '>', ':', '"', '/', '\\', '|', '?', '*'];

/// Reserved Windows device names that cannot be used as file/directory names.
const WINDOWS_RESERVED_BASENAMES: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// Sanitize a skill name so it is safe to use as a single directory component
/// on all major platforms (macOS, Linux, Windows).
///
/// Security-focused with cross-platform safety:
/// - Strips path traversal (`../`) via `Path::file_name()`
/// - Rejects bare `.` and `..`
/// - Replaces control characters with `_` (preserves position for near-injectivity)
/// - Replaces Windows-reserved characters (`<>:"/\|?*`) with `_`
/// - Trims leading/trailing whitespace and dots (Windows rejects trailing dots)
///
/// Returns `None` if the result would be empty or unsafe.
pub fn sanitize_skill_name(name: &str) -> Option<String> {
    // Take only the last path component — strips any leading `../` sequences.
    let last = std::path::Path::new(name)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())?;

    // Reject bare `.` and `..` (file_name() returns None for `..` on most
    // platforms, but be explicit for cross-platform safety).
    if last == ".." || last == "." {
        return None;
    }

    // Replace control characters and Windows-reserved characters with `_`.
    // Using replacement instead of removal preserves character positions,
    // making the mapping nearly injective (distinct inputs → distinct outputs).
    let clean: String = last
        .chars()
        .map(|c| {
            if c.is_control() || WINDOWS_RESERVED.contains(&c) {
                '_'
            } else {
                c
            }
        })
        .collect();

    // Trim whitespace and trailing dots (Windows ignores trailing dots/spaces
    // in directory names, which would cause silent mismatches).
    let trimmed = clean.trim().trim_end_matches('.');
    if trimmed.is_empty() {
        None
    } else {
        let reserved = trimmed
            .split('.')
            .next()
            .map(|base| base.to_ascii_uppercase())
            .map(|upper| WINDOWS_RESERVED_BASENAMES.contains(&upper.as_str()))
            .unwrap_or(false);

        if reserved {
            Some(format!("_{}", trimmed))
        } else {
            Some(trimmed.to_string())
        }
    }
}

pub fn infer_skill_name(dir: &Path) -> String {
    let meta = parse_skill_md(dir);
    if let Some(name) = meta.name {
        if let Some(sanitized) = sanitize_skill_name(&name) {
            return sanitized;
        }
    }
    dir.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown-skill".to_string())
}

/// Infer the display name for strict inventory while accepting an
/// Agent-consumable `SKILL.md` file symlink. The fallback remains the visible
/// directory name so inventory never invents identity from content bytes.
pub fn infer_skill_name_with_file_symlinks(dir: &Path) -> String {
    let meta = parse_skill_md_with_file_symlinks(dir);
    if let Some(name) = meta.name {
        if let Some(sanitized) = sanitize_skill_name(&name) {
            return sanitized;
        }
    }
    dir.file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown-skill".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    // ── parse_frontmatter ──

    #[test]
    fn parse_frontmatter_full() {
        let content = "---\nname: my-skill\ndescription: A great skill\n---\n# Content";
        let meta = parse_frontmatter(content);
        assert_eq!(meta.name.as_deref(), Some("my-skill"));
        assert_eq!(meta.description.as_deref(), Some("A great skill"));
    }

    #[test]
    fn parse_frontmatter_name_only() {
        let content = "---\nname: test-skill\n---\n";
        let meta = parse_frontmatter(content);
        assert_eq!(meta.name.as_deref(), Some("test-skill"));
        assert_eq!(meta.description, None);
    }

    #[test]
    fn parse_frontmatter_no_frontmatter() {
        let content = "# Just markdown\nNo frontmatter here.";
        let meta = parse_frontmatter(content);
        assert_eq!(meta.name, None);
        assert_eq!(meta.description, None);
    }

    #[test]
    fn parse_frontmatter_empty_string() {
        let meta = parse_frontmatter("");
        assert_eq!(meta.name, None);
    }

    #[test]
    fn parse_frontmatter_invalid_yaml() {
        let content = "---\n: : broken yaml\n---\n";
        let meta = parse_frontmatter(content);
        // Should not panic, just return None
        assert_eq!(meta.name, None);
    }

    #[test]
    fn parse_frontmatter_extra_fields_ignored() {
        let content = "---\nname: foo\nauthor: bar\nversion: 1.0\n---\n";
        let meta = parse_frontmatter(content);
        assert_eq!(meta.name.as_deref(), Some("foo"));
    }

    // ── parse_skill_md (filesystem) ──

    #[test]
    fn parse_skill_md_reads_skill_md() {
        let tmp = tempdir().unwrap();
        fs::write(
            tmp.path().join("SKILL.md"),
            "---\nname: from-skill\ndescription: desc\n---\n",
        )
        .unwrap();

        let meta = parse_skill_md(tmp.path());
        assert_eq!(meta.name.as_deref(), Some("from-skill"));
        assert_eq!(meta.description.as_deref(), Some("desc"));
    }

    #[test]
    fn parse_skill_md_reads_lowercase_skill_md() {
        let tmp = tempdir().unwrap();
        fs::write(
            tmp.path().join("skill.md"),
            "---\nname: from-lowercase\ndescription: desc\n---\n",
        )
        .unwrap();

        let meta = parse_skill_md(tmp.path());
        assert_eq!(meta.name.as_deref(), Some("from-lowercase"));
        assert_eq!(meta.description.as_deref(), Some("desc"));
    }

    #[cfg(unix)]
    #[test]
    fn strict_metadata_path_accepts_file_symlink_without_widening_legacy_scanner() {
        let tmp = tempdir().unwrap();
        let source = tmp.path().join("source.md");
        fs::write(
            &source,
            "---\nname: linked-skill\ndescription: linked\n---\n",
        )
        .unwrap();
        let skill = tmp.path().join("skill");
        fs::create_dir(&skill).unwrap();
        std::os::unix::fs::symlink(&source, skill.join("SKILL.md")).unwrap();

        assert!(!is_valid_skill_dir(&skill));
        assert_eq!(parse_skill_md(&skill).name, None);

        assert!(is_valid_skill_dir_with_file_symlinks(&skill));
        let meta = parse_skill_md_with_file_symlinks(&skill);
        assert_eq!(meta.name.as_deref(), Some("linked-skill"));
        assert_eq!(meta.description.as_deref(), Some("linked"));
    }

    #[cfg(unix)]
    #[test]
    fn broken_skill_md_file_symlink_is_not_a_valid_marker() {
        let tmp = tempdir().unwrap();
        std::os::unix::fs::symlink(tmp.path().join("missing.md"), tmp.path().join("SKILL.md"))
            .unwrap();

        assert!(!is_valid_skill_dir(tmp.path()));
        assert!(!is_valid_skill_dir_with_file_symlinks(tmp.path()));
        let meta = parse_skill_md(tmp.path());
        assert_eq!(meta.name, None);
        assert_eq!(meta.description, None);
        assert_eq!(parse_skill_md_with_file_symlinks(tmp.path()).name, None);
    }

    #[test]
    fn parse_skill_md_ignores_claude_md() {
        let tmp = tempdir().unwrap();
        fs::write(
            tmp.path().join("CLAUDE.md"),
            "---\nname: from-claude\n---\n",
        )
        .unwrap();

        let meta = parse_skill_md(tmp.path());
        assert_eq!(meta.name, None);
    }

    #[test]
    fn parse_skill_md_prefers_skill_md_when_claude_md_is_present() {
        let tmp = tempdir().unwrap();
        fs::write(tmp.path().join("SKILL.md"), "---\nname: from-skill\n---\n").unwrap();
        fs::write(
            tmp.path().join("CLAUDE.md"),
            "---\nname: from-claude\n---\n",
        )
        .unwrap();

        let meta = parse_skill_md(tmp.path());
        assert_eq!(meta.name.as_deref(), Some("from-skill"));
    }

    #[test]
    fn parse_skill_md_empty_dir() {
        let tmp = tempdir().unwrap();
        let meta = parse_skill_md(tmp.path());
        assert_eq!(meta.name, None);
        assert_eq!(meta.description, None);
    }

    // ── is_valid_skill_dir ──

    #[test]
    fn is_valid_skill_dir_with_skill_md() {
        let tmp = tempdir().unwrap();
        fs::write(tmp.path().join("SKILL.md"), "content").unwrap();
        assert!(is_valid_skill_dir(tmp.path()));
    }

    #[test]
    fn is_valid_skill_dir_accepts_lowercase_skill_md() {
        let tmp = tempdir().unwrap();
        fs::write(tmp.path().join("skill.md"), "content").unwrap();
        assert!(is_valid_skill_dir(tmp.path()));
    }

    #[test]
    fn is_valid_skill_dir_ignores_readme_only_dirs() {
        let tmp = tempdir().unwrap();
        fs::write(tmp.path().join("README.md"), "content").unwrap();
        assert!(!is_valid_skill_dir(tmp.path()));
    }

    #[test]
    fn is_valid_skill_dir_ignores_claude_only_dirs() {
        let tmp = tempdir().unwrap();
        fs::write(tmp.path().join("CLAUDE.md"), "content").unwrap();
        assert!(!is_valid_skill_dir(tmp.path()));
    }

    #[test]
    fn is_valid_skill_dir_empty() {
        let tmp = tempdir().unwrap();
        assert!(!is_valid_skill_dir(tmp.path()));
    }

    #[test]
    fn is_valid_skill_dir_file_not_dir() {
        let tmp = tempdir().unwrap();
        let file = tmp.path().join("not-a-dir");
        fs::write(&file, "content").unwrap();
        assert!(!is_valid_skill_dir(&file));
    }

    // ── sanitize_skill_name ──

    #[test]
    fn sanitize_normal_name() {
        assert_eq!(sanitize_skill_name("my-skill"), Some("my-skill".into()));
    }

    #[test]
    fn sanitize_strips_path_traversal() {
        assert_eq!(
            sanitize_skill_name("../../../../.bashrc"),
            Some(".bashrc".into())
        );
    }

    #[test]
    fn sanitize_rejects_dotdot() {
        assert_eq!(sanitize_skill_name(".."), None);
        assert_eq!(sanitize_skill_name("."), None);
    }

    #[test]
    fn sanitize_preserves_spaces_and_unicode() {
        assert_eq!(
            sanitize_skill_name("my skill (v2)"),
            Some("my skill (v2)".into())
        );
        assert_eq!(sanitize_skill_name("技能-测试"), Some("技能-测试".into()));
    }

    #[test]
    fn sanitize_distinct_inputs_produce_distinct_outputs() {
        // "a b" and "a-b" must NOT collapse to the same name.
        let a = sanitize_skill_name("a b");
        let b = sanitize_skill_name("a-b");
        assert_ne!(a, b);
    }

    #[test]
    fn sanitize_replaces_control_chars_with_underscore() {
        // Replace rather than remove, so "a\x00b" → "a_b" not "ab"
        assert_eq!(sanitize_skill_name("a\x00b\x07c"), Some("a_b_c".into()));
    }

    #[test]
    fn sanitize_replaces_windows_reserved_chars() {
        assert_eq!(
            sanitize_skill_name("foo:bar*baz"),
            Some("foo_bar_baz".into())
        );
        assert_eq!(sanitize_skill_name("a<b>c"), Some("a_b_c".into()));
    }

    #[test]
    fn sanitize_trims_whitespace_and_trailing_dots() {
        assert_eq!(sanitize_skill_name("  foo  "), Some("foo".into()));
        assert_eq!(sanitize_skill_name("bar..."), Some("bar".into()));
    }

    #[test]
    fn sanitize_rejects_empty_after_cleaning() {
        assert_eq!(sanitize_skill_name("   "), None);
        assert_eq!(sanitize_skill_name("..."), None);
    }

    #[test]
    fn sanitize_control_only_input_produces_underscores() {
        // Control chars become `_`, not removed — so result is non-empty.
        assert_eq!(sanitize_skill_name("\x00\x01"), Some("__".into()));
    }

    #[test]
    fn sanitize_avoids_windows_reserved_device_names() {
        assert_eq!(sanitize_skill_name("CON"), Some("_CON".into()));
        assert_eq!(sanitize_skill_name("nul.txt"), Some("_nul.txt".into()));
        assert_eq!(sanitize_skill_name("Com1"), Some("_Com1".into()));
    }

    // ── infer_skill_name ──

    #[test]
    fn infer_skill_name_from_metadata() {
        let tmp = tempdir().unwrap();
        let skill_dir = tmp.path().join("directory-name");
        fs::create_dir_all(&skill_dir).unwrap();
        fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: metadata-name\n---\n",
        )
        .unwrap();

        assert_eq!(infer_skill_name(&skill_dir), "metadata-name");
    }

    #[test]
    fn infer_skill_name_falls_back_to_dirname() {
        let tmp = tempdir().unwrap();
        let skill_dir = tmp.path().join("my-cool-skill");
        fs::create_dir_all(&skill_dir).unwrap();

        assert_eq!(infer_skill_name(&skill_dir), "my-cool-skill");
    }
}
