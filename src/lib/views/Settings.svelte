<script lang="ts">
  import { es9, FlashSlot } from "../store.svelte";
  import { DC_BLOCK_LABELS, DC_OFFSET_RANGE } from "../protocol";
  import HSlider from "../components/HSlider.svelte";
  import Select from "../components/Select.svelte";
  import Toggle from "../components/Toggle.svelte";
  import Icon from "../components/Icon.svelte";

  const cfg = $derived(es9.cfg);
  const CH_GROUPS = [{ label: "MIDI channel", options: Array.from({ length: 16 }, (_, i) => ({ value: i + 1, label: `Channel ${i + 1}` })) }];
  const mixes = $derived(es9.mixer2Enabled ? 16 : 8);

  let confirmReset = $state(false);
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
        <div class="btnrow">
          {#if confirmReset}
            <span class="hint warn">Reset the current state to factory defaults? (Flash is not affected.)</span>
            <button class="btn danger" onclick={() => { es9.resetToDefaults(); confirmReset = false; }}>Reset</button>
            <button class="btn ghost" onclick={() => (confirmReset = false)}>Cancel</button>
          {:else}
            <button class="btn danger" disabled={!es9.connected} onclick={() => (confirmReset = true)}>
              <Icon name="reset" /> Reset to defaults
            </button>
          {/if}
        </div>
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
  .dc-l {
    font-size: 12px;
    color: var(--text-2);
    font-weight: 500;
  }
</style>
