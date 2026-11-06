//! Replays every git call the TypeScript sync engine made during its tests (recorded by
//! `tests/sync.test.ts` into `fixtures/git-calls.json`) through the real argument validator.
//! If the engine starts making a call the Rust allow-list does not know, this fails.

#[test]
fn every_call_the_sync_engine_makes_is_allowed() {
    let text = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/git-calls.json"))
        .expect("run `pnpm test` first: it records the engine's git calls");
    let calls: Vec<Vec<String>> = serde_json::from_str(&text).unwrap();
    assert!(calls.len() > 15, "fixture looks too small: {} calls", calls.len());
    let mut rejected = Vec::new();
    for c in &calls {
        if let Err(e) = branchmint_lib::check_git_args(c) {
            rejected.push(format!("{c:?}: {e}"));
        }
    }
    assert!(rejected.is_empty(), "the engine makes git calls the backend refuses:\n{}", rejected.join("\n"));
}
