/**
 * Open/save of binary files and a yes/no prompt. Inside Tauri this uses the
 * native dialogs plus the `file_read` / `file_write` commands; in a plain
 * browser (`npm run dev`) it falls back to a download link and a file input.
 */
const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const SYX_FILTER = { name: "SysEx", extensions: ["syx"] };
const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path;

/** Asks where to save and writes the bytes. Returns the file name, or null if cancelled. */
export async function saveBytes(defaultName: string, data: number[]): Promise<string | null> {
  if (isTauri()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { invoke } = await import("@tauri-apps/api/core");
    const path = await save({ defaultPath: defaultName, filters: [SYX_FILTER] });
    if (!path) return null;
    await invoke("file_write", { path, data });
    return baseName(path);
  }
  const url = URL.createObjectURL(new Blob([new Uint8Array(data)], { type: "application/octet-stream" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: defaultName });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return defaultName;
}

/** Asks for a file and reads it. Returns null if cancelled. */
export async function openBytes(): Promise<{ name: string; bytes: number[] } | null> {
  if (isTauri()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const { invoke } = await import("@tauri-apps/api/core");
    const path = await open({ multiple: false, directory: false, filters: [SYX_FILTER] });
    if (!path) return null;
    return { name: baseName(path), bytes: await invoke<number[]>("file_read", { path }) };
  }
  return new Promise((resolve) => {
    const input = Object.assign(document.createElement("input"), { type: "file", accept: ".syx" });
    input.onchange = async () => {
      const f = input.files?.[0];
      resolve(f ? { name: f.name, bytes: Array.from(new Uint8Array(await f.arrayBuffer())) } : null);
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

/** Yes/no confirmation. */
export async function confirmAction(title: string, message: string, okLabel: string): Promise<boolean> {
  if (isTauri()) {
    const { ask } = await import("@tauri-apps/plugin-dialog");
    return ask(message, { title, kind: "warning", okLabel, cancelLabel: "Cancel" });
  }
  return window.confirm(`${title}\n\n${message}`);
}

// ───────────────────────────── Presets ─────────────────────────────
// Named config dumps. Tauri keeps them as .syx files in the app data folder;
// the browser build keeps them in localStorage.

export interface PresetInfo {
  name: string;
  /** Milliseconds since the Unix epoch. */
  modified: number;
}

const PRESETS_KEY = "es9.presets";
type StoredPresets = Record<string, { data: number[]; modified: number }>;
const loadStored = (): StoredPresets => JSON.parse(localStorage.getItem(PRESETS_KEY) ?? "{}");
const saveStored = (p: StoredPresets) => localStorage.setItem(PRESETS_KEY, JSON.stringify(p));

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export const presets = {
  /** True when the presets live in a folder that can be shown in the file manager. */
  hasFolder: isTauri,
  async list(): Promise<PresetInfo[]> {
    if (isTauri()) return tauriInvoke("presets_list");
    return Object.entries(loadStored())
      .map(([name, p]) => ({ name, modified: p.modified }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },
  async read(name: string): Promise<number[]> {
    if (isTauri()) return tauriInvoke("preset_read", { name });
    const p = loadStored()[name];
    if (!p) throw new Error(`preset "${name}" not found`);
    return p.data;
  },
  async write(name: string, data: number[]): Promise<void> {
    if (isTauri()) return tauriInvoke("preset_write", { name, data });
    saveStored({ ...loadStored(), [name.trim()]: { data, modified: Date.now() } });
  },
  async remove(name: string): Promise<void> {
    if (isTauri()) return tauriInvoke("preset_delete", { name });
    const all = loadStored();
    delete all[name];
    saveStored(all);
  },
  async reveal(): Promise<void> {
    if (isTauri()) return tauriInvoke("presets_reveal");
  },
};
