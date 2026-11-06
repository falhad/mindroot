//! Runs the system `git` inside the vault folder. Only an allow-list of sub-commands is
//! accepted, and the process can never wait for a password: if Git needs one, it fails fast
//! and the frontend shows the error. Authentication is whatever the user already has set up
//! (SSH agent, `gh auth setup-git`, the OS keychain).

use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Runtime};

use crate::storage::{paths, CmdResult};

const ALLOWED: &[&str] = &[
    "init", "add", "commit", "fetch", "merge", "push", "status", "rev-parse", "show", "diff", "checkout", "remote",
    "branch", "log", "rev-list", "ls-files", "ls-remote", "symbolic-ref", "reset", "rm", "merge-base",
];
const TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Serialize, Debug)]
pub struct GitOut {
    pub code: i32,
    pub stdout: String,
    pub stderr: String,
}

/// Rejects anything that could make Git run a program chosen by the caller.
pub fn check_args(args: &[String]) -> CmdResult<()> {
    let Some(sub) = args.first() else { return Err("no git sub-command".into()) };
    if !ALLOWED.contains(&sub.as_str()) {
        return Err(format!("git {sub} is not allowed"));
    }
    for a in args {
        let l = a.to_ascii_lowercase();
        if a.contains('\0')
            || l.starts_with("--upload-pack")
            || l.starts_with("--receive-pack")
            || l.starts_with("--exec")
            || l.starts_with("ext::")
            || l.starts_with("fd::")
            || l == "-c"
            || l.starts_with("--config")
        {
            return Err(format!("git argument not allowed: {a}"));
        }
    }
    Ok(())
}

pub fn run_git(cwd: &Path, args: &[String]) -> CmdResult<GitOut> {
    check_args(args)?;
    let mut cmd = Command::new("git");
    cmd.args(args)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GCM_INTERACTIVE", "never")
        .env("LC_ALL", "C");
    if std::env::var_os("GIT_SSH_COMMAND").is_none() {
        cmd.env("GIT_SSH_COMMAND", "ssh -o BatchMode=yes -o ConnectTimeout=20 -o StrictHostKeyChecking=accept-new");
    }
    // Apps started from the Dock get a short PATH; add the usual Git locations.
    let path = std::env::var("PATH").unwrap_or_default();
    cmd.env("PATH", format!("/opt/homebrew/bin:/usr/local/bin:/usr/bin:{path}"));

    let mut child = cmd.spawn().map_err(|e| format!("could not start git: {e}"))?;
    let mut out = child.stdout.take().unwrap();
    let mut err = child.stderr.take().unwrap();
    let t_out = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = out.read_to_string(&mut s);
        s
    });
    let t_err = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = err.read_to_string(&mut s);
        s
    });
    let start = Instant::now();
    let code = loop {
        match child.try_wait().map_err(|e| e.to_string())? {
            Some(status) => break status.code().unwrap_or(-1),
            None if start.elapsed() > TIMEOUT => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("git {} timed out after {}s", args[0], TIMEOUT.as_secs()));
            }
            None => std::thread::sleep(Duration::from_millis(25)),
        }
    };
    Ok(GitOut { code, stdout: t_out.join().unwrap_or_default(), stderr: t_err.join().unwrap_or_default() })
}

#[tauri::command]
pub async fn git_run<R: Runtime>(app: AppHandle<R>, args: Vec<String>) -> CmdResult<GitOut> {
    let vault = paths(&app)?.vault();
    tauri::async_runtime::spawn_blocking(move || run_git(&vault, &args)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_available() -> bool {
    tauri::async_runtime::spawn_blocking(|| Command::new("git").arg("--version").output().is_ok_and(|o| o.status.success()))
        .await
        .unwrap_or(false)
}

/// `git config` is not on the allow-list, so identity is set here with a fixed, safe command.
fn ensure_identity(vault: &Path) {
    let get = |key: &str| {
        Command::new("git").args(["config", "--get", key]).current_dir(vault).output().ok().filter(|o| o.status.success()).map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string()).filter(|s| !s.is_empty())
    };
    for (key, fallback) in [("user.name", "Branchmint"), ("user.email", "branchmint@localhost")] {
        if get(key).is_none() {
            let _ = Command::new("git").args(["config", key, fallback]).current_dir(vault).output();
        }
    }
}

/// Make the vault a Git repository on `branch`, ignore temp files, and make sure commits have an author.
pub fn ensure_repo(vault: &Path, branch: &str) -> CmdResult<()> {
    let g = |a: &[&str]| run_git(vault, &a.iter().map(|s| s.to_string()).collect::<Vec<_>>());
    if !vault.join(".git").exists() {
        let r = g(&["init", "-b", branch])?;
        if r.code != 0 {
            return Err(r.stderr);
        }
    }
    let ignore = vault.join(".gitignore");
    if !ignore.exists() {
        std::fs::write(&ignore, "*.tmp\n.DS_Store\n").map_err(|e| e.to_string())?;
    }
    ensure_identity(vault);
    Ok(())
}

#[tauri::command]
pub async fn git_ensure_repo<R: Runtime>(app: AppHandle<R>, branch: String) -> CmdResult<()> {
    if branch.is_empty() || branch.starts_with('-') || branch.contains(char::is_whitespace) {
        return Err("invalid branch name".into());
    }
    let vault = paths(&app)?.vault();
    tauri::async_runtime::spawn_blocking(move || ensure_repo(&vault, &branch)).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn s(a: &[&str]) -> Vec<String> {
        a.iter().map(|x| x.to_string()).collect()
    }

    #[test]
    fn only_allowed_subcommands_and_safe_args() {
        assert!(check_args(&s(&["status", "--porcelain"])).is_ok());
        assert!(check_args(&s(&["push", "origin", "HEAD:main"])).is_ok());
        for bad in [
            s(&[]),
            s(&["config", "core.sshCommand", "evil"]),
            s(&["clone", "x"]),
            s(&["fetch", "--upload-pack=evil"]),
            s(&["remote", "add", "o", "ext::sh -c evil"]),
            s(&["push", "--exec=evil"]),
        ] {
            assert!(check_args(&bad).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn runs_real_git_in_a_folder_and_reports_exit_codes() {
        let dir = std::env::temp_dir().join(format!("branchmint-git-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        ensure_repo(&dir, "main").unwrap();
        assert!(dir.join(".git").exists());
        assert!(fs::read_to_string(dir.join(".gitignore")).unwrap().contains("*.tmp"));
        let head = run_git(&dir, &s(&["rev-parse", "--verify", "HEAD"])).unwrap();
        assert_ne!(head.code, 0, "unborn branch has no HEAD");
        let branch = run_git(&dir, &s(&["symbolic-ref", "--short", "HEAD"])).unwrap();
        assert_eq!(branch.stdout.trim(), "main");
        ensure_repo(&dir, "main").unwrap(); // idempotent
        fs::remove_dir_all(&dir).unwrap();
    }
}
