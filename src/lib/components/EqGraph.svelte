<script lang="ts">
  /**
   * Frequency response display with draggable band handles:
   * drag = frequency (+ gain for shelf/peak), wheel = Q.
   */
  import { bandDb, bandParams, responseDb } from "../eqmath";
  import { EQ_GAIN_MAX_DB, EQ_RAW_MAX, EQ_TYPES, hzToEqFreq, type EqBand } from "../protocol";

  interface Props {
    bands: EqBand[];
    colors: string[];
    selected: number;
    onselect: (i: number) => void;
    onchange: (i: number, patch: Partial<EqBand>) => void;
  }
  let { bands, colors, selected, onselect, onchange }: Props = $props();

  const F_MIN = 20;
  const F_MAX = 20000;
  const DB_MAX = 18;
  const DB_MIN = -24;
  const H = 240;
  const PAD_L = 34;
  const PAD_B = 18;

  let width = $state(800);
  const plotW = $derived(Math.max(100, width - PAD_L - 8));
  const plotH = H - PAD_B - 8;

  const xOf = (f: number) => PAD_L + (Math.log(f / F_MIN) / Math.log(F_MAX / F_MIN)) * plotW;
  const fOf = (x: number) => F_MIN * Math.pow(F_MAX / F_MIN, (x - PAD_L) / plotW);
  const yOf = (db: number) => 8 + ((DB_MAX - Math.max(DB_MIN, Math.min(DB_MAX, db))) / (DB_MAX - DB_MIN)) * plotH;
  const dbOf = (y: number) => DB_MAX - ((y - 8) / plotH) * (DB_MAX - DB_MIN);

  const N = 220;
  const freqs = $derived(Array.from({ length: N }, (_, i) => F_MIN * Math.pow(F_MAX / F_MIN, i / (N - 1))));

  function pathFor(fn: (f: number) => number) {
    let d = "";
    for (let i = 0; i < freqs.length; i++) {
      const f = freqs[i];
      d += `${i ? "L" : "M"}${xOf(f).toFixed(1)} ${yOf(fn(f)).toFixed(1)}`;
    }
    return d;
  }

  const total = $derived(pathFor((f) => responseDb(bands, f)));
  const totalFill = $derived(`${total} L${xOf(F_MAX)} ${yOf(0)} L${xOf(F_MIN)} ${yOf(0)} Z`);
  const perBand = $derived(
    bands.map((b) => {
      if (!b.enabled) return "";
      const p = bandParams(b);
      return pathFor((f) => bandDb(b.type, f, p.fc, p.q, p.gain));
    }),
  );
  const handles = $derived(
    bands.map((b) => {
      const p = bandParams(b);
      const hasGain = EQ_TYPES[b.type]?.hasGain;
      return { x: xOf(Math.max(F_MIN, Math.min(F_MAX, p.fc))), y: yOf(hasGain ? p.gain : 0), hasGain };
    }),
  );

  const gridF = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
  const gridDb = [18, 12, 6, 0, -6, -12, -18, -24];
  const fmtF = (f: number) => (f >= 1000 ? `${f / 1000}k` : `${f}`);

  let svg: SVGSVGElement;
  let drag: number | null = null;

  function down(e: PointerEvent, i: number) {
    e.stopPropagation();
    onselect(i);
    if (!bands[i].enabled) onchange(i, { enabled: true });
    drag = i;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  }
  function move(e: PointerEvent) {
    if (drag === null) return;
    const r = svg.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const freq = Math.max(0, Math.min(EQ_RAW_MAX, hzToEqFreq(Math.max(10, fOf(x)))));
    const patch: Partial<EqBand> = { freq };
    if (handles[drag].hasGain) {
      const db = Math.max(-EQ_GAIN_MAX_DB, Math.min(EQ_GAIN_MAX_DB, dbOf(y)));
      patch.gain = Math.round((db / EQ_GAIN_MAX_DB) * EQ_RAW_MAX);
    }
    onchange(drag, patch);
  }
  function wheel(e: WheelEvent, i: number) {
    if (!EQ_TYPES[bands[i].type]?.hasQ) return;
    e.preventDefault();
    const q = Math.max(0, Math.min(EQ_RAW_MAX, bands[i].q + (e.deltaY < 0 ? 400 : -400)));
    onchange(i, { q });
  }
</script>

<div class="graph" bind:clientWidth={width}>
  <svg bind:this={svg} {width} height={H} onpointermove={move} onpointerup={() => (drag = null)} role="img" aria-label="EQ response">
    {#each gridF as f (f)}
      <line x1={xOf(f)} x2={xOf(f)} y1={8} y2={8 + plotH} class="grid" />
      <text x={xOf(f)} y={H - 4} class="axis" text-anchor="middle">{fmtF(f)}</text>
    {/each}
    {#each gridDb as d (d)}
      <line x1={PAD_L} x2={PAD_L + plotW} y1={yOf(d)} y2={yOf(d)} class="grid" class:zero={d === 0} />
      <text x={PAD_L - 6} y={yOf(d) + 3.5} class="axis" text-anchor="end">{d > 0 ? `+${d}` : d}</text>
    {/each}

    {#each perBand as p, i (i)}
      {#if p}<path d={p} stroke={colors[i]} class="band" class:sel={i === selected} />{/if}
    {/each}
    <path d={totalFill} class="total-fill" />
    <path d={total} class="total" />

    {#each handles as h, i (i)}
      <g
        class="handle"
        class:off={!bands[i].enabled}
        class:sel={i === selected}
        transform="translate({h.x} {h.y})"
        onpointerdown={(e) => down(e, i)}
        onwheel={(e) => wheel(e, i)}
        role="button"
        tabindex="-1"
        aria-label="Band {i + 1}"
      >
        <circle r="11" fill={colors[i]} opacity="0.18" />
        <circle r="7" fill={bands[i].enabled ? colors[i] : "#2a3040"} stroke={colors[i]} stroke-width="1.5" />
        <text y="3.5" text-anchor="middle" class="hn">{i + 1}</text>
      </g>
    {/each}
  </svg>
</div>

<style>
  .graph {
    width: 100%;
    background: #0b0d12;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  svg {
    display: block;
    touch-action: none;
  }
  .grid {
    stroke: #1a1f2a;
    stroke-width: 1;
  }
  .grid.zero {
    stroke: #2c3344;
  }
  .axis {
    fill: var(--faint);
    font-size: 10px;
    font-family: var(--mono);
  }
  .band {
    fill: none;
    stroke-width: 1.2;
    opacity: 0.4;
  }
  .band.sel {
    opacity: 0.8;
  }
  .total {
    fill: none;
    stroke: #e7e9ef;
    stroke-width: 2;
  }
  .total-fill {
    fill: rgba(45, 212, 191, 0.08);
  }
  .handle {
    cursor: grab;
    outline: none;
  }
  .handle.off {
    opacity: 0.55;
  }
  .handle.sel circle:nth-child(2) {
    stroke: #fff;
    stroke-width: 2;
  }
  .hn {
    font-size: 9.5px;
    font-weight: 700;
    fill: #0b0d12;
    pointer-events: none;
  }
  .handle.off .hn {
    fill: #c9cedb;
  }
</style>
