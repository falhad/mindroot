//! User-installed plugins live in `<app-data>/plugins/<name>/` with a `manifest.json` and the
//! script named by its `main` field. This module only lists and reads those files; the
//! frontend decides whether to run them.

use std::fs;

use serde::Serialize;
use serde_json::Value;
use tauri::AppHandle;

use crate::storage::{paths, CmdResult};

#[derive(Serialize)]
pub struct PluginEntry {
    pub dir: String,
    pub manifest: Value,
}

fn safe_name(s: &str) -> bool {
    !s.is_empty() && !s.starts_with('.') && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

#[tauri::command]
pub fn plugins_list(app: AppHandle) -> CmdResult<Vec<PluginEntry>> {
    let mut out = Vec::new();
    for e in fs::read_dir(paths(&app)?.plugins()).map_err(|e| e.to_string())?.flatten() {
        let dir = e.file_name().to_string_lossy().into_owned();
        if !safe_name(&dir) {
            continue;
        }
        let Ok(text) = fs::read_to_string(e.path().join("manifest.json")) else { continue };
        if let Ok(manifest) = serde_json::from_str::<Value>(&text) {
            out.push(PluginEntry { dir, manifest });
        }
    }
    out.sort_by(|a, b| a.dir.cmp(&b.dir));
    Ok(out)
}

/// Read one file from a plugin folder. `file` is a single safe file name: no paths.
#[tauri::command]
pub fn plugin_read(app: AppHandle, dir: String, file: String) -> CmdResult<String> {
    if !safe_name(&dir) || !safe_name(&file) {
        return Err("invalid plugin path".into());
    }
    fs::read_to_string(paths(&app)?.plugins().join(dir).join(file)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn plugins_path(app: AppHandle) -> CmdResult<String> {
    Ok(paths(&app)?.plugins().to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::safe_name;

    #[test]
    fn rejects_path_tricks() {
        assert!(safe_name("my-plugin.1"));
        for bad in ["", ".hidden", "a/b", "..", "a b", "a\\b"] {
            assert!(!safe_name(bad), "{bad}");
        }
    }
}
