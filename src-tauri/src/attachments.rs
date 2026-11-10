//! Opening an attached file with the system's default app.
//!
//! The vault keeps files under hash names. To open one we copy it to a temporary folder under its
//! real name (so the viewer shows a readable title), then ask the OS to open that copy. Program
//! files are refused: opening one would run it.

use std::fs;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Runtime};
use tauri_plugin_opener::OpenerExt;

use crate::storage::{paths, validate_asset_name, CmdResult};

/// Extensions that can run code when opened. Must match `RISKY` in `src/io/attachments.ts`.
const RISKY: &[&str] = &[
    "exe", "bat", "cmd", "com", "scr", "msi", "sh", "command", "app", "jar", "js", "vbs", "ps1", "dmg", "pkg", "lnk", "desktop", "appimage", "deb", "rpm",
];

pub fn is_risky(asset: &str) -> bool {
    asset.rsplit('.').next().is_some_and(|e| RISKY.contains(&e))
}

/// A file name that is safe to create: no folders, no control characters, no leading dot, at most 100 characters,
/// and it ends with the asset's own extension.
pub fn display_file_name(display: &str, asset: &str) -> String {
    let ext = asset.rsplit('.').next().unwrap_or("bin");
    let cleaned: String = display
        .chars()
        .map(|c| if c.is_control() || matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') { '_' } else { c })
        .collect();
    let cleaned = cleaned.trim().trim_start_matches('.').to_string();
    let mut base: String = cleaned.chars().take(100).collect();
    if base.is_empty() {
        base = "attachment".into();
    }
    if base.to_lowercase().ends_with(&format!(".{ext}")) { base } else { format!("{base}.{ext}") }
}

/// Copy the asset to `<temp>/branchmint-open/<hash-prefix>/<name>` and return that path.
pub fn prepare_copy(assets: &Path, temp: &Path, asset: &str, display: &str) -> CmdResult<PathBuf> {
    validate_asset_name(asset)?;
    if is_risky(asset) {
        return Err("Program files are not opened from Branchmint".into());
    }
    let dir = temp.join("branchmint-open").join(&asset[..16]);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let target = dir.join(display_file_name(display, asset));
    fs::copy(assets.join(asset), &target).map_err(|e| format!("Could not read the attachment: {e}"))?;
    Ok(target)
}

#[tauri::command]
pub fn open_attachment<R: Runtime>(app: AppHandle<R>, name: String, display: String) -> CmdResult<()> {
    let target = prepare_copy(&paths(&app)?.assets(), &std::env::temp_dir(), &name, &display)?;
    app.opener().open_path(target.to_string_lossy(), None::<&str>).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const H: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    #[test]
    fn display_names_are_safe() {
        assert_eq!(display_file_name("../../etc/passwd", &format!("{H}.txt")), "_.._etc_passwd.txt");
        assert_eq!(display_file_name("Plan.PDF", &format!("{H}.pdf")), "Plan.PDF");
        assert_eq!(display_file_name("", &format!("{H}.pdf")), "attachment.pdf");
        assert_eq!(display_file_name("report", &format!("{H}.pdf")), "report.pdf");
        assert_eq!(display_file_name(".hidden", &format!("{H}.pdf")), "hidden.pdf");
        assert_eq!(display_file_name("a\nb", &format!("{H}.pdf")), "a_b.pdf");
        assert_eq!(display_file_name(&"x".repeat(300), &format!("{H}.pdf")).len(), 104);
    }

    #[test]
    fn risky_files_are_refused_and_others_are_copied() {
        let base = std::env::temp_dir().join(format!("bm-attach-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let assets = base.join("assets");
        fs::create_dir_all(&assets).unwrap();
        fs::write(assets.join(format!("{H}.sh")), b"echo hi").unwrap();
        fs::write(assets.join(format!("{H}.pdf")), b"%PDF").unwrap();
        let temp = base.join("tmp");
        assert!(prepare_copy(&assets, &temp, &format!("{H}.sh"), "run.sh").is_err());
        let out = prepare_copy(&assets, &temp, &format!("{H}.pdf"), "My plan").unwrap();
        assert_eq!(fs::read(&out).unwrap(), b"%PDF");
        assert!(out.file_name().unwrap().to_string_lossy().ends_with("My plan.pdf"));
        assert!(prepare_copy(&assets, &temp, "../evil.pdf", "x").is_err());
        let _ = fs::remove_dir_all(&base);
    }
}
