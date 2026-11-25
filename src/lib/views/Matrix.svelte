<script lang="ts">
  import { es9 } from "../store.svelte";
  import { formatRawMix, RAW_MIX_MAX, RAW_MIX_UNITY } from "../protocol";
  import HSlider from "../components/HSlider.svelte";

  const cfg = $derived(es9.cfg);
  const mixers = $derived(es9.mixer2Enabled ? [0, 1] : [0]);

  function toggle(m: number, ch: number) {
    es9.setRawMix(m, ch, cfg.mix[m][ch] === RAW_MIX_UNITY ? 0 : RAW_MIX_UNITY);
  }
</script>

<div class="page">
  <div class="page-head">
    <div>
      <h1 class="page-title">Raw mix matrix</h1>
      <p class="page-desc">The actual gain matrix running on the hardware (−∞ … +12 dB). Double-click a cell to toggle 0 dB / off.</p>
    </div>
  </div>

  {#each mixers as mixer (mixer)}
    <section class="card">
      <div class="card-head">
        <div class="card-title">Mixer {mixer + 1}</div>
        <div class="card-sub">rows: mixes · columns: input channels</div>
      </div>
      <div class="card-body">
        <div class="matrix">
          <div class="corner"></div>
          {#each Array(8) as _, ch (ch)}
            <div class="colh" title={es9.channelLabel(mixer, ch)}>
              <span class="n">{ch + 1}</span>
              <span class="src">{es9.channelLabel(mixer, ch)}</span>
            </div>
          {/each}
          {#each Array(8) as _, i (i)}
            {@const m = mixer * 8 + i}
            <div class="rowh">
              <span class="mixn">Mix {m + 1}</span>
              <span class="dest">{es9.mixDest(m)}</span>
            </div>
            {#each Array(8) as _, ch (ch)}
              {@const v = cfg.mix[m][ch]}
              <div class="cell" class:active={v > 0}>
                <HSlider
                  label="Mix {m + 1} channel {ch + 1}"
                  value={v}
                  min={0}
                  max={RAW_MIX_MAX}
                  text={v > 0 ? formatRawMix(v) : "−∞"}
                  height={26}
                  accent={v > RAW_MIX_UNITY ? "var(--amber)" : "var(--accent)"}
                  onchange={(nv) => es9.setRawMix(m, ch, nv)}
                  ondefault={() => toggle(m, ch)}
                />
              </div>
            {/each}
          {/each}
        </div>
      </div>
    </section>
  {/each}
</div>

<style>
  .matrix {
    display: grid;
    grid-template-columns: 150px repeat(8, minmax(70px, 1fr));
    gap: 5px;
    align-items: center;
  }
  .colh {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding-bottom: 4px;
    min-width: 0;
  }
  .colh .n {
    font-size: 10px;
    color: var(--faint);
    font-weight: 600;
  }
  .colh .src {
    font-size: 11.5px;
    font-weight: 600;
    color: var(--text-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }
  .rowh {
    display: flex;
    flex-direction: column;
    min-width: 0;
    padding-right: 6px;
  }
  .mixn {
    font-weight: 600;
    font-size: 12px;
  }
  .dest {
    font-size: 11px;
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .cell :global(.hs) {
    opacity: 0.75;
  }
  .cell.active :global(.hs) {
    opacity: 1;
  }
</style>
