//! Secrets (API keys) for plugins. They are never written to the vault, to plugin settings, or to Git.
//!
//! Two places can hold them, and the user chooses in Settings:
//! - a file in the app data folder that only the user account can read (`secrets.json`, mode 600), or
//! - the operating system keychain.
//!
//! The file is the default on macOS. There the keychain lets an app read an item without a password dialog
//! only when the app has the same code signature as the app that saved it. Mindroot is not signed with an
//! Apple certificate, so each update is a different app to the keychain and the dialog comes back.

use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

use tauri::{AppHandle, Runtime};

use crate::storage::{paths, validate_plugin_id, CmdResult};

const SERVICE: &str = "app.mindroot.desktop";
/// The keychain service and the plugin id prefix of the app before it was renamed to Mindroot.
const LEGACY_SERVICE: &str = "app.branchmint.desktop";
const LEGACY_ID_PREFIX: &str = "branchmint.";
const ID_PREFIX: &str = "mindroot.";

/// The account name that the old app used for the same secret.
fn legacy_account(account: &str) -> Option<String> {
    account.strip_prefix(ID_PREFIX).map(|rest| format!("{LEGACY_ID_PREFIX}{rest}"))
}

trait Store: Send + Sync {
    fn get(&self, account: &str) -> CmdResult<Option<String>>;
    fn set(&self, account: &str, value: &str) -> CmdResult<()>;
    fn remove(&self, account: &str) -> CmdResult<()>;
}

struct Keychain;

impl Keychain {
    fn entry(account: &str) -> CmdResult<keyring::Entry> {
        keyring::Entry::new(SERVICE, account).map_err(|e| e.to_string())
    }
}

impl Keychain {
    /// A secret saved by the old app: copy it to the new service, so the next read finds it there.
    /// Any failure counts as "no secret": the user can then type the key again.
    fn adopt_legacy(account: &str) -> Option<String> {
        let old = keyring::Entry::new(LEGACY_SERVICE, &legacy_account(account)?).ok()?;
        let value = old.get_password().ok()?;
        if let Ok(entry) = Self::entry(account) {
            let _ = entry.set_password(&value);
        }
        Some(value)
    }
}

impl Store for Keychain {
    fn get(&self, account: &str) -> CmdResult<Option<String>> {
        match Self::entry(account)?.get_password() {
            Ok(v) => Ok(Some(v)),
            Err(keyring::Error::NoEntry) => Ok(Self::adopt_legacy(account)),
            Err(e) => Err(format!("Keychain: {e}")),
        }
    }
    fn set(&self, account: &str, value: &str) -> CmdResult<()> {
        Self::entry(account)?.set_password(value).map_err(|e| format!("Keychain: {e}"))
    }
    fn remove(&self, account: &str) -> CmdResult<()> {
        match Self::entry(account)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(format!("Keychain: {e}")),
        }
    }
}

/// Used by tests so they do not touch the real keychain.
#[derive(Default)]
struct Memory(Mutex<HashMap<String, String>>);

impl Store for Memory {
    fn get(&self, a: &str) -> CmdResult<Option<String>> {
        Ok(self.0.lock().unwrap().get(a).cloned())
    }
    fn set(&self, a: &str, v: &str) -> CmdResult<()> {
        self.0.lock().unwrap().insert(a.into(), v.into());
        Ok(())
    }
    fn remove(&self, a: &str) -> CmdResult<()> {
        self.0.lock().unwrap().remove(a);
        Ok(())
    }
}

/// Asks the inner store for each secret only once, then answers from memory until the app closes.
/// On macOS each keychain read can show a password dialog, so a read for each AI request is too many.
/// A failed read (the user refused) is not remembered: the next use asks again.
struct Cached {
    inner: Arc<dyn Store>,
    seen: Mutex<HashMap<String, Option<String>>>,
}

impl Cached {
    fn new(inner: Arc<dyn Store>) -> Self {
        Self { inner, seen: Mutex::new(HashMap::new()) }
    }
}

impl Cached {
    /// The secrets read or saved since the app started.
    fn known(&self) -> Vec<(String, String)> {
        self.seen.lock().unwrap().iter().filter_map(|(a, v)| v.clone().map(|v| (a.clone(), v))).collect()
    }
}

impl Store for Cached {
    fn get(&self, account: &str) -> CmdResult<Option<String>> {
        if let Some(v) = self.seen.lock().unwrap().get(account) {
            return Ok(v.clone());
        }
        let v = self.inner.get(account)?;
        self.seen.lock().unwrap().insert(account.into(), v.clone());
        Ok(v)
    }
    fn set(&self, account: &str, value: &str) -> CmdResult<()> {
        self.inner.set(account, value)?;
        self.seen.lock().unwrap().insert(account.into(), Some(value.into()));
        Ok(())
    }
    fn remove(&self, account: &str) -> CmdResult<()> {
        self.inner.remove(account)?;
        self.seen.lock().unwrap().insert(account.into(), None);
        Ok(())
    }
}

/// Secrets in one JSON file that only the user account can read.
struct FileStore {
    path: PathBuf,
    lock: Mutex<()>,
}

impl FileStore {
    fn new(path: PathBuf) -> Self {
        Self { path, lock: Mutex::new(()) }
    }

    fn read(&self) -> CmdResult<BTreeMap<String, String>> {
        match fs::read(&self.path) {
            Ok(bytes) => serde_json::from_slice(&bytes).map_err(|e| format!("The secrets file is damaged ({e}). Save the key again.")),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(BTreeMap::new()),
            Err(e) => Err(format!("Secrets file: {e}")),
        }
    }

    /// Write through a temporary file that is private from the moment it exists, then rename.
    fn write(&self, all: &BTreeMap<String, String>) -> CmdResult<()> {
        if all.is_empty() {
            return match fs::remove_file(&self.path) {
                Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(format!("Secrets file: {e}")),
                _ => Ok(()),
            };
        }
        if let Some(dir) = self.path.parent() {
            fs::create_dir_all(dir).map_err(|e| format!("Secrets file: {e}"))?;
        }
        let tmp = self.path.with_extension("tmp");
        let _ = fs::remove_file(&tmp);
        let mut opts = fs::OpenOptions::new();
        opts.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            opts.mode(0o600);
        }
        let bytes = serde_json::to_vec_pretty(all).map_err(|e| e.to_string())?;
        let mut f = opts.open(&tmp).map_err(|e| format!("Secrets file: {e}"))?;
        f.write_all(&bytes).and_then(|_| f.sync_all()).map_err(|e| format!("Secrets file: {e}"))?;
        drop(f);
        fs::rename(&tmp, &self.path).map_err(|e| format!("Secrets file: {e}"))
    }

    fn all(&self) -> CmdResult<BTreeMap<String, String>> {
        let _g = self.lock.lock().unwrap();
        self.read()
    }

    fn clear(&self) -> CmdResult<()> {
        let _g = self.lock.lock().unwrap();
        self.write(&BTreeMap::new())
    }
}

impl Store for FileStore {
    fn get(&self, a: &str) -> CmdResult<Option<String>> {
        let _g = self.lock.lock().unwrap();
        Ok(self.read()?.get(a).cloned())
    }
    fn set(&self, a: &str, v: &str) -> CmdResult<()> {
        let _g = self.lock.lock().unwrap();
        // a damaged file must not block a new key: start again from an empty file
        let mut all = self.read().unwrap_or_default();
        all.insert(a.into(), v.into());
        self.write(&all)
    }
    fn remove(&self, a: &str) -> CmdResult<()> {
        let _g = self.lock.lock().unwrap();
        let mut all = self.read().unwrap_or_default();
        if all.remove(a).is_some() {
            self.write(&all)?;
        }
        Ok(())
    }
}

/// Where the secrets are kept.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    File,
    Keychain,
}

impl Mode {
    fn default_for_platform() -> Self {
        if cfg!(target_os = "macos") { Mode::File } else { Mode::Keychain }
    }
    fn parse(s: &str) -> Option<Self> {
        match s.trim() {
            "file" => Some(Mode::File),
            "keychain" => Some(Mode::Keychain),
            _ => None,
        }
    }
    fn name(self) -> &'static str {
        match self {
            Mode::File => "file",
            Mode::Keychain => "keychain",
        }
    }
}

/// Sends each call to the file or to the keychain, and moves the secrets when the user changes the place.
struct Switch {
    mode_file: PathBuf,
    file: FileStore,
    keychain: Arc<dyn Store>,
    mode: Mutex<Mode>,
}

impl Switch {
    fn new(root: &Path, keychain: Arc<dyn Store>) -> Self {
        let mode_file = root.join("secret-store");
        let mode = fs::read_to_string(&mode_file).ok().and_then(|s| Mode::parse(&s)).unwrap_or_else(Mode::default_for_platform);
        Self { mode_file, file: FileStore::new(root.join("secrets.json")), keychain, mode: Mutex::new(mode) }
    }

    fn mode(&self) -> Mode {
        *self.mode.lock().unwrap()
    }

    /// `known` holds the secrets that this run of the app has read: they move to the file at once.
    fn set_mode(&self, next: Mode, known: &[(String, String)]) -> CmdResult<()> {
        let mut mode = self.mode.lock().unwrap();
        if next == Mode::Keychain {
            // The file knows its secrets: move them all now, and leave no copy in the file.
            for (a, v) in self.file.all()? {
                self.keychain.set(&a, &v)?;
            }
            self.file.clear()?;
        }
        // To the file: the keychain cannot list its items. The secrets that are known move now,
        // each other secret moves on its first read (see `get`).
        if next == Mode::File {
            for (a, v) in known {
                self.file.set(a, v)?;
                let _ = self.keychain.remove(a);
            }
        }
        if let Some(dir) = self.mode_file.parent() {
            fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        fs::write(&self.mode_file, next.name()).map_err(|e| e.to_string())?;
        *mode = next;
        Ok(())
    }
}

impl Store for Switch {
    fn get(&self, a: &str) -> CmdResult<Option<String>> {
        if self.mode() == Mode::Keychain {
            return self.keychain.get(a);
        }
        if let Some(v) = self.file.get(a)? {
            return Ok(Some(v));
        }
        // A secret from before the file was used: move it. This is the last read from the keychain.
        match self.keychain.get(a)? {
            Some(v) => {
                self.file.set(a, &v)?;
                let _ = self.keychain.remove(a);
                Ok(Some(v))
            }
            None => Ok(None),
        }
    }
    fn set(&self, a: &str, v: &str) -> CmdResult<()> {
        match self.mode() {
            Mode::Keychain => self.keychain.set(a, v),
            Mode::File => self.file.set(a, v),
        }
    }
    fn remove(&self, a: &str) -> CmdResult<()> {
        match self.mode() {
            Mode::Keychain => {
                self.keychain.remove(a)?;
                let _ = self.file.remove(a);
            }
            Mode::File => {
                self.file.remove(a)?;
                let _ = self.keychain.remove(a); // or an old copy there would come back on the next read
            }
        }
        Ok(())
    }
}

/// What stands in for the keychain in tests.
static TEST_KEYCHAIN: OnceLock<Arc<dyn Store>> = OnceLock::new();
static STORE: OnceLock<(Arc<Switch>, Cached)> = OnceLock::new();

fn store<R: Runtime>(app: &AppHandle<R>) -> CmdResult<&'static (Arc<Switch>, Cached)> {
    if let Some(s) = STORE.get() {
        return Ok(s);
    }
    let root = paths(app)?.root;
    Ok(STORE.get_or_init(|| {
        let keychain = TEST_KEYCHAIN.get().cloned().unwrap_or_else(|| Arc::new(Keychain));
        let switch = Arc::new(Switch::new(&root, keychain));
        (switch.clone(), Cached::new(switch))
    }))
}

/// Use memory in place of the real keychain. Call before the first secret command (tests only).
pub fn use_memory_secrets() {
    let _ = TEST_KEYCHAIN.set(Arc::new(Memory::default()));
}

fn account(plugin_id: &str, key: &str) -> CmdResult<String> {
    validate_plugin_id(plugin_id)?;
    if key.is_empty() || key.len() > 128 || key.chars().any(|c| c.is_control()) {
        return Err("invalid secret key".into());
    }
    Ok(format!("{plugin_id}/{key}"))
}

#[tauri::command]
pub fn secret_get<R: Runtime>(app: AppHandle<R>, plugin_id: String, key: String) -> CmdResult<Option<String>> {
    store(&app)?.1.get(&account(&plugin_id, &key)?)
}

#[tauri::command]
pub fn secret_set<R: Runtime>(app: AppHandle<R>, plugin_id: String, key: String, value: String) -> CmdResult<()> {
    store(&app)?.1.set(&account(&plugin_id, &key)?, &value)
}

#[tauri::command]
pub fn secret_remove<R: Runtime>(app: AppHandle<R>, plugin_id: String, key: String) -> CmdResult<()> {
    store(&app)?.1.remove(&account(&plugin_id, &key)?)
}

/// Where the secrets are kept: `file` or `keychain`.
#[tauri::command]
pub fn secret_store_get<R: Runtime>(app: AppHandle<R>) -> CmdResult<String> {
    Ok(store(&app)?.0.mode().name().into())
}

/// Change where the secrets are kept, and move the secrets there.
#[tauri::command]
pub fn secret_store_set<R: Runtime>(app: AppHandle<R>, mode: String) -> CmdResult<()> {
    let next = Mode::parse(&mode).ok_or("unknown place for secrets")?;
    let (switch, cached) = store(&app)?;
    switch.set_mode(next, &cached.known())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

    /// A store that counts its reads and can refuse them, like a keychain dialog.
    #[derive(Default)]
    struct Counting {
        inner: Memory,
        reads: AtomicUsize,
        refuse: AtomicBool,
    }

    impl Store for Counting {
        fn get(&self, a: &str) -> CmdResult<Option<String>> {
            self.reads.fetch_add(1, Ordering::SeqCst);
            if self.refuse.load(Ordering::SeqCst) {
                return Err("Keychain: refused".into());
            }
            self.inner.get(a)
        }
        fn set(&self, a: &str, v: &str) -> CmdResult<()> {
            self.inner.set(a, v)
        }
        fn remove(&self, a: &str) -> CmdResult<()> {
            self.inner.remove(a)
        }
    }

    fn temp_root(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("mindroot-secrets-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn switch(root: &Path, mode: Mode) -> (Switch, Arc<Counting>) {
        fs::write(root.join("secret-store"), mode.name()).unwrap();
        let keychain = Arc::new(Counting::default());
        (Switch::new(root, keychain.clone()), keychain)
    }

    #[test]
    fn the_file_keeps_secrets_private_and_out_of_the_vault() {
        let root = temp_root("file");
        let (s, keychain) = switch(&root, Mode::File);
        s.set("mindroot.ai/apikey", "sk-1").unwrap();
        s.set("mindroot.collab/secret", "r-1").unwrap();
        assert_eq!(s.get("mindroot.ai/apikey").unwrap().as_deref(), Some("sk-1"));
        assert_eq!(keychain.reads.load(Ordering::SeqCst), 0, "a secret in the file needs no keychain read");
        let path = root.join("secrets.json");
        assert!(path.exists() && !root.join("vault").join("secrets.json").exists());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
        }
        // a second start reads the same file
        let again = Switch::new(&root, Arc::new(Memory::default()));
        assert_eq!(again.mode(), Mode::File);
        assert_eq!(again.get("mindroot.collab/secret").unwrap().as_deref(), Some("r-1"));
        // the last secret removed: no empty file stays
        s.remove("mindroot.ai/apikey").unwrap();
        s.remove("mindroot.collab/secret").unwrap();
        assert!(!path.exists());
        assert_eq!(s.get("mindroot.ai/apikey").unwrap(), None);
    }

    #[test]
    fn a_secret_from_the_keychain_moves_to_the_file_on_its_first_read() {
        let root = temp_root("move");
        let (s, keychain) = switch(&root, Mode::File);
        keychain.set("mindroot.ai/apikey", "old").unwrap();
        assert_eq!(s.get("mindroot.ai/apikey").unwrap().as_deref(), Some("old"));
        assert_eq!(keychain.inner.get("mindroot.ai/apikey").unwrap(), None, "no copy stays in the keychain");
        assert_eq!(s.get("mindroot.ai/apikey").unwrap().as_deref(), Some("old"));
        assert_eq!(keychain.reads.load(Ordering::SeqCst), 1, "the keychain is asked only for the move");
    }

    #[test]
    fn a_refused_keychain_read_is_an_error_and_a_new_key_ends_the_question() {
        let root = temp_root("refuse");
        let (s, keychain) = switch(&root, Mode::File);
        keychain.set("a/k", "old").unwrap();
        keychain.refuse.store(true, Ordering::SeqCst);
        assert!(s.get("a/k").is_err());
        s.set("a/k", "new").unwrap();
        assert_eq!(s.get("a/k").unwrap().as_deref(), Some("new"));
        assert_eq!(keychain.reads.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn a_removed_secret_does_not_come_back_from_the_keychain() {
        let root = temp_root("remove");
        let (s, keychain) = switch(&root, Mode::File);
        keychain.set("a/k", "old").unwrap();
        s.set("a/k", "new").unwrap();
        s.remove("a/k").unwrap();
        assert_eq!(s.get("a/k").unwrap(), None);
    }

    #[test]
    fn a_change_of_place_moves_the_secrets_both_ways() {
        let root = temp_root("switch");
        let (s, keychain) = switch(&root, Mode::File);
        s.set("a/k", "v").unwrap();
        s.set("b/k", "w").unwrap();
        s.set_mode(Mode::Keychain, &[]).unwrap();
        assert_eq!(keychain.inner.get("a/k").unwrap().as_deref(), Some("v"));
        assert_eq!(keychain.inner.get("b/k").unwrap().as_deref(), Some("w"));
        assert!(!root.join("secrets.json").exists(), "no copy stays in the file");
        assert_eq!(s.get("a/k").unwrap().as_deref(), Some("v"));
        assert_eq!(Switch::new(&root, keychain.clone()).mode(), Mode::Keychain, "the choice is remembered");
        // back to the file: a secret that the app has read moves at once, the other on its first read
        s.set_mode(Mode::File, &[("a/k".into(), "v".into())]).unwrap();
        assert_eq!(keychain.inner.get("a/k").unwrap(), None);
        assert_eq!(keychain.inner.get("b/k").unwrap().as_deref(), Some("w"));
        let reads = keychain.reads.load(Ordering::SeqCst);
        assert_eq!(s.get("a/k").unwrap().as_deref(), Some("v"));
        assert_eq!(keychain.reads.load(Ordering::SeqCst), reads, "the moved secret needs no keychain read");
        assert_eq!(s.get("b/k").unwrap().as_deref(), Some("w"));
        assert_eq!(keychain.inner.get("b/k").unwrap(), None);
    }

    #[test]
    fn a_damaged_file_gives_a_clear_error_and_a_new_key_repairs_it() {
        let root = temp_root("damaged");
        let (s, _) = switch(&root, Mode::File);
        fs::write(root.join("secrets.json"), b"{not json").unwrap();
        assert!(s.get("a/k").unwrap_err().contains("damaged"));
        s.set("a/k", "v").unwrap();
        assert_eq!(s.get("a/k").unwrap().as_deref(), Some("v"));
    }

    #[test]
    fn the_default_place_is_the_file_on_macos_only() {
        let root = temp_root("default");
        let s = Switch::new(&root, Arc::new(Memory::default()));
        assert_eq!(s.mode(), if cfg!(target_os = "macos") { Mode::File } else { Mode::Keychain });
        fs::write(root.join("secret-store"), "nonsense").unwrap();
        assert_eq!(Switch::new(&root, Arc::new(Memory::default())).mode(), Mode::default_for_platform());
    }

    #[test]
    fn a_secret_is_read_from_the_keychain_only_once() {
        let raw = Arc::new(Counting::default());
        raw.set("mindroot.ai/apikey", "k1").unwrap();
        let store = Cached::new(raw.clone());
        for _ in 0..5 {
            assert_eq!(store.get("mindroot.ai/apikey").unwrap().as_deref(), Some("k1"));
        }
        assert_eq!(raw.reads.load(Ordering::SeqCst), 1);
        // a missing secret is also asked for only once
        for _ in 0..3 {
            assert_eq!(store.get("mindroot.ai/other").unwrap(), None);
        }
        assert_eq!(raw.reads.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn a_change_is_seen_at_once_and_needs_no_new_read() {
        let raw = Arc::new(Counting::default());
        let store = Cached::new(raw.clone());
        assert_eq!(store.get("a/k").unwrap(), None);
        store.set("a/k", "v1").unwrap();
        assert_eq!(store.get("a/k").unwrap().as_deref(), Some("v1"));
        store.set("a/k", "v2").unwrap();
        assert_eq!(store.get("a/k").unwrap().as_deref(), Some("v2"));
        assert_eq!(raw.inner.get("a/k").unwrap().as_deref(), Some("v2"));
        store.remove("a/k").unwrap();
        assert_eq!(store.get("a/k").unwrap(), None);
        assert_eq!(raw.inner.get("a/k").unwrap(), None);
        assert_eq!(raw.reads.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn a_refused_read_is_not_remembered() {
        let raw = Arc::new(Counting::default());
        raw.set("a/k", "v").unwrap();
        raw.refuse.store(true, Ordering::SeqCst);
        let store = Cached::new(raw.clone());
        assert!(store.get("a/k").is_err());
        raw.refuse.store(false, Ordering::SeqCst);
        assert_eq!(store.get("a/k").unwrap().as_deref(), Some("v"));
        assert_eq!(raw.reads.load(Ordering::SeqCst), 2);
    }
}
