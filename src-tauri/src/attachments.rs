//! Opening an attached file with the system's default app.
//!
//! The vault keeps files under hash names. To open one we copy it into a private folder under its
//! real name (so the viewer shows a readable title), then ask the OS to open that copy.
//! Only document, image, audio and video types on an allowlist are opened. For any other type
//! (programs, scripts, archives, unknown) the file is only *shown* in the file manager, so
//! nothing can run by a click inside Branchmint.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Runtime};
use tauri_plugin_opener::OpenerExt;

use crate::storage::{paths, validate_asset_name, CmdResult};

/// Extensions that are safe to open with the default app. Must match `OPENABLE` in `src/io/attachments.ts`.
const OPENABLE: &[&str] = &[
    "pdf", "png", "jpg", "jpeg", "gif", "webp", "txt", "md", "csv", "rtf", "docx", "xlsx", "pptx", "odt", "ods", "odp", "mp3", "m4a", "wav", "mp4", "mov", "webm",
];

pub fn is_openable(asset: &str) -> bool {
    asset.rsplit('.').next().is_some_and(|e| OPENABLE.contains(&e))
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

/// Copy the asset to `<private>/<hash-prefix>/<name>` and return that path. The folder is only
/// accessible to the user, an old copy is replaced, and the file is created with `create_new` so a
/// planted link or file cannot redirect the write.
pub fn prepare_copy(assets: &Path, private: &Path, asset: &str, display: &str) -> CmdResult<PathBuf> {
    validate_asset_name(asset)?;
    let bytes = fs::read(assets.join(asset)).map_err(|e| format!("Could not read the attachment: {e}"))?;
    let dir = private.join(&asset[..16]);
    let _ = fs::remove_dir_all(&dir); // a viewer may still hold the old copy on Windows; then create_new below fails clearly
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(private, fs::Permissions::from_mode(0o700));
        let _ = fs::set_permissions(&dir, fs::Permissions::from_mode(0o700));
    }
    let target = dir.join(display_file_name(display, asset));
    let mut f = fs::OpenOptions::new().write(true).create_new(true).open(&target).map_err(|e| format!("Could not create the copy: {e}"))?;
    f.write_all(&bytes).map_err(|e| e.to_string())?;
    f.sync_all().map_err(|e| e.to_string())?;
    Ok(target)
}

/// Open a safe type with its default app; show any other type in the file manager instead.
/// Returns `"opened"` or `"revealed"`.
#[tauri::command]
pub fn open_attachment<R: Runtime>(app: AppHandle<R>, name: String, display: String) -> CmdResult<String> {
    let p = paths(&app)?;
    let target = prepare_copy(&p.assets(), &p.cache().join("open"), &name, &display)?;
    if is_openable(&name) {
        app.opener().open_path(target.to_string_lossy(), None::<&str>).map_err(|e| e.to_string())?;
        Ok("opened".into())
    } else {
        app.opener().reveal_item_in_dir(&target).map_err(|e| e.to_string())?;
        Ok("revealed".into())
    }
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
    fn only_allowlisted_types_are_openable() {
        for ok in ["pdf", "png", "docx", "txt", "mp4"] {
            assert!(is_openable(&format!("{H}.{ok}")), "{ok}");
        }
        for bad in ["sh", "exe", "app", "command", "zip", "svg", "html", "bin", "py", "jar", "docm", "xlsm", "workflow", "terminal"] {
            assert!(!is_openable(&format!("{H}.{bad}")), "{bad}");
        }
    }

    #[test]
    fn copies_into_a_private_folder_and_replaces_planted_files() {
        let base = std::env::temp_dir().join(format!("bm-attach-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let assets = base.join("assets");
        fs::create_dir_all(&assets).unwrap();
        fs::write(assets.join(format!("{H}.pdf")), b"%PDF").unwrap();
        let private = base.join("private");
        // a planted symlink where the copy will go must not be written through
        #[cfg(unix)]
        {
            let victim = base.join("victim.txt");
            fs::write(&victim, b"keep").unwrap();
            let dir = private.join(&H[..16]);
            fs::create_dir_all(&dir).unwrap();
            std::os::unix::fs::symlink(&victim, dir.join("My plan.pdf")).unwrap();
            let out = prepare_copy(&assets, &private, &format!("{H}.pdf"), "My plan").unwrap();
            assert_eq!(fs::read(&out).unwrap(), b"%PDF");
            assert_eq!(fs::read(&victim).unwrap(), b"keep");
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(fs::metadata(&private).unwrap().permissions().mode() & 0o077, 0);
        }
        let out = prepare_copy(&assets, &private, &format!("{H}.pdf"), "My plan").unwrap();
        assert!(out.file_name().unwrap().to_string_lossy().ends_with("My plan.pdf"));
        assert!(prepare_copy(&assets, &private, "../evil.pdf", "x").is_err());
        assert!(prepare_copy(&assets, &private, &format!("{}.pdf", "b".repeat(64)), "x").is_err()); // missing asset
        let _ = fs::remove_dir_all(&base);
    }
}
