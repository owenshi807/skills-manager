fn main() {
    println!("cargo:rerun-if-changed=tauri.conf.json");
    let config: serde_json::Value = serde_json::from_str(&std::fs::read_to_string("tauri.conf.json").expect("App config")).expect("App config JSON");
    println!("cargo:rustc-env=FOUNDATION_APP_VERSION={}", config["version"].as_str().expect("App version"));
    // Use a custom Windows application manifest that opts the process into long
    // path support (#298/#299). app_manifest() replaces Tauri's default, so the
    // manifest file re-declares the Common-Controls v6 dependency Tauri ships.
    // On non-Windows targets the manifest is simply ignored.
    tauri_build::try_build(
        tauri_build::Attributes::new().windows_attributes(
            tauri_build::WindowsAttributes::new()
                .app_manifest(include_str!("windows-app-manifest.xml")),
        ),
    )
    .expect("failed to run tauri-build");
}
