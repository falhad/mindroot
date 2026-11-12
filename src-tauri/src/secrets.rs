//! Secrets (API keys) for plugins, kept in the operating system keychain.
//! They are never written to the vault, to plugin settings, or to Git.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};

use crate::storage::{validate_plugin_id, CmdResult};

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

static STORE: OnceLock<Arc<dyn Store>> = OnceLock::new();

fn store() -> &'static Arc<dyn Store> {
    STORE.get_or_init(|| Arc::new(Keychain))
}

/// Keep secrets in memory instead of the keychain. Call before the first secret command (tests only).
pub fn use_memory_secrets() {
    let _ = STORE.set(Arc::new(Memory::default()));
}

fn account(plugin_id: &str, key: &str) -> CmdResult<String> {
    validate_plugin_id(plugin_id)?;
    if key.is_empty() || key.len() > 128 || key.chars().any(|c| c.is_control()) {
        return Err("invalid secret key".into());
    }
    Ok(format!("{plugin_id}/{key}"))
}

#[tauri::command]
pub fn secret_get(plugin_id: String, key: String) -> CmdResult<Option<String>> {
    store().get(&account(&plugin_id, &key)?)
}

#[tauri::command]
pub fn secret_set(plugin_id: String, key: String, value: String) -> CmdResult<()> {
    store().set(&account(&plugin_id, &key)?, &value)
}

#[tauri::command]
pub fn secret_remove(plugin_id: String, key: String) -> CmdResult<()> {
    store().remove(&account(&plugin_id, &key)?)
}
