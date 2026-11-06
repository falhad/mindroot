//! Branchmint backend: file storage for maps, the Git runner used by sync, and plugin files.

mod git;
mod plugins;
mod storage;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
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
            plugins::plugins_list,
            plugins::plugin_read,
            plugins::plugins_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Branchmint");
}
