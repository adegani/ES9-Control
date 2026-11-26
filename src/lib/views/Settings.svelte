<script lang="ts">
  import { es9, FlashSlot } from "../store.svelte";
  import { DC_BLOCK_LABELS, DC_OFFSET_RANGE } from "../protocol";
  import HSlider from "../components/HSlider.svelte";
  import Select from "../components/Select.svelte";
  import Toggle from "../components/Toggle.svelte";
  import Icon from "../components/Icon.svelte";
  import { presets } from "../files";

  const cfg = $derived(es9.cfg);
  const CH_GROUPS = [{ label: "MIDI channel", options: Array.from({ length: 16 }, (_, i) => ({ value: i + 1, label: `Channel ${i + 1}` })) }];
  const mixes = $derived(es9.mixer2Enabled ? 16 : 8);

  /** Which reset is waiting for confirmation. */
  let confirmReset = $state<FlashSlot | null>(null);

  let presetName = $state("");
  async function savePreset(e: SubmitEvent) {
    e.preventDefault();
    if (await es9.savePreset(presetName)) presetName = "";
  }
  const fmtDate = (ms: number) =>
    ms ? new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "";
</script>

<div class="page">
  <div class="page-head">
    <div>
      <h1 class="page-title">Settings</h1>
      <p class="page-desc">Device options, filters, offsets and flash memory.</p>
    </div>
  </div>

  <div class="cols">
    <section class="card">
      <div class="card-head"><div class="card-title">Device memory</div></div>
      <div class="card-body stack">
        <p class="hint">Changes are applied live. Save to flash to make them persist across power cycles.</p>
        <div class="btnrow">
          <button class="btn primary" disabled={!es9.connected} onclick={() => es9.saveToFlash(FlashSlot.Hosted)}>
            <Icon name="save" /> Save (Hosted)
          </button>
          <button class="btn primary" disabled={!es9.connected} onclick={() => es9.saveToFlash(FlashSlot.Standalone)}>
            <Icon name="save" /> Save (Standalone)
          </button>
        </div>
        <div class="btnrow">
          <button class="btn" disabled={!es9.connected} onclick={() => es9.restoreFromFlash(FlashSlot.Hosted)}>
            <Icon name="download" /> Load (Hosted)
          </button>
          <button class="btn" disabled={!es9.connected} onclick={() => es9.restoreFromFlash(FlashSlot.Standalone)}>
            <Icon name="download" /> Load (Standalone)
          </button>
        </div>
        <p class="hint">Config files (.syx) hold the complete current state and work with the official ES-9 config tool.</p>
        <div class="btnrow">
          <button class="btn" disabled={!es9.connected} onclick={() => es9.exportConfigFile()}>
            <Icon name="download" /> Save to file…
          </button>
          <button class="btn" disabled={!es9.connected} onclick={() => es9.importConfigFile()}>
            <Icon name="upload" /> Load from file…
          </button>
        </div>
        <div class="btnrow">
          {#if confirmReset !== null}
            <span class="hint warn">
              {confirmReset === FlashSlot.Hosted
                ? "Reset to hosted defaults (mixer inputs on USB, S/PDIF on)?"
                : "Reset to standalone defaults (mixer inputs on analogue inputs, Mixer 2 on)?"}
              Flash is not affected.
            </span>
            <button class="btn danger" onclick={() => { es9.resetToDefaults(confirmReset!); confirmReset = null; }}>Reset</button>
            <button class="btn ghost" onclick={() => (confirmReset = null)}>Cancel</button>
          {:else}
            <button class="btn danger" disabled={!es9.connected} onclick={() => (confirmReset = FlashSlot.Hosted)}>
              <Icon name="reset" /> Reset (Hosted defaults)
            </button>
            <button class="btn danger" disabled={!es9.connected} onclick={() => (confirmReset = FlashSlot.Standalone)}>
              <Icon name="reset" /> Reset (Standalone defaults)
            </button>
          {/if}
        </div>
      </div>
    </section>

    <section class="card">
      <div class="card-head">
        <div class="card-title">Presets</div>
        <div class="card-sub">Named snapshots of the complete state, one click to recall</div>
      </div>
      <div class="card-body stack">
        <form class="btnrow" onsubmit={savePreset}>
          <input class="text-input" placeholder="Preset name" maxlength="64" bind:value={presetName} disabled={!es9.connected} />
          <button class="btn primary" type="submit" disabled={!es9.connected || !presetName.trim()}>
            <Icon name="save" /> Save current
          </button>
        </form>
        {#if es9.presetList.length === 0}
          <p class="hint">No presets yet. Loading a preset changes the current state only (undo with ⌘Z); save to flash to keep it.</p>
        {:else}
          <div class="presets">
            {#each es9.presetList as p (p.name)}
              <div class="preset">
                <div class="p-name" title={p.name}>{p.name}</div>
                <div class="p-date">{fmtDate(p.modified)}</div>
                <button class="btn" disabled={!es9.connected} onclick={() => es9.loadPreset(p.name)} title="Send this preset to the ES-9">
                  <Icon name="upload" /> Load
                </button>
                <button class="btn ghost icon" disabled={!es9.connected} onclick={() => es9.savePreset(p.name)} title="Replace with the current state" aria-label="Replace {p.name}">
                  <Icon name="save" />
                </button>
                <button class="btn ghost icon" onclick={() => es9.deletePreset(p.name)} title="Delete preset" aria-label="Delete {p.name}">
                  <Icon name="trash" />
                </button>
              </div>
            {/each}
          </div>
        {/if}
        {#if presets.hasFolder()}
          <div class="btnrow">
            <button class="btn ghost" onclick={() => es9.revealPresets()}><Icon name="folder" /> Show presets folder</button>
          </div>
        {/if}
      </div>
    </section>

    <section class="card">
      <div class="card-head"><div class="card-title">Options</div></div>
      <div class="card-body stack">
        <div class="setting">
          <div>
            <div class="s-title">Fourth DSP block</div>
            <div class="hint">Use it for the S/PDIF ports or as a second 8×8 mixer.</div>
          </div>
          <div class="seg">
            <button class:on={!es9.mixer2Enabled} onclick={() => es9.setMixer2(false)}>S/PDIF</button>
            <button class:on={es9.mixer2Enabled} onclick={() => es9.setMixer2(true)}>Mixer 2</button>
          </div>
        </div>
        <div class="setting">
          <div>
            <div class="s-title">MIDI Thru</div>
            <div class="hint">Echo incoming DIN MIDI to the MIDI output.</div>
          </div>
          <Toggle label="MIDI Thru" checked={es9.midiThru} onchange={(v) => es9.setMidiThru(v)} />
        </div>
        <div class="setting">
          <div>
            <div class="s-title">Mixer MIDI channels</div>
            <div class="hint">Channels on which the mixers respond to MIDI CC.</div>
          </div>
          <div class="midich">
            <span class="label">USB</span>
            <Select label="USB MIDI channel" value={cfg.midiChUsb} groups={CH_GROUPS} compact onchange={(v) => es9.setMidiChannels(v, cfg.midiChDin)} />
            <span class="label">DIN</span>
            <Select label="DIN MIDI channel" value={cfg.midiChDin} groups={CH_GROUPS} compact onchange={(v) => es9.setMidiChannels(cfg.midiChUsb, v)} />
          </div>
        </div>
      </div>
    </section>

    <section class="card">
      <div class="card-head">
        <div class="card-title">Input DC blocking</div>
        <div class="card-sub">High-pass filters on the analogue inputs</div>
      </div>
      <div class="card-body pills">
        {#each DC_BLOCK_LABELS as l, i (i)}
          {@const on = (cfg.hpf & (1 << i)) !== 0}
          <button class="pill" class:on onclick={() => es9.setHpfBit(i, !on)}><span class="dot"></span>{l}</button>
        {/each}
      </div>
    </section>

    <section class="card">
      <div class="card-head">
        <div class="card-title">Mix smoothing</div>
        <div class="card-sub">Smooth gain changes on each mix (uses DSP)</div>
      </div>
      <div class="card-body pills">
        {#each Array(mixes) as _, m (m)}
          <button class="pill" class:on={cfg.smoothing[m]} onclick={() => es9.setSmoothing(m, !cfg.smoothing[m])} title={es9.mixDest(m)}>
            <span class="dot"></span>Mix {m + 1}
          </button>
        {/each}
      </div>
    </section>

    <section class="card wide">
      <div class="card-head">
        <div class="card-title">Output DC offsets</div>
        <div class="card-sub">Only applied when a mixer is routed to the output. Double-click to zero.</div>
      </div>
      <div class="card-body dcgrid">
        {#each cfg.dcOffset as v, i (i)}
          <div class="dc">
            <span class="dc-l">Output {i + 1}</span>
            <HSlider
              label="Output {i + 1} DC offset"
              value={v}
              min={-DC_OFFSET_RANGE}
              max={DC_OFFSET_RANGE}
              defaultValue={0}
              accent="var(--violet)"
              text={`${v > 0 ? "+" : ""}${v}`}
              onchange={(nv) => es9.setDcOffset(i, nv)}
            />
          </div>
        {/each}
      </div>
    </section>
  </div>
</div>

<style>
  .cols {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    align-items: start;
  }
  .wide {
    grid-column: 1 / -1;
  }
  @media (max-width: 1100px) {
    .cols {
      grid-template-columns: 1fr;
    }
  }
  .stack {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .btnrow {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
  }
  .hint {
    color: var(--muted);
    font-size: 12px;
    margin: 0;
  }
  .hint.warn {
    color: #fda4af;
  }
  .setting {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--border);
  }
  .setting:last-child {
    border-bottom: 0;
    padding-bottom: 0;
  }
  .s-title {
    font-weight: 600;
  }
  .midich {
    display: grid;
    grid-template-columns: auto 120px auto 120px;
    align-items: center;
    gap: 8px;
  }
  .pills {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .dcgrid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 10px 18px;
  }
  .dc {
    display: grid;
    grid-template-columns: 64px 1fr;
    align-items: center;
    gap: 8px;
  }
  .text-input {
    flex: 1;
    min-width: 0;
    height: 28px;
    padding: 0 10px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-2);
    background: var(--bg-2);
    color: var(--text);
    outline: none;
    user-select: text;
    -webkit-user-select: text;
  }
  .text-input:focus {
    border-color: var(--accent);
  }
  .presets {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  .preset {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto auto auto;
    align-items: center;
    gap: 8px;
    padding: 6px 8px 6px 12px;
    border-top: 1px solid var(--border);
  }
  .preset:first-child {
    border-top: 0;
  }
  .preset:hover {
    background: var(--panel-2);
  }
  .p-name {
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .p-date {
    color: var(--muted);
    font-size: 11px;
    white-space: nowrap;
  }
  .btn.icon {
    width: 28px;
    padding: 0;
    justify-content: center;
  }
  .dc-l {
    font-size: 12px;
    color: var(--text-2);
    font-weight: 500;
  }
</style>
