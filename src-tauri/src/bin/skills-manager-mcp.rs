//! MCP stdio entry point. stdout contains JSON-RPC only.
use app_lib::core::{app_state, evaluation_runtime, mcp_bridge, mcp_server};

fn main() {
    if std::env::args().any(|arg| arg == "--version") {
        println!("Skill Card Manager MCP {}", mcp_bridge::CONTRACT_VERSION);
        return;
    }
    if std::env::args().any(|arg| arg == "--help") {
        println!("Skill Card Manager MCP\nUsage: skills-manager-mcp\nTransport: newline-delimited JSON-RPC over stdio.\nEnable access in Skill Card Manager → Connect assistants.");
        return;
    }
    if let Err(error) = run() {
        eprintln!("Skill Manager MCP: {error}");
        std::process::exit(1);
    }
}

fn run() -> anyhow::Result<()> {
    // Same evaluation isolation contract as the CLI; no ad-hoc HOME rewriting.
    let _evaluation = evaluation_runtime::apply_from_env()?;
    mcp_bridge::validate_running_bridge()?;
    let store = app_state::initialize_cli_store()?;
    mcp_server::serve_stdio(&store)
}
