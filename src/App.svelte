<script lang="ts">
  import { onMount } from "svelte";
  import { es9, FlashSlot } from "./lib/store.svelte";
  import Icon from "./lib/components/Icon.svelte";
  import Routing from "./lib/views/Routing.svelte";
  import Mixer from "./lib/views/Mixer.svelte";
  import Matrix from "./lib/views/Matrix.svelte";
  import Eq from "./lib/views/Eq.svelte";
  import Settings from "./lib/views/Settings.svelte";
  import Monitor from "./lib/views/Monitor.svelte";

  const VIEWS = [
    { id: "routing", label: "Routing", icon: "routing", comp: Routing },
    { id: "mixer", label: "Mixer", icon: "mixer", comp: Mixer },
    { id: "matrix", label: "Raw matrix", icon: "matrix", comp: Matrix },
    { id: "eq", label: "Input EQ", icon: "eq", comp: Eq },
    { id: "settings", label: "Settings", icon: "settings", comp: Settings },
    { id: "monitor", label: "MIDI monitor", icon: "monitor", comp: Monitor },
  ] as const;

  type ViewId = (typeof VIEWS)[number]["id"];
  const initialView = (location.hash.slice(1) || localStorage.getItem("es9.view") || "mixer") as ViewId;
  let view = $state<ViewId>(VIEWS.some((v) => v.id === initialView) ? initialView : "mixer");
  const Current = $derived(VIEWS.find((v) => v.id === view)!.comp);
  $effect(() => localStorage.setItem("es9.view", view));

  let portsOpen = $state(false);
  let saveOpen = $state(false);
  let selIn = $state<string>("");
  let selOut = $state<string>("");

  onMount(() => {
    es9.init();
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const n = Number(e.key);
      if (n >= 1 && n <= VIEWS.length) {
        view = VIEWS[n - 1].id;
        e.preventDefault();
      } else if (e.key.toLowerCase() === "z" && !(e.target as Element).closest("input, textarea")) {
        if (e.shiftKey) es9.redo();
        else es9.undo();
        e.preventDefault();
      } else if (e.key === "r") {
        es9.requestConfig();
        e.preventDefault();
      } else if (e.key === "s" && es9.connected) {
        es9.saveToFlash(e.shiftKey ? FlashSlot.Standalone : FlashSlot.Hosted);
        e.preventDefault();
      }
    };
    const onDown = (e: PointerEvent) => {
      if (!(e.target as Element).closest(".pop-anchor")) {
        portsOpen = false;
        saveOpen = false;
      }
    };
    // The unit never reports changes made elsewhere (other software, the front-panel
    // knob): re-read it whenever the user comes back to the window.
    const onFocus = () => es9.autoSync();
    const onVisible = () => document.visibilityState === "visible" && es9.autoSync();
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  });

  function openPorts() {
    selIn = es9.inputName ?? es9.ports.inputs[0] ?? "";
    selOut = es9.outputName ?? es9.ports.outputs[0] ?? "";
    portsOpen = !portsOpen;
    saveOpen = false;
  }
  async function applyPorts() {
    if (selIn && selOut) await es9.connect(selIn, selOut);
    portsOpen = false;
  }

  const srText = $derived(es9.sampleRate ? `${(es9.sampleRate / 1000).toFixed(es9.sampleRate % 1000 ? 1 : 0)} kHz` : "—");
  const pct = (u: number | null) => (u === null ? "—" : `${u.toFixed(0)}%`);
</script>

<div class="app">
  <header class="top" data-tauri-drag-region>
    <div class="brand" data-tauri-drag-region>
      <span class="logo"><Icon name="mixer" size={15} /></span>
      <span class="name">ES-9 Control</span>
    </div>

    <div class="pop-anchor">
      <button class="conn" class:ok={es9.connected} onclick={openPorts} title="MIDI ports">
        <span class="led"></span>
        {#if es9.connected}
          <span>{es9.simulated ? "Simulated ES-9" : "ES-9 connected"}</span>
          {#if es9.version}<span class="ver">{es9.version}</span>{/if}
        {:else}
          <span>Not connected</span>
        {/if}
        <Icon name="chevron" size={12} />
      </button>
      {#if portsOpen}
        <div class="pop ports">
          <div class="pop-title">MIDI ports</div>
          <label>
            <span class="label">Listen on (input)</span>
            <select bind:value={selIn}>
              {#each es9.ports.inputs as p (p)}<option value={p}>{p}</option>{/each}
            </select>
          </label>
          <label>
            <span class="label">Send to (output)</span>
            <select bind:value={selOut}>
              {#each es9.ports.outputs as p (p)}<option value={p}>{p}</option>{/each}
            </select>
          </label>
          {#if es9.ports.inputs.length === 0}
            <p class="note">No MIDI ports found. Connect the ES-9 via USB.</p>
          {/if}
          <div class="pop-actions">
            {#if es9.connected}
              <button class="btn ghost" onclick={() => { es9.disconnect(); portsOpen = false; }}>Disconnect</button>
            {/if}
            <div class="spacer"></div>
            <button class="btn primary" disabled={!selIn || !selOut} onclick={applyPorts}><Icon name="plug" /> Connect</button>
          </div>
        </div>
      {/if}
    </div>

    <div class="stats" data-tauri-drag-region>
      <div class="stat"><span class="k">Sample rate</span><span class="v mono">{srText}</span></div>
      <div class="stat"><span class="k">DSP 1</span><span class="v mono">{pct(es9.usage[0])}</span></div>
      {#if es9.usage[1] !== null}
        <div class="stat"><span class="k">DSP 2</span><span class="v mono">{pct(es9.usage[1])}</span></div>
      {/if}
    </div>

    <div class="spacer" data-tauri-drag-region></div>

    <div class="history">
      <button class="btn icon" disabled={!es9.connected || !es9.canUndo} onclick={() => es9.undo()} title="Undo (⌘Z)" aria-label="Undo">
        <Icon name="undo" />
      </button>
      <button class="btn icon" disabled={!es9.connected || !es9.canRedo} onclick={() => es9.redo()} title="Redo (⇧⌘Z)" aria-label="Redo">
        <Icon name="redo" />
      </button>
    </div>
    <button class="btn" disabled={!es9.connected} onclick={() => es9.requestConfig()} title="Reload config from ES-9 (⌘R)">
      <Icon name="refresh" /> Sync
    </button>
    <div class="pop-anchor">
      <button
        class="btn primary"
        disabled={!es9.connected}
        onclick={() => { saveOpen = !saveOpen; portsOpen = false; }}
        title={es9.unsaved ? "Changes made since the last save to / load from flash will be lost on power-off" : "Save the current state to flash"}
      >
        {#if es9.unsaved}<span class="unsaved-dot" aria-label="Unsaved changes"></span>{/if}
        <Icon name="save" /> Save to flash <Icon name="chevron" size={12} />
      </button>
      {#if saveOpen}
        <div class="pop menu">
          <button onclick={() => { es9.saveToFlash(FlashSlot.Hosted); saveOpen = false; }}>
            Save — Hosted slot <span class="kbd">⌘S</span>
          </button>
          <button onclick={() => { es9.saveToFlash(FlashSlot.Standalone); saveOpen = false; }}>
            Save — Standalone slot <span class="kbd">⇧⌘S</span>
          </button>
          <hr />
          <button onclick={() => { es9.restoreFromFlash(FlashSlot.Hosted); saveOpen = false; }}>Load — Hosted slot</button>
          <button onclick={() => { es9.restoreFromFlash(FlashSlot.Standalone); saveOpen = false; }}>Load — Standalone slot</button>
        </div>
      {/if}
    </div>
  </header>

  <nav class="side">
    {#each VIEWS as v, i (v.id)}
      <button class="nav" class:on={view === v.id} onclick={() => (view = v.id)} title="{v.label} (⌘{i + 1})">
        <Icon name={v.icon} size={17} />
        <span>{v.label}</span>
      </button>
    {/each}
    <div class="spacer"></div>
    <div class="foot">
      {#if es9.haveConfig}<span class="ok-dot"></span> Config loaded{:else}<span class="wait-dot"></span> No config{/if}
    </div>
  </nav>

  <main class="content">
    {#if !es9.connected}
      <div class="banner">
        <Icon name="plug" />
        <span>
          <b>ES-9 not connected.</b> Plug the ES-9 in via USB: it is detected automatically. You can also choose the MIDI
          ports by hand.
        </span>
        <button class="btn sm" onclick={openPorts}>Choose ports</button>
      </div>
    {/if}
    {#key view}
      <Current />
    {/key}
  </main>

  <div class="toasts">
    {#each es9.toasts as t (t.id)}
      <div class="toast {t.kind}">{t.text}</div>
    {/each}
  </div>
</div>

<style>
  .history {
    display: flex;
    gap: 4px;
  }
  .btn.icon {
    width: 30px;
    padding: 0;
    justify-content: center;
  }
  .unsaved-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--amber);
    box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.25);
  }
  .app {
    display: grid;
    grid-template-columns: 196px 1fr;
    grid-template-rows: 52px 1fr;
    height: 100%;
  }
  .top {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 14px 0 86px; /* room for macOS traffic lights */
    background: var(--bg-2);
    border-bottom: 1px solid var(--border);
    position: relative;
    z-index: 10;
  }
  .brand {
    white-space: nowrap;
    flex: none;
    display: flex;
    align-items: center;
    gap: 8px;
    width: 120px;
  }
  .logo {
    width: 24px;
    height: 24px;
    border-radius: 7px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, #2dd4bf, #0e9488);
    color: #04201c;
  }
  .name {
    font-weight: 700;
    letter-spacing: -0.01em;
  }
  .pop-anchor {
    position: relative;
  }
  .conn {
    white-space: nowrap;
    display: flex;
    align-items: center;
    gap: 8px;
    height: 30px;
    padding: 0 10px 0 12px;
    border-radius: 999px;
    border: 1px solid rgba(244, 63, 94, 0.4);
    background: rgba(244, 63, 94, 0.08);
    font-weight: 500;
  }
  .conn.ok {
    border-color: rgba(34, 197, 94, 0.4);
    background: rgba(34, 197, 94, 0.08);
  }
  .led {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--danger);
    box-shadow: 0 0 8px var(--danger);
  }
  .ok .led {
    background: var(--success);
    box-shadow: 0 0 8px var(--success);
  }
  .ver {
    color: var(--muted);
    font-size: 11.5px;
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .stats {
    display: flex;
    gap: 18px;
    margin-left: 8px;
  }
  .stat {
    white-space: nowrap;
    display: flex;
    flex-direction: column;
    line-height: 1.15;
  }
  .stat .k {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--faint);
    font-weight: 600;
  }
  .stat .v {
    font-size: 12.5px;
    color: var(--text);
  }
  .pop {
    position: absolute;
    top: calc(100% + 8px);
    left: 0;
    z-index: 50;
    background: var(--panel-2);
    border: 1px solid var(--border-2);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
  }
  .pop.ports {
    width: 320px;
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .pop-title {
    font-weight: 650;
  }
  .pop label {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .pop select {
    height: 30px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-2);
    background: var(--panel);
    padding: 0 8px;
  }
  .note {
    color: var(--muted);
    margin: 0;
    font-size: 12px;
  }
  .pop-actions {
    display: flex;
    gap: 8px;
  }
  .pop.menu {
    left: auto;
    right: 0;
    width: 250px;
    padding: 5px;
    display: flex;
    flex-direction: column;
  }
  .menu button {
    display: flex;
    justify-content: space-between;
    align-items: center;
    height: 30px;
    padding: 0 10px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    text-align: left;
  }
  .menu button:hover {
    background: var(--accent-2);
    color: #04201c;
  }
  .menu hr {
    border: 0;
    border-top: 1px solid var(--border-2);
    margin: 4px 6px;
  }
  .kbd {
    font-size: 11px;
    opacity: 0.6;
  }
  .side {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 12px 10px;
    background: var(--bg-2);
    border-right: 1px solid var(--border);
  }
  .nav {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 34px;
    padding: 0 10px;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-2);
    font-weight: 500;
    text-align: left;
  }
  .nav:hover {
    background: var(--panel);
    color: var(--text);
  }
  .nav.on {
    background: var(--panel-2);
    color: var(--text);
    box-shadow: inset 2px 0 0 var(--accent);
  }
  .nav.on :global(svg) {
    color: var(--accent);
  }
  .foot {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 11.5px;
    color: var(--muted);
    padding: 8px 10px;
  }
  .ok-dot,
  .wait-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--success);
  }
  .wait-dot {
    background: var(--faint);
  }
  .content {
    overflow: auto;
    min-width: 0;
    position: relative;
    display: flex;
    flex-direction: column;
  }
  .banner {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 16px 26px 0;
    padding: 10px 14px;
    border-radius: var(--radius);
    border: 1px solid rgba(251, 191, 36, 0.35);
    background: rgba(251, 191, 36, 0.07);
    color: #fde68a;
  }
  .banner span {
    flex: 1;
  }
  .toasts {
    position: fixed;
    right: 18px;
    bottom: 18px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    z-index: 100;
  }
  .toast {
    padding: 10px 14px;
    border-radius: var(--radius-sm);
    background: var(--panel-3);
    border: 1px solid var(--border-2);
    box-shadow: var(--shadow);
    font-weight: 500;
    animation: slide 0.18s ease-out;
  }
  .toast.success {
    border-color: rgba(34, 197, 94, 0.5);
  }
  .toast.error {
    border-color: rgba(244, 63, 94, 0.6);
  }
  @keyframes slide {
    from {
      transform: translateY(8px);
      opacity: 0;
    }
  }
</style>
