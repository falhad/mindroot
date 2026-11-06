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

const TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Serialize, Debug)]
pub struct GitOut {
    pub code: i32,
    pub stdout: String,
    pub stderr: String,
}

/// One position in an argument template.
enum P {
    /// Exactly this text.
    L(&'static str),
    /// A branch name, e.g. `main`.
    Branch,
    /// `HEAD` or `origin/<branch>`.
    Ref,
    /// A remote address (https://, ssh://, git@host:path).
    Url,
    /// Free text (commit message). It only ever follows `-m`, which takes the next word as its value.
    Msg,
    /// A file inside the vault (`maps/…`, `assets/…`, `.gitignore`).
    Path,
    /// `:1:<path>` .. `:3:<path>` (merge stages).
    Stage,
    /// `HEAD:refs/heads/<branch>`.
    PushDest,
    /// `HEAD...origin/<branch>`.
    SymRange,
    /// `origin/<branch>..HEAD`.
    AheadRange,
}
use P::*;

/// Every call the app makes, spelled out. Anything else is refused. There is no prefix matching:
/// Git accepts abbreviated long options (`--upload-p=…`), so a deny-list cannot be made safe.
/// Keep in step with `src/sync/engine.ts` and `src/plugins/builtin/sync/controller.ts`;
/// `tests/git_contract.rs` replays the calls recorded from the TypeScript tests.
const TEMPLATES: &[&[P]] = &[
    &[L("init"), L("-b"), Branch],
    &[L("remote"), L("get-url"), L("origin")],
    &[L("remote"), L("add"), L("origin"), Url],
    &[L("remote"), L("set-url"), L("origin"), Url],
    &[L("status"), L("--porcelain")],
    &[L("add"), L("-A")],
    &[L("add"), L("-A"), L("--"), Path],
    &[L("commit"), L("-m"), Msg],
    &[L("commit"), L("--no-edit")],
    &[L("fetch"), L("origin")],
    &[L("rev-parse"), L("--verify"), L("--quiet"), Ref],
    &[L("rev-list"), L("--left-right"), L("--count"), SymRange],
    &[L("rev-list"), L("--count"), AheadRange],
    &[L("push"), L("origin"), PushDest],
    &[L("push"), L("-u"), L("origin"), PushDest],
    &[L("checkout"), L("-f"), L("-B"), Branch, Ref],
    &[L("checkout"), L("--ours"), L("--"), Path],
    &[L("ls-files")],
    &[L("diff"), L("--name-only"), L("HEAD"), Ref],
    &[L("diff"), L("--name-only"), L("--diff-filter=U")],
    &[L("merge-base"), L("HEAD"), Ref],
    &[L("merge"), Ref, L("--no-edit"), L("-m"), Msg],
    &[L("merge"), Ref, L("--no-edit"), L("-m"), Msg, L("--allow-unrelated-histories")],
    &[L("merge"), L("--abort")],
    &[L("show"), Stage],
    &[L("rm"), L("-q"), L("--"), Path],
];

pub fn valid_branch(b: &str) -> bool {
    !b.is_empty()
        && b.len() <= 100
        && !b.starts_with(['-', '/', '.'])
        && !b.ends_with(['/', '.'])
        && !b.contains("..")
        && !b.contains("//")
        && !b.ends_with(".lock")
        && b.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '/' | '-'))
}

fn valid_path(p: &str) -> bool {
    (p == ".gitignore" || p.starts_with("maps/") || p.starts_with("assets/"))
        && p.len() <= 300
        && !p.contains("..")
        && !p.contains("//")
        && p.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '/' | '-'))
}

fn valid_url(u: &str) -> bool {
    u.len() <= 500
        && !u.chars().any(|c| c.is_whitespace() || c.is_control())
        && (u.starts_with("https://") || u.starts_with("ssh://") || u.starts_with("git@"))
        && !u.starts_with("ext::")
}

fn matches_pos(p: &P, a: &str) -> bool {
    match p {
        L(x) => a == *x,
        Branch => valid_branch(a),
        Ref => a == "HEAD" || a.strip_prefix("origin/").is_some_and(valid_branch),
        Url => valid_url(a),
        Msg => a.len() <= 500 && !a.contains('\0'),
        Path => valid_path(a),
        Stage => a.strip_prefix(':').and_then(|r| r.split_once(':')).is_some_and(|(n, path)| matches!(n, "1" | "2" | "3") && valid_path(path)),
        PushDest => a.strip_prefix("HEAD:refs/heads/").is_some_and(valid_branch),
        SymRange => a.strip_prefix("HEAD...origin/").is_some_and(valid_branch),
        AheadRange => a.strip_suffix("..HEAD").and_then(|r| r.strip_prefix("origin/")).is_some_and(valid_branch),
    }
}

/// Accepts only the exact argument shapes in `TEMPLATES`.
pub fn check_args(args: &[String]) -> CmdResult<()> {
    let ok = TEMPLATES.iter().any(|t| t.len() == args.len() && t.iter().zip(args).all(|(p, a)| matches_pos(p, a)));
    if ok {
        Ok(())
    } else {
        Err(format!("git call not allowed: {}", args.first().map(String::as_str).unwrap_or("(empty)")))
    }
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
    if !valid_branch(&branch) {
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
    fn accepts_the_calls_the_app_makes() {
        for a in [
            s(&["status", "--porcelain"]),
            s(&["fetch", "origin"]),
            s(&["push", "origin", "HEAD:refs/heads/main"]),
            s(&["push", "-u", "origin", "HEAD:refs/heads/main"]),
            s(&["commit", "-m", "Sync from my-mac at 2026-01-01T00:00:00Z"]),
            s(&["remote", "add", "origin", "git@github.com:you/vault.git"]),
            s(&["remote", "set-url", "origin", "https://github.com/you/vault.git"]),
            s(&["rev-list", "--left-right", "--count", "HEAD...origin/main"]),
            s(&["show", ":2:maps/abc123.jsonl"]),
            s(&["checkout", "-f", "-B", "main", "origin/main"]),
            s(&["merge", "origin/main", "--no-edit", "-m", "m", "--allow-unrelated-histories"]),
            s(&["add", "-A", "--", "maps/abc.jsonl"]),
        ] {
            assert!(check_args(&a).is_ok(), "{a:?}");
        }
    }

    #[test]
    fn refuses_everything_else_including_abbreviated_options() {
        for bad in [
            s(&[]),
            s(&["config", "core.sshCommand", "evil"]),
            s(&["clone", "x"]),
            s(&["fetch", "--upload-pack=evil", "origin"]),
            s(&["fetch", "--upload-p=evil", "origin"]), // Git accepts abbreviations
            s(&["fetch", "--up=evil", "origin"]),
            s(&["fetch", "origin", "--upload-pack=evil"]), // extra argument
            s(&["fetch", "origin", "main"]),
            s(&["push", "--receive-pack=evil", "origin", "HEAD:refs/heads/main"]),
            s(&["push", "origin", "HEAD:refs/heads/main", "--force"]),
            s(&["push", "origin", "HEAD:refs/heads/--evil"]),
            s(&["push", "origin", "+HEAD:refs/heads/main"]),
            s(&["remote", "add", "origin", "ext::sh -c evil"]),
            s(&["remote", "add", "origin", "-evil"]),
            s(&["remote", "add", "origin", "https://x/y z"]),
            s(&["remote", "add", "origin", "/etc/passwd"]),
            s(&["remote", "add", "evil", "git@github.com:a/b.git"]),
            s(&["checkout", "-f", "-B", "-x", "origin/main"]),
            s(&["checkout", "--ours", "--", "../../etc/passwd"]),
            s(&["checkout", "--ours", "--", "maps/../../x"]),
            s(&["show", ":9:maps/a.jsonl"]),
            s(&["show", "HEAD:secrets"]),
            s(&["rm", "-q", "--", "-rf"]),
            s(&["add", "-A", "--", "/etc/passwd"]),
            s(&["merge", "origin/main", "--no-edit", "-m", "m", "--exec=evil"]),
            s(&["merge", "-s", "ours", "origin/main"]),
            s(&["status", "--porcelain", "--ignored"]),
            s(&["log"]),
            s(&["reset", "--hard"]),
        ] {
            assert!(check_args(&bad).is_err(), "{bad:?}");
        }
        // a commit message with a NUL byte is refused
        assert!(check_args(&s(&["commit", "-m", "a\0b"])).is_err());
    }

    #[test]
    fn branch_names_are_strict() {
        for ok in ["main", "feature/x", "release-1.2", "a_b"] {
            assert!(valid_branch(ok), "{ok}");
        }
        for bad in ["", "-x", "/x", ".x", "x.", "a..b", "a//b", "x.lock", "a b", "a;b", "a$b", "--upload-pack=x"] {
            assert!(!valid_branch(bad), "{bad}");
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
        let head = run_git(&dir, &s(&["rev-parse", "--verify", "--quiet", "HEAD"])).unwrap();
        assert_ne!(head.code, 0, "unborn branch has no HEAD");
        let st = run_git(&dir, &s(&["status", "--porcelain"])).unwrap();
        assert!(st.stdout.contains(".gitignore"));
        ensure_repo(&dir, "main").unwrap(); // idempotent
        fs::remove_dir_all(&dir).unwrap();
    }
}
