//! Static regression guard for the async-command invariant (CLAUDE.md):
//! any `#[tauri::command]` that touches serial or network transport MUST be
//! `async fn`, so blocking I/O never runs on the webview thread.
//!
//! This test parses `src/commands.rs` line-by-line, extracts every
//! `#[tauri::command]` function and whether it is `async`, and asserts that
//! the set of NON-async commands equals the hardcoded allowlist below of
//! purely-local commands (config reads, community TOML/JSON loaders, pure
//! formatters — no blocking transport/protocol I/O). Any NEW sync command
//! that is not added to this allowlist fails CI.

use std::collections::BTreeSet;
use std::path::Path;

/// Commands that are allowed to stay sync: purely local work only, no
/// serial/network transport and no blocking adapter I/O. Each entry is
/// justified in the issue #86 classification:
///
/// - `list_ports` — local OS serial-port enumeration; never opens a port.
/// - `get_freeze_schema` / `save_freeze_schema` / `load_freeze_schemas` —
///   in-memory registry / community TOML files on local disk.
/// - `list_profiles` / `export_profile` / `import_profiles` / `add_to_profile`
///   — in-memory live-data profile registry + TOML (de)serialisation.
/// - `watch_start` / `watch_stop` — set/clear the in-memory watch session
///   mutex; the transport poll lives in async `watch_tick`.
/// - `list_service_functions` — static in-memory table.
/// - `is_unlocked` / `security_status` — in-memory `unlocked` HashSet reads;
///   the transport exchange lives in async `security_access`.
/// - `get_traffic` / `clear_traffic` — in-memory recording-log snapshot/clear.
/// - `community_report` — in-memory community load report.
/// - `analyze_chart` / `open_path` / `export_text` / `import_session` /
///   `import_session_file` / `list_exports` — local filesystem / subprocess
///   utilities, no vehicle transport. (`analyze_chart` spawns Python and is
///   a candidate for a follow-up async conversion, but it is outside the
///   transport scope of issue #86.)
/// - `generate_story` / `anonymize_snapshot` / `get_opinions` — pure
///   in-memory transforms over data already fetched.
const SYNC_ALLOWLIST: &[&str] = &[
    "add_to_profile",
    "analyze_chart",
    "anonymize_snapshot",
    "clear_traffic",
    "community_report",
    "export_profile",
    "export_text",
    "generate_story",
    "get_freeze_schema",
    "get_opinions",
    "get_traffic",
    "import_profiles",
    "import_session",
    "import_session_file",
    "is_unlocked",
    "list_exports",
    "list_ports",
    "list_profiles",
    "list_service_functions",
    "load_freeze_schemas",
    "open_path",
    "save_freeze_schema",
    "security_status",
    "watch_start",
    "watch_stop",
];

/// Extract every `#[tauri::command]` fn as (name, is_async).
fn parse_commands(source: &str) -> Vec<(String, bool)> {
    let lines: Vec<&str> = source.lines().collect();
    let mut out = Vec::new();
    for (i, line) in lines.iter().enumerate() {
        if line.trim() != "#[tauri::command]" {
            continue;
        }
        // Find the fn signature on the following lines.
        for sig in lines.iter().skip(i + 1) {
            let sig = sig.trim();
            if sig.is_empty() {
                continue;
            }
            let is_async = sig.starts_with("pub async fn ");
            let rest = sig
                .strip_prefix("pub async fn ")
                .or_else(|| sig.strip_prefix("pub fn "));
            if let Some(rest) = rest {
                let name: String = rest
                    .chars()
                    .take_while(|c| c.is_ascii_alphanumeric() || *c == '_')
                    .collect();
                assert!(!name.is_empty(), "failed to parse fn name after line {i}");
                out.push((name, is_async));
            }
            break;
        }
    }
    out
}

#[test]
fn only_allowlisted_commands_may_be_sync() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("src/commands.rs");
    let source = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()));
    let commands = parse_commands(&source);

    // Guard against the parser silently matching nothing.
    assert!(
        commands.len() >= 45,
        "expected at least 45 #[tauri::command] fns, parsed {}",
        commands.len()
    );

    let sync: BTreeSet<&str> = commands
        .iter()
        .filter(|(_, is_async)| !is_async)
        .map(|(name, _)| name.as_str())
        .collect();
    let allowlist: BTreeSet<&str> = SYNC_ALLOWLIST.iter().copied().collect();

    let unexpected: Vec<_> = sync.difference(&allowlist).collect();
    let missing: Vec<_> = allowlist.difference(&sync).collect();
    assert!(
        unexpected.is_empty() && missing.is_empty(),
        "sync Tauri commands diverged from the purely-local allowlist.\n\
         non-async but not allowlisted (must be async, or justify + allowlist): {unexpected:?}\n\
         allowlisted but now async (remove from allowlist): {missing:?}"
    );
}
