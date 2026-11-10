//! Calls every backend command through Tauri's real IPC layer (mock window), using the same
//! command names, argument names and raw-body headers as the TypeScript code in `src/`.
//! If a name or argument shape drifts between Rust and TypeScript, this test fails.

use serde_json::{json, Value};
use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::{ipc::{CallbackFn, InvokeBody, InvokeResponseBody}, WebviewWindowBuilder};

type App = tauri::App<tauri::test::MockRuntime>;

fn call(w: &tauri::WebviewWindow<tauri::test::MockRuntime>, cmd: &str, body: InvokeBody, headers: &[(&str, &str)]) -> Result<InvokeResponseBody, Value> {
    let mut h = tauri::http::HeaderMap::new();
    for (k, v) in headers {
        h.insert(tauri::http::header::HeaderName::from_bytes(k.as_bytes()).unwrap(), v.parse().unwrap());
    }
    get_ipc_response(
        w,
        InvokeRequest {
            cmd: cmd.into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: "tauri://localhost".parse().unwrap(),
            body,
            headers: h,
            invoke_key: INVOKE_KEY.to_string(),
        },
    )
}

fn json_call(w: &tauri::WebviewWindow<tauri::test::MockRuntime>, cmd: &str, args: Value) -> Value {
    match call(w, cmd, InvokeBody::Json(args), &[]) {
        Ok(r) => r.deserialize().unwrap_or_else(|e| panic!("{cmd}: bad response: {e}")),
        Err(e) => panic!("{cmd} failed: {e}"),
    }
}

fn app() -> (App, std::path::PathBuf) {
    let home = std::env::temp_dir().join(format!("branchmint-ipc-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&home);
    std::fs::create_dir_all(&home).unwrap();
    // app_data_dir() derives from these; keep the test out of the real user data folder
    std::env::set_var("HOME", &home);
    std::env::set_var("XDG_DATA_HOME", home.join("data"));
    std::env::set_var("APPDATA", &home);
    let app = branchmint_lib::configure(mock_builder()).build(mock_context(noop_assets())).expect("app");
    (app, home)
}

const MAP: &str = "{\"t\":\"map\",\"v\":2,\"meta\":{\"id\":\"m1\",\"title\":\"Hello\",\"updatedAt\":7},\"root\":\"r\"}\n{\"t\":\"node\",\"id\":\"r\",\"parentId\":null,\"children\":[],\"text\":\"Hello\"}\n";

#[test]
fn every_command_works_the_way_the_frontend_calls_it() {
    let (app, home) = app();
    let w = WebviewWindowBuilder::new(&app, "main", Default::default()).build().unwrap();

    // maps: save / list / cache / load / delete   (src/io/storage.ts)
    assert_eq!(json_call(&w, "list_maps", json!({})), json!([]));
    json_call(&w, "save_map", json!({ "id": "m1", "text": MAP }));
    let list = json_call(&w, "list_maps", json!({}));
    assert_eq!(list[0]["title"], "Hello");
    assert!(list[0].get("thumb").is_none());
    json_call(&w, "save_cache", json!({ "id": "m1", "json": r#"{"updatedAt":7,"thumb":"<svg/>","search":"hello"}"# }));
    assert_eq!(json_call(&w, "list_maps", json!({}))[0]["thumb"], "<svg/>");
    assert!(json_call(&w, "load_map", json!({ "id": "m1" })).as_str().unwrap().contains("\"t\":\"node\""));
    assert!(json_call(&w, "load_map", json!({ "id": "nope" })).is_null());

    // the old frontend name for the argument must not be accepted any more
    assert!(call(&w, "save_map", InvokeBody::Json(json!({ "id": "m1", "json": MAP })), &[]).is_err());
    // path tricks are refused
    assert!(call(&w, "load_map", InvokeBody::Json(json!({ "id": "../x" })), &[]).is_err());

    // assets: raw bytes with a `name` header, read back as raw bytes
    let name = format!("{}.png", "ab".repeat(32));
    assert_eq!(json_call(&w, "asset_exists", json!({ "name": name })), json!(false));
    call(&w, "save_asset", InvokeBody::Raw(vec![1, 2, 3, 4]), &[("name", &name)]).unwrap();
    assert_eq!(json_call(&w, "asset_exists", json!({ "name": name })), json!(true));
    match call(&w, "load_asset", InvokeBody::Json(json!({ "name": name })), &[]).unwrap() {
        InvokeResponseBody::Raw(bytes) => assert_eq!(bytes, vec![1, 2, 3, 4]),
        other => panic!("expected raw bytes, got {other:?}"),
    }
    assert!(call(&w, "save_asset", InvokeBody::Raw(vec![9]), &[("name", "../evil.png")]).is_err());

    // export helper: raw body + URI-encoded `path` header
    let out = home.join("export me.bin");
    call(&w, "save_bytes", InvokeBody::Raw(vec![7, 7]), &[("path", &out.to_string_lossy().replace(' ', "%20"))]).unwrap();
    assert_eq!(std::fs::read(&out).unwrap(), vec![7, 7]);

    // user templates   (src/io/storage.ts)
    assert_eq!(json_call(&w, "template_list", json!({})), json!([]));
    json_call(&w, "template_save", json!({ "id": "t1", "text": MAP }));
    let tl = json_call(&w, "template_list", json!({}));
    assert_eq!(tl[0]["id"], "t1");
    assert!(tl[0]["text"].as_str().unwrap().contains("Hello"));
    assert!(call(&w, "template_save", InvokeBody::Json(json!({ "id": "../x", "text": MAP })), &[]).is_err());
    assert!(call(&w, "template_save", InvokeBody::Json(json!({ "id": "t2", "text": "not a map" })), &[]).is_err());
    let vault = json_call(&w, "vault_path", json!({})).as_str().unwrap().to_string();
    std::fs::write(format!("{vault}/templates/broken.jsonl"), "garbage").unwrap();
    assert_eq!(json_call(&w, "template_list", json!({})).as_array().unwrap().len(), 1); // a damaged file is skipped
    json_call(&w, "template_delete", json!({ "id": "t1" }));
    assert_eq!(json_call(&w, "template_list", json!({})), json!([]));

    // plugin settings   (src/plugins/host.ts)
    assert!(json_call(&w, "plugin_settings_get", json!({ "id": "branchmint.sync" })).is_null());
    json_call(&w, "plugin_settings_set", json!({ "id": "branchmint.sync", "json": r#"{"enabled":true}"# }));
    assert_eq!(json_call(&w, "plugin_settings_get", json!({ "id": "branchmint.sync" })).as_str().unwrap(), r#"{"enabled":true}"#);
    assert!(call(&w, "plugin_settings_get", InvokeBody::Json(json!({ "id": "../x" })), &[]).is_err());

    // installed plugins
    let plugin_dir = json_call(&w, "plugins_path", json!({})).as_str().unwrap().to_string();
    std::fs::create_dir_all(format!("{plugin_dir}/demo")).unwrap();
    std::fs::write(format!("{plugin_dir}/demo/manifest.json"), r#"{"id":"acme.demo","name":"Demo","version":"1.0.0"}"#).unwrap();
    std::fs::write(format!("{plugin_dir}/demo/index.js"), "export default { activate() {} }").unwrap();
    let plugins = json_call(&w, "plugins_list", json!({}));
    assert_eq!(plugins[0]["dir"], "demo");
    assert_eq!(plugins[0]["manifest"]["id"], "acme.demo");
    assert!(json_call(&w, "plugin_read", json!({ "dir": "demo", "file": "index.js" })).as_str().unwrap().contains("activate"));
    assert!(call(&w, "plugin_read", InvokeBody::Json(json!({ "dir": "..", "file": "x" })), &[]).is_err());

    // git   (src/plugins/builtin/sync/controller.ts)
    assert_eq!(json_call(&w, "git_available", json!({})), json!(true));
    assert!(json_call(&w, "vault_path", json!({})).as_str().unwrap().ends_with("vault"));
    assert!(!json_call(&w, "device_name", json!({})).as_str().unwrap().is_empty());
    json_call(&w, "git_ensure_repo", json!({ "branch": "main" }));
    let st = json_call(&w, "git_run", json!({ "args": ["status", "--porcelain"] }));
    assert_eq!(st["code"], 0);
    assert!(st["stdout"].as_str().unwrap().contains("maps/"), "the saved map is untracked in the vault: {st}");
    let add = json_call(&w, "git_run", json!({ "args": ["add", "-A"] }));
    assert_eq!(add["code"], 0);
    let commit = json_call(&w, "git_run", json!({ "args": ["commit", "-m", "test"] }));
    assert_eq!(commit["code"], 0, "commit needs an identity, which git_ensure_repo must provide: {commit}");
    assert!(call(&w, "git_run", InvokeBody::Json(json!({ "args": ["config", "core.sshCommand", "x"] })), &[]).is_err());
    assert!(call(&w, "git_ensure_repo", InvokeBody::Json(json!({ "branch": "--evil" })), &[]).is_err());

    // delete removes the map and its cache
    json_call(&w, "delete_map", json!({ "id": "m1" }));
    assert_eq!(json_call(&w, "list_maps", json!({})), json!([]));

    let _ = std::fs::remove_dir_all(&home);
}
