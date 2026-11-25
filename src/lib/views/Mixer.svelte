<script lang="ts">
  import { es9 } from "../store.svelte";
  import { formatDb, formatPan, VMIX_MAX, VMIX_UNITY, vmixToDb } from "../protocol";
  import Fader from "../components/Fader.svelte";
  import Knob from "../components/Knob.svelte";
  import Icon from "../components/Icon.svelte";

  let mixer = $state(0);
  $effect(() => {
    if (!es9.mixer2Enabled && mixer === 1) mixer = 0;
  });

  const cfg = $derived(es9.cfg);
  const channels = $derived(es9.visibleChannels(mixer));

  /** Mixes to display: stereo pairs collapse into one block. */
  const blocks = $derived.by(() => {
    const out: { m: number; stereo: boolean }[] = [];
    for (let i = 0; i < 8; i += 2) {
      const m = mixer * 8 + i;
      if (es9.isMixStereo(m)) out.push({ m, stereo: true });
      else out.push({ m, stereo: false }, { m: m + 1, stereo: false });
    }
    return out;
  });

  function toggleUnity(m: number, ch: number) {
    const v = cfg.vmix[m * 8 + ch];
    es9.setVmix(m, ch, v === VMIX_UNITY ? 0 : VMIX_UNITY);
  }
  const db = (v: number) => formatDb(vmixToDb(v));
</script>

<div class="page">
  <div class="page-head">
    <div>
      <h1 class="page-title">Mixer</h1>
      <p class="page-desc">
        Macro mix: controls the raw mix matrix while respecting stereo links. Double-click a fader to toggle 0 dB / off,
        hold <kbd>Shift</kbd> for fine moves.
      </p>
    </div>
    <div class="spacer"></div>
    <div class="seg">
      <button class:on={mixer === 0} onclick={() => (mixer = 0)}>Mixer 1</button>
      <button class:on={mixer === 1} disabled={!es9.mixer2Enabled} onclick={() => (mixer = 1)} title={es9.mixer2Enabled ? "" : "Enable Mixer 2 in Settings"}>
        Mixer 2
      </button>
    </div>
  </div>

  <div class="blocks">
    {#each blocks as b (b.m)}
      <section class="card block" class:stereo={b.stereo}>
        <header>
          <div class="mix-name">
            {es9.mixTitle(b.m)}
            {#if b.stereo}<span class="st"><Icon name="link" size={11} /> stereo</span>{/if}
          </div>
          <div class="mix-dest" title={es9.mixDestTitle(b.m)}>→ {es9.mixDestTitle(b.m)}</div>
        </header>
        <div class="strips">
          {#each channels as ch (ch)}
            {@const v = cfg.vmix[b.m * 8 + ch]}
            <div class="strip">
              <div class="ch-name" title={es9.channelLabel(mixer, ch, true)}>{es9.channelLabel(mixer, ch, true)}</div>
              {#if b.stereo}
                <div class="pan">
                  <Knob
                    label="Pan {es9.channelLabel(mixer, ch, true)}"
                    value={cfg.vpan[b.m * 8 + ch]}
                    onchange={(p) => es9.setVpan(b.m, ch, p)}
                  />
                  <span class="pan-val mono">{formatPan(cfg.vpan[b.m * 8 + ch])}</span>
                </div>
              {/if}
              <Fader
                label="Level {es9.channelLabel(mixer, ch, true)}"
                value={v}
                max={VMIX_MAX}
                marks={[VMIX_UNITY]}
                height={b.stereo ? 158 : 200}
                onchange={(nv) => es9.setVmix(b.m, ch, nv)}
                ondefault={() => toggleUnity(b.m, ch)}
              />
              <div class="val mono" class:hot={vmixToDb(v) > 0} class:off={v === 0}>{db(v)}</div>
            </div>
          {/each}
        </div>
      </section>
    {/each}
  </div>
</div>

<style>
  kbd {
    font-family: var(--mono);
    font-size: 11px;
    padding: 0 4px;
    border: 1px solid var(--border-2);
    border-radius: 4px;
    background: var(--panel-2);
  }
  .blocks {
    display: flex;
    flex-wrap: wrap;
    gap: 14px;
    align-items: flex-start;
  }
  .block {
    padding: 10px 10px 12px;
  }
  .block.stereo {
    border-color: rgba(251, 191, 36, 0.28);
  }
  header {
    padding: 2px 4px 10px;
    /* never let the title widen the card beyond its strips */
    width: 0;
    min-width: 100%;
  }
  .mix-name {
    font-weight: 650;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .st {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--amber);
    font-weight: 600;
  }
  .mix-dest {
    color: var(--muted);
    font-size: 12px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }
  .strips {
    display: flex;
    gap: 4px;
  }
  .strip {
    width: 52px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 8px 0 6px;
    border-radius: 8px;
    background: var(--bg-2);
    border: 1px solid #1d222d;
  }
  .ch-name {
    font-size: 10.5px;
    font-weight: 600;
    color: var(--text-2);
    width: 100%;
    text-align: center;
    padding: 0 3px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .pan {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
  }
  .pan-val {
    font-size: 10px;
    color: var(--amber);
  }
  .val {
    font-size: 11px;
    color: var(--text-2);
  }
  .val.hot {
    color: var(--amber);
  }
  .val.off {
    color: var(--faint);
  }
</style>
