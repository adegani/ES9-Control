//! Reads and writes the raw bytes of config files (.syx). Paths come from the
//! native open/save dialogs (tauri-plugin-dialog) in the UI.

/// Largest file accepted by `file_read`; a config dump is 2313 bytes.
const MAX_READ: u64 = 64 * 1024;

#[tauri::command]
pub fn file_read(path: String) -> Result<Vec<u8>, String> {
    let len = std::fs::metadata(&path).map_err(|e| e.to_string())?.len();
    if len > MAX_READ {
        return Err(format!("file too large ({len} bytes)"));
    }
    std::fs::read(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn file_write(path: String, data: Vec<u8>) -> Result<(), String> {
    std::fs::write(&path, data).map_err(|e| e.to_string())
}

// ───────────────────────────── Presets ─────────────────────────────
// Named config dumps kept as <app data dir>/presets/<name>.syx.

use serde::Serialize;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
pub struct PresetInfo {
    name: String,
    /// Last modification time, in milliseconds since the Unix epoch.
    modified: u64,
}

fn presets_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("presets");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// A preset name must be a plain, visible file name: no paths, no hidden files.
fn check_preset_name(name: &str) -> Result<&str, String> {
    let n = name.trim();
    let bad = n.is_empty()
        || n.chars().count() > 64
        || n.starts_with('.')
        || n.chars().any(|c| c.is_control() || matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'));
    if bad {
        Err(format!("invalid preset name {name:?}"))
    } else {
        Ok(n)
    }
}

fn preset_path(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    Ok(presets_dir(app)?.join(format!("{}.syx", check_preset_name(name)?)))
}

#[tauri::command]
pub fn presets_list(app: AppHandle) -> Result<Vec<PresetInfo>, String> {
    let mut out = vec![];
    for entry in std::fs::read_dir(presets_dir(&app)?).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
        if path.extension().and_then(|e| e.to_str()) != Some("syx") {
            continue;
        }
        let Some(name) = path.file_stem().and_then(|s| s.to_str()) else { continue };
        let modified = std::fs::metadata(&path)
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map_or(0, |d| d.as_millis() as u64);
        out.push(PresetInfo { name: name.to_string(), modified });
    }
    out.sort_by_key(|p| p.name.to_lowercase());
    Ok(out)
}

#[tauri::command]
pub fn preset_read(app: AppHandle, name: String) -> Result<Vec<u8>, String> {
    file_read(preset_path(&app, &name)?.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn preset_write(app: AppHandle, name: String, data: Vec<u8>) -> Result<(), String> {
    std::fs::write(preset_path(&app, &name)?, data).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn preset_delete(app: AppHandle, name: String) -> Result<(), String> {
    std::fs::remove_file(preset_path(&app, &name)?).map_err(|e| e.to_string())
}

/// Opens the presets folder in Finder / Explorer / the file manager.
#[tauri::command]
pub fn presets_reveal(app: AppHandle) -> Result<(), String> {
    let dir = presets_dir(&app)?;
    #[cfg(target_os = "macos")]
    let opener = "open";
    #[cfg(target_os = "windows")]
    let opener = "explorer";
    #[cfg(all(unix, not(target_os = "macos")))]
    let opener = "xdg-open";
    std::process::Command::new(opener).arg(dir).spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::check_preset_name;

    #[test]
    fn preset_names() {
        assert_eq!(check_preset_name("  Live set 1 "), Ok("Live set 1"));
        assert!(check_preset_name("Mixer à 2 — test").is_ok());
        for bad in ["", "   ", ".hidden", "../x", "a/b", "a\\b", "c:d", "x\ny", &"n".repeat(65)] {
            assert!(check_preset_name(bad).is_err(), "{bad:?} should be rejected");
        }
    }
}
