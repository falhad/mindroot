//! HTTP requests for plugins. The webview never talks to the network itself (the CSP blocks it),
//! so keys and request bodies stay in Rust and the allowed address forms are checked in one place.

use std::time::Duration;

use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use reqwest::{redirect::Policy, Method};
use serde::{Deserialize, Serialize};

use crate::storage::CmdResult;

const MAX_BODY: usize = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS: u64 = 60_000;
const MAX_TIMEOUT_MS: u64 = 300_000;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetRequest {
    pub url: String,
    #[serde(default)]
    pub method: Option<String>,
    #[serde(default)]
    pub headers: std::collections::HashMap<String, String>,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
}

#[derive(Serialize)]
pub struct NetResponse {
    pub status: u16,
    pub body: String,
}

/// https is always allowed; plain http only to this computer (development and tests).
pub fn check_url(raw: &str) -> CmdResult<reqwest::Url> {
    let url = reqwest::Url::parse(raw).map_err(|_| "Invalid URL".to_string())?;
    let local = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    match url.scheme() {
        "https" => Ok(url),
        "http" if local => Ok(url),
        _ => Err("Only https:// addresses are allowed (http only for localhost)".into()),
    }
}

fn method_of(m: Option<&str>) -> CmdResult<Method> {
    match m.unwrap_or("GET").to_ascii_uppercase().as_str() {
        "GET" => Ok(Method::GET),
        "POST" => Ok(Method::POST),
        "PUT" => Ok(Method::PUT),
        "DELETE" => Ok(Method::DELETE),
        other => Err(format!("Method not allowed: {other}")),
    }
}

#[tauri::command]
pub async fn net_request(req: NetRequest) -> CmdResult<NetResponse> {
    let url = check_url(&req.url)?;
    let method = method_of(req.method.as_deref())?;
    let mut headers = HeaderMap::new();
    for (k, v) in &req.headers {
        let name = HeaderName::from_bytes(k.as_bytes()).map_err(|_| format!("Bad header name: {k:?}"))?;
        let value = HeaderValue::from_str(v).map_err(|_| format!("Bad header value for {k:?}"))?;
        headers.insert(name, value);
    }
    let timeout = Duration::from_millis(req.timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS).clamp(100, MAX_TIMEOUT_MS));
    // No redirects: a redirect could send the request (and its key) to a host the checks never saw.
    let client = reqwest::Client::builder()
        .redirect(Policy::none())
        .timeout(timeout)
        .user_agent("Branchmint")
        .build()
        .map_err(|e| e.to_string())?;
    let mut builder = client.request(method, url).headers(headers);
    if let Some(body) = req.body {
        builder = builder.body(body);
    }
    let mut res = builder.send().await.map_err(describe)?;
    let status = res.status().as_u16();
    let mut buf: Vec<u8> = Vec::new();
    while let Some(chunk) = res.chunk().await.map_err(describe)? {
        if buf.len() + chunk.len() > MAX_BODY {
            return Err("The response is too large (limit 2 MB)".into());
        }
        buf.extend_from_slice(&chunk);
    }
    Ok(NetResponse { status, body: String::from_utf8_lossy(&buf).into_owned() })
}

fn describe(e: reqwest::Error) -> String {
    if e.is_timeout() {
        "The request timed out".into()
    } else if e.is_connect() {
        "Could not connect to the server".into()
    } else {
        // reqwest errors can contain the URL; strip it so a key in a query string is never shown
        e.without_url().to_string()
    }
}
