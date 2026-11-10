//! User templates: maps saved as starting points. They live in `<vault>/templates/<id>.jsonl`
//! (same file format as maps), so Git sync carries them to your other computers.

use std::fs;

use serde::Serialize;
use tauri::{AppHandle, Runtime};

use crate::storage::{atomic_write, paths, validate_id, validate_map_text, CmdResult};

#[derive(Serialize)]
pub struct TemplateFile {
    pub id: String,
    pub text: String,
}

#[tauri::command]
pub fn template_list<R: Runtime>(app: AppHandle<R>) -> CmdResult<Vec<TemplateFile>> {
    let dir = paths(&app)?.templates();
    let mut out = Vec::new();
    for e in fs::read_dir(dir).map_err(|e| e.to_string())?.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        let Some(id) = name.strip_suffix(".jsonl") else { continue };
        if validate_id(id).is_err() {
            continue;
        }
        // a damaged file is skipped, never an error for the whole list
        if let Ok(text) = fs::read_to_string(e.path()) {
            if validate_map_text(&text).is_ok() {
                out.push(TemplateFile { id: id.to_string(), text });
            }
        }
    }
    out.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(out)
}

#[tauri::command]
pub fn template_save<R: Runtime>(app: AppHandle<R>, id: String, text: String) -> CmdResult<()> {
    validate_id(&id)?;
    validate_map_text(&text)?;
    atomic_write(&paths(&app)?.templates().join(format!("{id}.jsonl")), text.as_bytes())
}

#[tauri::command]
pub fn template_delete<R: Runtime>(app: AppHandle<R>, id: String) -> CmdResult<()> {
    validate_id(&id)?;
    let path = paths(&app)?.templates().join(format!("{id}.jsonl"));
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}
