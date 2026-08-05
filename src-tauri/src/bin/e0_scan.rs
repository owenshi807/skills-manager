use app_lib::core::codex_plugins;
use app_lib::core::scanner::{group_discovered, scan_local_skills_with_adapters};
use app_lib::core::tool_adapters::{ToolAdapter, ToolCategory};
use serde::Serialize;
use std::collections::{HashMap, HashSet};

#[derive(Serialize)]
struct E0Summary {
    loose_locations: usize,
    plugin_locations: usize,
    total_locations: usize,
    identity_groups: usize,
    names_with_multiple_fingerprints: usize,
    enabled_plugins: usize,
    plugin_locations_with_complete_provenance: usize,
    plugin_owners: usize,
    locations_by_root: HashMap<String, usize>,
    diagnostics: Vec<codex_plugins::DiscoveryDiagnostic>,
}

fn adapter(label: &str, path: String) -> ToolAdapter {
    ToolAdapter {
        key: label.to_string(),
        display_name: label.to_string(),
        relative_skills_dir: String::new(),
        relative_detect_dir: String::new(),
        additional_scan_dirs: Vec::new(),
        override_skills_dir: Some(path),
        is_custom: true,
        recursive_scan: false,
        project_relative_skills_dir: None,
        category: ToolCategory::Coding,
    }
}

fn main() -> anyhow::Result<()> {
    let home = dirs::home_dir().ok_or_else(|| anyhow::anyhow!("home directory unavailable"))?;
    let adapters = vec![
        adapter(
            "shared",
            home.join(".agents/skills").to_string_lossy().into_owned(),
        ),
        adapter(
            "claude",
            home.join(".claude/skills").to_string_lossy().into_owned(),
        ),
        adapter(
            "codex",
            home.join(".codex/skills").to_string_lossy().into_owned(),
        ),
    ];
    let mut loose = scan_local_skills_with_adapters(&[], &adapters)?;
    let plugin_scan = codex_plugins::scan_active_plugin_skills(&[]);

    let loose_locations = loose.discovered.len();
    let plugin_locations = plugin_scan.discovered.len();
    let plugin_locations_with_complete_provenance = plugin_scan
        .discovered
        .iter()
        .filter(|record| {
            record.provenance.as_ref().is_some_and(|provenance| {
                provenance.owner_type == "codex_plugin"
                    && !provenance.owner_id.is_empty()
                    && provenance.source_marketplace.is_some()
                    && provenance.source_type.is_some()
                    && provenance.source_ref.is_some()
                    && provenance.source_revision.is_some()
                    && provenance.source_subpath.is_some()
            })
        })
        .count();
    let plugin_owners = plugin_scan
        .discovered
        .iter()
        .filter_map(|record| record.provenance.as_ref().map(|p| p.owner_id.as_str()))
        .collect::<HashSet<_>>()
        .len();

    loose.discovered.extend(plugin_scan.discovered);
    let groups = group_discovered(&loose.discovered);
    let mut fingerprints_by_name: HashMap<String, HashSet<String>> = HashMap::new();
    let mut locations_by_root = HashMap::new();
    for record in &loose.discovered {
        let root = record
            .provenance
            .as_ref()
            .map(|provenance| provenance.owner_id.clone())
            .unwrap_or_else(|| record.tool.clone());
        *locations_by_root.entry(root).or_insert(0) += 1;
        if let (Some(name), Some(fingerprint)) = (&record.name_guess, &record.fingerprint) {
            fingerprints_by_name
                .entry(name.clone())
                .or_default()
                .insert(fingerprint.clone());
        }
    }

    let summary = E0Summary {
        loose_locations,
        plugin_locations,
        total_locations: loose.discovered.len(),
        identity_groups: groups.len(),
        names_with_multiple_fingerprints: fingerprints_by_name
            .values()
            .filter(|fingerprints| fingerprints.len() > 1)
            .count(),
        enabled_plugins: plugin_scan.enabled_plugins,
        plugin_locations_with_complete_provenance,
        plugin_owners,
        locations_by_root,
        diagnostics: plugin_scan.diagnostics,
    };
    println!("{}", serde_json::to_string_pretty(&summary)?);
    Ok(())
}
