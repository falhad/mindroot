//! `net_request` and the secrets commands, called through Tauri's real IPC layer.

use std::io::{Read, Write};
use std::net::TcpListener;

use serde_json::{json, Value};
use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::{ipc::{CallbackFn, InvokeBody}, WebviewWindowBuilder};

type W = tauri::WebviewWindow<tauri::test::MockRuntime>;

fn call(w: &W, cmd: &str, args: Value) -> Result<Value, Value> {
    get_ipc_response(
        w,
        InvokeRequest {
            cmd: cmd.into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: "tauri://localhost".parse().unwrap(),
            body: InvokeBody::Json(args),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.to_string(),
        },
    )
    .map(|r| r.deserialize().unwrap())
}

/// One-shot HTTP server: replies to the first request with `status` and `body`, and returns the raw request text.
fn serve(status: &str, body: Vec<u8>) -> (u16, std::thread::JoinHandle<String>) {
    let l = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = l.local_addr().unwrap().port();
    let status = status.to_string();
    let h = std::thread::spawn(move || {
        let (mut s, _) = l.accept().unwrap();
        let mut buf = vec![0u8; 8192];
        let n = s.read(&mut buf).unwrap();
        let req = String::from_utf8_lossy(&buf[..n]).to_string();
        let head = format!("HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len());
        let _ = s.write_all(head.as_bytes());
        let _ = s.write_all(&body);
        req
    });
    (port, h)
}

fn zip_bytes() -> Vec<u8> {
    use zip::write::SimpleFileOptions;
    let mut w = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    w.start_file("manifest.json", SimpleFileOptions::default()).unwrap();
    w.write_all(br#"{"id":"acme.gallery-test","name":"Gallery test","version":"1.0.0"}"#).unwrap();
    w.start_file("index.js", SimpleFileOptions::default()).unwrap();
    w.write_all(b"export default { activate() {} }").unwrap();
    w.finish().unwrap().into_inner()
}

fn sha_hex(b: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    Sha256::digest(b).iter().map(|x| format!("{x:02x}")).collect()
}

#[test]
fn net_and_secrets_work_the_way_the_frontend_calls_them() {
    mindroot_lib::use_memory_secrets();
    let home = std::env::temp_dir().join(format!("mindroot-net-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&home);
    std::fs::create_dir_all(&home).unwrap();
    std::env::set_var("HOME", &home);
    std::env::set_var("XDG_DATA_HOME", home.join("data"));
    std::env::set_var("APPDATA", &home);
    let app = mindroot_lib::configure(mock_builder()).build(mock_context(noop_assets())).unwrap();
    let w = WebviewWindowBuilder::new(&app, "main", Default::default()).build().unwrap();

    // a normal request: method, headers and body reach the server; status and body come back
    let (port, h) = serve("201 Created", br#"{"ok":true}"#.to_vec());
    let res = call(&w, "net_request", json!({ "req": {
        "url": format!("http://127.0.0.1:{port}/v1/x"), "method": "POST",
        "headers": { "x-test": "yes" }, "body": "{\"a\":1}"
    }})).unwrap();
    assert_eq!(res["status"], 201);
    assert_eq!(res["body"], r#"{"ok":true}"#);
    let raw = h.join().unwrap().to_lowercase();
    assert!(raw.starts_with("post /v1/x"), "{raw}");
    assert!(raw.contains("x-test: yes"), "{raw}");
    assert!(raw.contains("{\"a\":1}"), "{raw}");

    // an error status is data, not an error
    let (port, h) = serve("429 Too Many Requests", b"slow down".to_vec());
    let res = call(&w, "net_request", json!({ "req": { "url": format!("http://127.0.0.1:{port}/") } })).unwrap();
    assert_eq!(res["status"], 429);
    h.join().unwrap();

    // plain http to a non-local host is refused before any connection
    let e = call(&w, "net_request", json!({ "req": { "url": "http://example.com/" } })).unwrap_err();
    assert!(e.as_str().unwrap().contains("https"), "{e}");
    // other schemes, bad methods, bad header names
    assert!(call(&w, "net_request", json!({ "req": { "url": "file:///etc/passwd" } })).is_err());
    assert!(call(&w, "net_request", json!({ "req": { "url": "https://example.com/", "method": "TRACE" } })).is_err());
    assert!(call(&w, "net_request", json!({ "req": { "url": "https://example.com/", "headers": { "bad header": "x" } } })).is_err());

    // the response size is capped at 2 MB
    let (port, h) = serve("200 OK", vec![b'x'; 3 * 1024 * 1024]);
    let e = call(&w, "net_request", json!({ "req": { "url": format!("http://127.0.0.1:{port}/") } })).unwrap_err();
    assert!(e.as_str().unwrap().contains("too large"), "{e}");
    let _ = h.join();

    // a slow server hits the timeout
    let l = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = l.local_addr().unwrap().port();
    let hold = std::thread::spawn(move || {
        let (_s, _) = l.accept().unwrap();
        std::thread::sleep(std::time::Duration::from_millis(1500));
    });
    let e = call(&w, "net_request", json!({ "req": { "url": format!("http://127.0.0.1:{port}/"), "timeoutMs": 300 } })).unwrap_err();
    assert!(e.as_str().unwrap().to_lowercase().contains("time"), "{e}");
    let _ = hold.join();

    // gallery: download, check the hash, install; refuse everything else
    let z = zip_bytes();
    let (port, h) = serve("200 OK", z.clone());
    let id = call(&w, "plugin_install", json!({ "url": format!("http://127.0.0.1:{port}/p.zip"), "sha256": sha_hex(&z), "id": "acme.gallery-test", "permissions": [] })).unwrap();
    assert_eq!(id, "acme.gallery-test");
    h.join().unwrap();
    let listed = call(&w, "plugins_list", json!({})).unwrap();
    assert!(listed.as_array().unwrap().iter().any(|p| p["manifest"]["id"] == "acme.gallery-test"), "{listed}");
    // wrong hash: nothing changes, and the message says why
    let (port, h) = serve("200 OK", z.clone());
    let e = call(&w, "plugin_install", json!({ "url": format!("http://127.0.0.1:{port}/p.zip"), "sha256": "0".repeat(64), "id": "acme.gallery-test", "permissions": [] })).unwrap_err();
    assert!(e.as_str().unwrap().contains("SHA-256"), "{e}");
    h.join().unwrap();
    // not found, and plain http to another host
    let (port, h) = serve("404 Not Found", b"nope".to_vec());
    assert!(call(&w, "plugin_install", json!({ "url": format!("http://127.0.0.1:{port}/p.zip"), "sha256": sha_hex(&z), "id": "acme.gallery-test", "permissions": [] })).is_err());
    h.join().unwrap();
    assert!(call(&w, "plugin_install", json!({ "url": "http://example.com/p.zip", "sha256": sha_hex(&z), "id": "acme.gallery-test", "permissions": [] })).is_err());
    // the entry names a different plugin than the zip contains
    let (port, h) = serve("200 OK", z.clone());
    let e = call(&w, "plugin_install", json!({ "url": format!("http://127.0.0.1:{port}/p.zip"), "sha256": sha_hex(&z), "id": "acme.someone-else", "permissions": [] })).unwrap_err();
    assert!(e.as_str().unwrap().contains("gallery entry"), "{e}");
    h.join().unwrap();
    // uninstall
    call(&w, "plugin_uninstall", json!({ "id": "acme.gallery-test" })).unwrap();
    assert!(!call(&w, "plugins_list", json!({})).unwrap().as_array().unwrap().iter().any(|p| p["manifest"]["id"] == "acme.gallery-test"));
    assert!(call(&w, "plugin_uninstall", json!({ "id": "../x" })).is_err());

    // secrets: per plugin, set / get / remove
    assert!(call(&w, "secret_get", json!({ "pluginId": "mindroot.ai", "key": "k" })).unwrap().is_null());
    call(&w, "secret_set", json!({ "pluginId": "mindroot.ai", "key": "k", "value": "S3CRET" })).unwrap();
    assert_eq!(call(&w, "secret_get", json!({ "pluginId": "mindroot.ai", "key": "k" })).unwrap(), "S3CRET");
    assert!(call(&w, "secret_get", json!({ "pluginId": "other.plugin", "key": "k" })).unwrap().is_null());
    call(&w, "secret_remove", json!({ "pluginId": "mindroot.ai", "key": "k" })).unwrap();
    assert!(call(&w, "secret_get", json!({ "pluginId": "mindroot.ai", "key": "k" })).unwrap().is_null());
    // bad plugin ids and empty keys are refused
    assert!(call(&w, "secret_set", json!({ "pluginId": "", "key": "k", "value": "v" })).is_err());
    assert!(call(&w, "secret_set", json!({ "pluginId": "../x", "key": "k", "value": "v" })).is_err());
    assert!(call(&w, "secret_set", json!({ "pluginId": "a.b", "key": "", "value": "v" })).is_err());

    // secrets never touch the vault or the plugin settings folder
    let leaked = std::process::Command::new("grep").args(["-rl", "S3CRET"]).arg(&home).output().unwrap();
    assert!(leaked.stdout.is_empty(), "secret leaked to disk: {}", String::from_utf8_lossy(&leaked.stdout));
    let _ = std::fs::remove_dir_all(&home);
}
