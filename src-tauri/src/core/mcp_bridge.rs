//! Stable MCP executable used by assistant configurations. Independent of the
//! legacy CLI bridge: neither its filename nor its version stamp is reused.
use super::central_repo;
use anyhow::{bail, Context, Result};
use std::path::{Path, PathBuf};

pub const CONTRACT_VERSION: &str =
    concat!(env!("FOUNDATION_APP_VERSION"), "-library-scenes-mcp-v1");
const BIN: &str = if cfg!(windows) {
    "skills-manager-mcp.exe"
} else {
    "skills-manager-mcp"
};

pub fn bridge_path() -> PathBuf {
    central_repo::home_base_dir().join("bin").join(BIN)
}
fn stamp_path() -> PathBuf {
    central_repo::home_base_dir().join("bin/.mcp-version")
}
pub fn ready() -> bool {
    bridge_path().is_file()
        && std::fs::read_to_string(stamp_path())
            .ok()
            .as_deref()
            .map(str::trim)
            == Some(CONTRACT_VERSION)
}

/// A failed upgrade invalidates old MCP clients even if the binary could not
/// be replaced (for example, an executable held open on Windows).
pub fn validate_running_bridge() -> Result<()> {
    if std::env::current_exe()? == bridge_path() && !ready() {
        bail!("MCP bridge version is stale. Open Skill Card Manager and reconnect the assistant.");
    }
    Ok(())
}

fn verify(path: &Path) -> Result<()> {
    let mut command = std::process::Command::new(path);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let output = command
        .arg("--version")
        .output()
        .context("Cannot run MCP binary")?;
    if !output.status.success()
        || String::from_utf8_lossy(&output.stdout)
            .split_whitespace()
            .last()
            != Some(CONTRACT_VERSION)
    {
        bail!("MCP binary does not match this app build");
    }
    Ok(())
}

pub fn ensure_bridge() -> Result<PathBuf> {
    let exe = std::env::current_exe()?;
    let source = exe.parent().context("No application directory")?.join(BIN);
    let target = bridge_path();
    if source == target {
        verify(&target)?;
        validate_running_bridge()?;
        return Ok(target);
    }
    if !source.is_file() {
        bail!("This app build is missing the bundled MCP executable");
    }
    verify(&source)?;
    std::fs::create_dir_all(target.parent().context("No MCP bridge directory")?)?;
    let _lock = super::repo_lock::RepoLock::acquire_foreground("publish MCP bridge")?;
    // Hash the executable as well as checking its version: development builds
    // can change without a product version bump.
    let same_bytes = ready() && std::fs::read(&source).ok() == std::fs::read(&target).ok();
    if same_bytes {
        verify(&target)?;
        return Ok(target);
    }
    match std::fs::remove_file(stamp_path()) {
        Ok(()) => (),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
        Err(e) => return Err(e).context("Cannot invalidate the old MCP bridge"),
    }
    let staged = target.with_file_name(format!(".{BIN}.{}", uuid::Uuid::new_v4()));
    let result = (|| {
        std::fs::copy(&source, &staged)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&staged, std::fs::Permissions::from_mode(0o755))?;
        }
        verify(&staged)?;
        std::fs::rename(&staged, &target)?;
        std::fs::write(stamp_path(), CONTRACT_VERSION)?;
        Ok(target)
    })();
    if staged.exists() {
        let _ = std::fs::remove_file(&staged);
    }
    result
}
