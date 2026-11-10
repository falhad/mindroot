//! Branchmint backend: file storage for maps, the Git runner used by sync, and plugin files.

mod attachments;
mod git;
mod net;
mod plugins;
mod secrets;
mod storage;
mod templates;

/// Exposed for the contract test in `tests/git_contract.rs`.
pub use git::check_args as check_git_args;
/// Tests keep secrets in memory instead of the OS keychain.
pub use secrets::use_memory_secrets;

/// Adds the plugins and every command the frontend can call. Shared by the app and the tests.
pub fn configure<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            storage::list_maps,
            storage::load_map,
            storage::save_map,
            storage::delete_map,
            storage::save_cache,
            storage::asset_exists,
            storage::save_asset,
            storage::load_asset,
            storage::save_bytes,
            storage::plugin_settings_get,
            storage::plugin_settings_set,
            storage::vault_path,
            storage::device_name,
            git::git_run,
            git::git_available,
            git::git_ensure_repo,
            attachments::open_attachment,
            net::net_request,
            secrets::secret_get,
            secrets::secret_set,
            secrets::secret_remove,
            templates::template_list,
            templates::template_save,
            templates::template_delete,
            plugins::plugins_list,
            plugins::plugin_read,
            plugins::plugins_path,
        ])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    configure(tauri::Builder::default())
        .run(tauri::generate_context!())
        .expect("error while running Branchmint");
}
