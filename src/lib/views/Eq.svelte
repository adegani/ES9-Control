<script lang="ts">
  import { es9 } from "../store.svelte";
  import {
    EQ_Q_DEFAULT,
    EQ_RAW_MAX,
    EQ_TYPES,
    eqFreqToHz,
    eqGainToDb,
    eqQToFloat,
    formatHz,
    hzToEqFreq,
  } from "../protocol";
  import EqGraph from "../components/EqGraph.svelte";
  import HSlider from "../components/HSlider.svelte";
  import Select from "../components/Select.svelte";
  import Toggle from "../components/Toggle.svelte";

  const COLORS = ["#2dd4bf", "#fbbf24", "#a78bfa", "#fb7185"];
  const TYPE_GROUPS = [{ label: "Filter type", options: EQ_TYPES.map((t) => ({ value: t.value, label: t.label })) }];

  let mixer = $state(0);
  let ch = $state(0);
  let selected = $state(0);
  $effect(() => {
    if (!es9.mixer2Enabled && mixer === 1) mixer = 0;
  });

  const bands = $derived(es9.cfg.eq[mixer][ch]);
  const usage = $derived(es9.usage[mixer]);

  const activeCount = (m: number, c: number) => es9.cfg.eq[m][c].filter((b) => b.enabled).length;
  const fmtGain = (db: number) => `${db > 0 ? "+" : ""}${db.toFixed(1)} dB`;

  function resetBand(i: number) {
    es9.setEq(mixer, ch, i, { enabled: false, type: 6, freq: hzToEqFreq([100, 500, 2000, 8000][i]), q: EQ_Q_DEFAULT, gain: 0 });
  }
</script>

<div class="page">
  <div class="page-head">
    <div>
      <h1 class="page-title">Input EQ</h1>
      <p class="page-desc">Four filter bands on every mixer input. Drag the handles on the graph, scroll on a handle to change Q.</p>
    </div>
    <div class="spacer"></div>
    <div class="seg">
      <button class:on={mixer === 0} onclick={() => (mixer = 0)}>Mixer 1</button>
      <button class:on={mixer === 1} disabled={!es9.mixer2Enabled} onclick={() => (mixer = 1)}>Mixer 2</button>
    </div>
  </div>

  <div class="layout">
    <aside class="card channels">
      <div class="card-head">
        <div class="card-title">Channels</div>
        <div class="spacer"></div>
        <div class="usage" title="DSP usage">
          <span class="label">DSP</span>
          <span class="bar"><span style:width="{Math.min(100, usage ?? 0)}%" class:warn={(usage ?? 0) > 85}></span></span>
          <span class="mono pct">{usage === null ? "—" : `${usage.toFixed(1)}%`}</span>
        </div>
      </div>
      <div class="list">
        {#each Array(8) as _, c (c)}
          <button class="chan" class:on={c === ch} onclick={() => (ch = c)}>
            <span class="num">{c + 1}</span>
            <span class="nm">{es9.channelLabel(mixer, c)}</span>
            <span class="dots">
              {#each es9.cfg.eq[mixer][c] as b, i (i)}
                <span class="d" style:background={b.enabled ? COLORS[i] : undefined}></span>
              {/each}
            </span>
          </button>
        {/each}
      </div>
    </aside>

    <div class="main">
      <section class="card">
        <div class="card-head">
          <div class="card-title">Ch {ch + 1} · {es9.channelLabel(mixer, ch)}</div>
          <div class="card-sub">{activeCount(mixer, ch)} of 4 bands active · approximate response</div>
        </div>
        <div class="card-body">
          <EqGraph
            {bands}
            colors={COLORS}
            {selected}
            onselect={(i) => (selected = i)}
            onchange={(i, p) => es9.setEq(mixer, ch, i, p)}
          />
        </div>
      </section>

      <div class="bands">
        {#each bands as b, i (i)}
          {@const t = EQ_TYPES[b.type] ?? EQ_TYPES[6]}
          <section
            class="card band"
            role="group"
            aria-label="Band {i + 1}"
            class:sel={i === selected}
            class:off={!b.enabled}
            style:--c={COLORS[i]}
            onpointerdown={() => (selected = i)}
          >
            <div class="band-head">
              <span class="chip">{i + 1}</span>
              <span class="band-title">Band {i + 1}</span>
              <div class="spacer"></div>
              <button class="btn ghost sm" onclick={() => resetBand(i)} title="Reset band">Reset</button>
              <Toggle label="Enable band {i + 1}" checked={b.enabled} onchange={(v) => es9.setEq(mixer, ch, i, { enabled: v })} />
            </div>
            <div class="params">
              <Select label="Band {i + 1} type" value={b.type} groups={TYPE_GROUPS} compact onchange={(v) => es9.setEq(mixer, ch, i, { type: v })} />
              <div class="param">
                <span class="label">Freq</span>
                <HSlider
                  label="Band {i + 1} frequency"
                  value={b.freq}
                  min={0}
                  max={EQ_RAW_MAX}
                  accent={COLORS[i]}
                  text={formatHz(eqFreqToHz(b.freq))}
                  defaultValue={hzToEqFreq(1000)}
                  onchange={(v) => es9.setEq(mixer, ch, i, { freq: v })}
                />
              </div>
              <div class="param">
                <span class="label">Q</span>
                <HSlider
                  label="Band {i + 1} Q"
                  value={b.q}
                  min={0}
                  max={EQ_RAW_MAX}
                  accent={COLORS[i]}
                  disabled={!t.hasQ}
                  text={eqQToFloat(b.q).toFixed(3)}
                  defaultValue={EQ_Q_DEFAULT}
                  onchange={(v) => es9.setEq(mixer, ch, i, { q: v })}
                />
              </div>
              <div class="param">
                <span class="label">Gain</span>
                <HSlider
                  label="Band {i + 1} gain"
                  value={b.gain}
                  min={-EQ_RAW_MAX}
                  max={EQ_RAW_MAX}
                  accent={COLORS[i]}
                  disabled={!t.hasGain}
                  text={fmtGain(eqGainToDb(b.type, b.gain))}
                  defaultValue={0}
                  onchange={(v) => es9.setEq(mixer, ch, i, { gain: v })}
                />
              </div>
            </div>
          </section>
        {/each}
      </div>
    </div>
  </div>
</div>

<style>
  .layout {
    display: grid;
    grid-template-columns: 230px 1fr;
    gap: 16px;
    align-items: start;
  }
  .main {
    display: flex;
    flex-direction: column;
    gap: 16px;
    min-width: 0;
  }
  .channels .list {
    display: flex;
    flex-direction: column;
    padding: 0 8px 8px;
    gap: 2px;
  }
  .chan {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 36px;
    padding: 0 10px;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    text-align: left;
  }
  .chan:hover {
    background: var(--panel-2);
  }
  .chan.on {
    background: var(--panel-3);
    border-color: var(--border-2);
  }
  .num {
    width: 16px;
    color: var(--faint);
    font-weight: 600;
    font-size: 11px;
  }
  .nm {
    flex: 1;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .dots {
    display: flex;
    gap: 3px;
  }
  .d {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #2a3040;
  }
  .usage {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .bar {
    width: 46px;
    height: 5px;
    border-radius: 4px;
    background: #0b0d12;
    overflow: hidden;
  }
  .bar span {
    display: block;
    height: 100%;
    background: var(--accent);
    transition: width 0.3s;
  }
  .bar span.warn {
    background: var(--rose);
  }
  .pct {
    font-size: 11px;
    color: var(--text-2);
    min-width: 38px;
    text-align: right;
  }
  .bands {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 12px;
  }
  @media (max-width: 1250px) {
    .bands {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  .band {
    padding: 10px 12px 12px;
    border-top: 2px solid var(--c);
    transition: border-color 0.12s;
  }
  .band.sel {
    border-color: var(--c);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--c) 35%, transparent);
  }
  .band.off .params {
    opacity: 0.55;
  }
  .band-head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
  }
  .chip {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--c);
    color: #0b0d12;
    font-size: 10px;
    font-weight: 800;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .band-title {
    font-weight: 600;
  }
  .params {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .param {
    display: grid;
    grid-template-columns: 40px 1fr;
    align-items: center;
    gap: 6px;
  }
</style>
