//! Installing plugins from the gallery.
//!
//! A plugin is a zip with `manifest.json` and a script. The app downloads it over https, checks its
//! SHA-256 against the value in the gallery index BEFORE opening the archive, then unpacks it with
//! strict path checks into `<app-data>/plugins/<id>/`. Installed plugins start switched off: the user
//! decides to run them (the frontend keeps that choice).
//!
//! The gallery entry says which plugin id and which permissions the user was shown. The zip must match
//! both: a different id, or a manifest that asks for more than was shown, is refused.

use std::fs;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};

use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Runtime};

use crate::net::check_url;
use crate::storage::{paths, validate_plugin_id, CmdResult};

const MAX_DOWNLOAD: usize = 5 * 1024 * 1024;
const MAX_UNPACKED: u64 = 10 * 1024 * 1024;
const MAX_ENTRIES: usize = 100;

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn is_sha256(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// A path inside the archive that stays inside the plugin folder: relative, no `..`, no drive letters, no backslashes.
fn safe_entry_path(name: &str) -> Option<PathBuf> {
    if name.is_empty() || name.contains('\\') || name.contains(':') || name.contains('\0') {
        return None;
    }
    let p = Path::new(name);
    if p.is_absolute() {
        return None;
    }
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            Component::Normal(s) => {
                let s = s.to_string_lossy();
                if s.starts_with('.') && s != "." {
                    return None; // hidden files and `..`-like names are not plugin files
                }
                out.push(s.as_ref());
            }
            Component::CurDir => {}
            _ => return None,
        }
    }
    if out.as_os_str().is_empty() { None } else { Some(out) }
}

/// Verify the hash, unpack into a temporary folder, validate the manifest, then move it into place.
/// Returns the plugin id.
pub fn install_zip(bytes: &[u8], expected_sha256: &str, expected_id: &str, shown_permissions: &[String], plugins_dir: &Path) -> CmdResult<String> {
    validate_plugin_id(expected_id)?;
    let expected = expected_sha256.to_ascii_lowercase();
    if !is_sha256(&expected) {
        return Err("The gallery entry has no valid SHA-256".into());
    }
    let actual = hex(&Sha256::digest(bytes));
    if actual != expected {
        return Err("The downloaded file does not match its SHA-256, so it was not installed".into());
    }

    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(|_| "The download is not a valid zip file".to_string())?;
    if zip.len() > MAX_ENTRIES {
        return Err("The plugin has too many files".into());
    }

    // names first: they decide if there is a single top folder to strip
    let mut names = Vec::new();
    for i in 0..zip.len() {
        let f = zip.by_index(i).map_err(|e| e.to_string())?;
        let rel = safe_entry_path(f.name()).ok_or_else(|| format!("The plugin contains an unsafe path: {:?}", f.name()))?;
        names.push((i, rel, f.is_dir(), f.unix_mode().map(|m| m & 0o170000 == 0o120000).unwrap_or(false)));
    }
    if names.iter().any(|(_, _, _, symlink)| *symlink) {
        return Err("The plugin contains a link, which is not allowed".into());
    }
    let strip = {
        let firsts: Vec<_> = names.iter().map(|(_, p, _, _)| p.components().next().map(|c| c.as_os_str().to_owned())).collect();
        let all_nested = names.iter().all(|(_, p, d, _)| p.components().count() > 1 || *d);
        match firsts.first() {
            Some(Some(f)) if all_nested && firsts.iter().all(|x| x.as_ref() == Some(f)) => 1,
            _ => 0,
        }
    };

    let tmp = plugins_dir.join(format!(".install-{}", std::process::id()));
    let _ = fs::remove_dir_all(&tmp);
    fs::create_dir_all(&tmp).map_err(|e| e.to_string())?;
    let result = (|| -> CmdResult<String> {
        let mut total: u64 = 0;
        for (i, rel, is_dir, _) in &names {
            let rel: PathBuf = rel.components().skip(strip).collect();
            if rel.as_os_str().is_empty() {
                continue;
            }
            let target = tmp.join(&rel);
            if *is_dir {
                fs::create_dir_all(&target).map_err(|e| e.to_string())?;
                continue;
            }
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let mut f = zip.by_index(*i).map_err(|e| e.to_string())?;
            // count what is really unpacked, not what the archive header claims
            let room = MAX_UNPACKED.saturating_sub(total);
            let mut buf = Vec::new();
            f.by_ref().take(room + 1).read_to_end(&mut buf).map_err(|e| e.to_string())?;
            total += buf.len() as u64;
            if total > MAX_UNPACKED {
                return Err("The plugin is too large when unpacked".into());
            }
            let mut out = fs::OpenOptions::new().write(true).create_new(true).open(&target).map_err(|e| e.to_string())?;
            out.write_all(&buf).map_err(|e| e.to_string())?;
        }
        let manifest_text = fs::read_to_string(tmp.join("manifest.json")).map_err(|_| "The plugin has no manifest.json".to_string())?;
        let manifest: Value = serde_json::from_str(&manifest_text).map_err(|_| "manifest.json is not valid JSON".to_string())?;
        let id = manifest.get("id").and_then(Value::as_str).ok_or("manifest.json has no id")?.to_string();
        validate_plugin_id(&id)?;
        if id != expected_id {
            return Err(format!("The plugin says it is {id:?}, but the gallery entry is {expected_id:?}, so it was not installed"));
        }
        let asked: Vec<&str> = manifest.get("permissions").and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_str).collect()).unwrap_or_default();
        if let Some(extra) = asked.iter().find(|p| !shown_permissions.iter().any(|s| s == **p)) {
            return Err(format!("The plugin asks for the permission {extra:?}, which the gallery did not show, so it was not installed"));
        }
        let main = manifest.get("main").and_then(Value::as_str).unwrap_or("index.js");
        if main.is_empty() || main.starts_with('.') || !main.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-')) {
            return Err("manifest.json has an unsafe \"main\" file name".into());
        }
        if !tmp.join(main).is_file() {
            return Err(format!("The plugin has no {main}"));
        }
        let dest = plugins_dir.join(&id);
        if dest.exists() {
            fs::remove_dir_all(&dest).map_err(|e| e.to_string())?;
        }
        fs::rename(&tmp, &dest).map_err(|e| e.to_string())?;
        Ok(id)
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&tmp);
    }
    result
}

/// Download a plugin zip (https, 5 MB at most), check it against `sha256`, and install it. Returns the plugin id.
#[tauri::command]
pub async fn plugin_install<R: Runtime>(app: AppHandle<R>, url: String, sha256: String, id: String, permissions: Vec<String>) -> CmdResult<String> {
    let url = check_url(&url)?;
    let dir = paths(&app)?.plugins();
    let client = reqwest::Client::builder()
        // every hop must be https (a redirect must not lead the download to plain http or another scheme)
        .redirect(reqwest::redirect::Policy::custom(|a| if a.url().scheme() == "https" && a.previous().len() < 5 { a.follow() } else { a.stop() }))
        .timeout(std::time::Duration::from_secs(60))
        .user_agent("Mindroot")
        .build()
        .map_err(|e| e.to_string())?;
    let mut res = client.get(url).send().await.map_err(|e| format!("Download failed: {}", e.without_url()))?;
    if !res.status().is_success() {
        return Err(format!("Download failed: the server answered {}", res.status().as_u16()));
    }
    let mut bytes: Vec<u8> = Vec::new();
    while let Some(chunk) = res.chunk().await.map_err(|e| format!("Download failed: {}", e.without_url()))? {
        if bytes.len() + chunk.len() > MAX_DOWNLOAD {
            return Err("The plugin download is too large (limit 5 MB)".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    install_zip(&bytes, &sha256, &id, &permissions, &dir)
}

/// Remove an installed plugin folder.
#[tauri::command]
pub fn plugin_uninstall<R: Runtime>(app: AppHandle<R>, id: String) -> CmdResult<()> {
    validate_plugin_id(&id)?;
    let dir = paths(&app)?.plugins().join(&id);
    if dir.is_dir() {
        fs::remove_dir_all(dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write as _;
    use zip::write::SimpleFileOptions;

    fn make_zip(files: &[(&str, &[u8])]) -> Vec<u8> {
        let mut w = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        for (name, data) in files {
            w.start_file(*name, SimpleFileOptions::default()).unwrap();
            w.write_all(data).unwrap();
        }
        w.finish().unwrap().into_inner()
    }
    fn sha(b: &[u8]) -> String {
        hex(&Sha256::digest(b))
    }
    fn tmp(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("mr-gallery-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&p);
        fs::create_dir_all(&p).unwrap();
        p
    }
    const MANIFEST: &[u8] = br#"{"id":"acme.hello","name":"Hello","version":"1.0.0"}"#;

    #[test]
    fn installs_a_good_plugin_with_files_at_the_root() {
        let dir = tmp("root");
        let z = make_zip(&[("manifest.json", MANIFEST), ("index.js", b"export default {}")]);
        assert_eq!(install_zip(&z, &sha(&z), "acme.hello", &[], &dir).unwrap(), "acme.hello");
        assert!(dir.join("acme.hello/index.js").is_file());
        assert!(dir.join("acme.hello/manifest.json").is_file());
        assert!(fs::read_dir(&dir).unwrap().flatten().all(|e| !e.file_name().to_string_lossy().starts_with(".install")));
    }

    #[test]
    fn strips_a_single_top_folder() {
        let dir = tmp("nested");
        let z = make_zip(&[("hello/manifest.json", MANIFEST), ("hello/index.js", b"x")]);
        assert_eq!(install_zip(&z, &sha(&z), "acme.hello", &[], &dir).unwrap(), "acme.hello");
        assert!(dir.join("acme.hello/manifest.json").is_file());
    }

    #[test]
    fn rejects_a_wrong_sha256_before_opening_the_archive() {
        let dir = tmp("sha");
        let z = make_zip(&[("manifest.json", MANIFEST), ("index.js", b"x")]);
        let e = install_zip(&z, &"0".repeat(64), "acme.hello", &[], &dir).unwrap_err();
        assert!(e.contains("SHA-256"), "{e}");
        assert!(install_zip(b"not a zip at all", &sha(b"not a zip at all"), "acme.hello", &[], &dir).unwrap_err().contains("zip"));
        assert!(install_zip(&z, "short", "acme.hello", &[], &dir).is_err());
        assert!(!dir.join("acme.hello").exists());
        // upper-case hex from a hand-written index is fine
        assert!(install_zip(&z, &sha(&z).to_uppercase(), "acme.hello", &[], &dir).is_ok());
    }

    #[test]
    fn rejects_zip_slip_and_odd_paths() {
        for bad in ["../evil.js", "a/../../evil.js", "/abs.js", "..\\evil.js", "C:evil.js", ".hidden/x"] {
            let dir = tmp("slip");
            let z = make_zip(&[("manifest.json", MANIFEST), ("index.js", b"x"), (bad, b"evil")]);
            let e = install_zip(&z, &sha(&z), "acme.hello", &[], &dir).unwrap_err();
            assert!(e.contains("unsafe path"), "{bad}: {e}");
            assert!(!dir.join("acme.hello").exists(), "{bad}");
            assert!(!dir.parent().unwrap().join("evil.js").exists(), "{bad}");
        }
    }

    #[test]
    fn rejects_missing_or_bad_manifests_and_main_files() {
        let cases: Vec<(&str, Vec<(&str, &[u8])>)> = vec![
            ("no manifest", vec![("index.js", b"x")]),
            ("manifest is not json", vec![("manifest.json", b"{{"), ("index.js", b"x")]),
            ("no id", vec![("manifest.json", br#"{"name":"x"}"#), ("index.js", b"x")]),
            ("bad id", vec![("manifest.json", br#"{"id":"../x"}"#), ("index.js", b"x")]),
            ("missing main", vec![("manifest.json", MANIFEST)]),
            ("main with a path", vec![("manifest.json", br#"{"id":"a.b","main":"../x.js"}"#), ("index.js", b"x")]),
        ];
        for (name, files) in cases {
            let dir = tmp("bad");
            let z = make_zip(&files);
            assert!(install_zip(&z, &sha(&z), "acme.hello", &[], &dir).is_err(), "{name}");
            assert_eq!(fs::read_dir(&dir).unwrap().count(), 0, "{name}: nothing is left behind");
        }
    }

    #[test]
    fn an_update_replaces_the_old_files() {
        let dir = tmp("update");
        let z1 = make_zip(&[("manifest.json", MANIFEST), ("index.js", b"old"), ("old-only.txt", b"x")]);
        install_zip(&z1, &sha(&z1), "acme.hello", &[], &dir).unwrap();
        let z2 = make_zip(&[("manifest.json", MANIFEST), ("index.js", b"new")]);
        install_zip(&z2, &sha(&z2), "acme.hello", &[], &dir).unwrap();
        assert_eq!(fs::read(dir.join("acme.hello/index.js")).unwrap(), b"new");
        assert!(!dir.join("acme.hello/old-only.txt").exists());
    }

    #[test]
    fn the_plugin_must_be_the_one_the_gallery_listed() {
        let dir = tmp("identity");
        let z = make_zip(&[("manifest.json", MANIFEST), ("index.js", b"x")]);
        // a different id than the entry: refused, and an existing plugin with the real id is not touched
        let good = make_zip(&[("manifest.json", br#"{"id":"acme.other","name":"Other","version":"1.0.0"}"#), ("index.js", b"keep")]);
        install_zip(&good, &sha(&good), "acme.other", &[], &dir).unwrap();
        let e = install_zip(&z, &sha(&z), "acme.other", &[], &dir).unwrap_err();
        assert!(e.contains("gallery entry"), "{e}");
        assert_eq!(fs::read(dir.join("acme.other/index.js")).unwrap(), b"keep");
        assert!(!dir.join("acme.hello").exists());
        assert!(install_zip(&z, &sha(&z), "../x", &[], &dir).is_err());
    }

    #[test]
    fn permissions_must_have_been_shown_to_the_user() {
        let dir = tmp("perms");
        let m: &[u8] = br#"{"id":"acme.hello","name":"Hello","version":"1.0.0","permissions":["net","native"]}"#;
        let z = make_zip(&[("manifest.json", m), ("index.js", b"x")]);
        let shown = vec!["net".to_string()];
        let e = install_zip(&z, &sha(&z), "acme.hello", &shown, &dir).unwrap_err();
        assert!(e.contains("native"), "{e}");
        assert!(!dir.join("acme.hello").exists());
        let all = vec!["net".to_string(), "native".to_string(), "secrets".to_string()];
        assert!(install_zip(&z, &sha(&z), "acme.hello", &all, &dir).is_ok()); // a subset of what was shown is fine
    }

    #[test]
    fn the_size_cap_counts_what_is_really_unpacked_across_all_files() {
        let dir = tmp("bomb");
        let half = vec![b'a'; (MAX_UNPACKED as usize) / 2 + 1000];
        let z = make_zip(&[("manifest.json", MANIFEST), ("index.js", &half), ("more.js", &half)]);
        assert!(install_zip(&z, &sha(&z), "acme.hello", &[], &dir).unwrap_err().contains("too large"));
        assert!(!dir.join("acme.hello").exists());
    }

    #[test]
    fn rejects_archives_that_unpack_too_large() {
        let dir = tmp("big");
        let big = vec![b'a'; (MAX_UNPACKED as usize) + 10];
        let z = make_zip(&[("manifest.json", MANIFEST), ("index.js", &big)]);
        assert!(install_zip(&z, &sha(&z), "acme.hello", &[], &dir).unwrap_err().contains("too large"));
    }
}
