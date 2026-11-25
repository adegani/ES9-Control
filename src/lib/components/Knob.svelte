<script lang="ts">
  /** Rotary knob (vertical drag). Bipolar when min < 0 < max. */
  interface Props {
    value: number;
    min?: number;
    max?: number;
    defaultValue?: number;
    size?: number;
    accent?: string;
    label?: string;
    onchange: (v: number) => void;
  }
  let {
    value,
    min = -63,
    max = 63,
    defaultValue = 0,
    size = 30,
    accent = "var(--amber)",
    label = "Knob",
    onchange,
  }: Props = $props();

  const START = -135;
  const SWEEP = 270;
  const norm = $derived((value - min) / (max - min));
  const angle = $derived(START + norm * SWEEP);
  const origin = $derived(min < 0 && max > 0 ? (0 - min) / (max - min) : 0);

  const r = $derived(size / 2 - 3);
  const c = $derived(size / 2);

  function polar(a: number) {
    const rad = ((a - 90) * Math.PI) / 180;
    return [c + r * Math.cos(rad), c + r * Math.sin(rad)];
  }
  function arc(a0: number, a1: number) {
    if (Math.abs(a1 - a0) < 0.01) return "";
    const [x0, y0] = polar(Math.min(a0, a1));
    const [x1, y1] = polar(Math.max(a0, a1));
    const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
    return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
  }

  let dragging = false;
  let lastY = 0;
  let acc = 0;
  function set(v: number) {
    const rv = Math.round(Math.max(min, Math.min(max, v)));
    if (rv !== value) onchange(rv);
  }
  function down(e: PointerEvent) {
    if (e.button !== 0) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    dragging = true;
    lastY = e.clientY;
    acc = value;
  }
  function move(e: PointerEvent) {
    if (!dragging) return;
    acc += ((lastY - e.clientY) / 160) * (max - min) * (e.shiftKey ? 0.15 : 1);
    acc = Math.max(min, Math.min(max, acc));
    lastY = e.clientY;
    set(acc);
  }
  function wheel(e: WheelEvent) {
    e.preventDefault();
    set(value + (e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 1 : 3));
  }
  function key(e: KeyboardEvent) {
    const s = e.shiftKey ? 10 : 1;
    if (e.key === "ArrowUp" || e.key === "ArrowRight") set(value + s);
    else if (e.key === "ArrowDown" || e.key === "ArrowLeft") set(value - s);
    else return;
    e.preventDefault();
  }
</script>

<svg
  width={size}
  height={size}
  class="knob"
  role="slider"
  tabindex="0"
  aria-label={label}
  aria-valuemin={min}
  aria-valuemax={max}
  aria-valuenow={value}
  onpointerdown={down}
  onpointermove={move}
  onpointerup={() => (dragging = false)}
  onpointercancel={() => (dragging = false)}
  ondblclick={() => set(defaultValue)}
  onwheel={wheel}
  onkeydown={key}
>
  <path d={arc(START, START + SWEEP)} stroke="#0a0c10" stroke-width="3.5" fill="none" stroke-linecap="round" />
  <path d={arc(START + origin * SWEEP, angle)} stroke={accent} stroke-width="3.5" fill="none" stroke-linecap="round" />
  <circle cx={c} cy={c} r={r - 4.5} fill="#262c3a" stroke="#3c455a" />
  <line
    x1={c}
    y1={c}
    x2={c}
    y2={c - r + 6}
    stroke="#e7e9ef"
    stroke-width="2"
    stroke-linecap="round"
    transform="rotate({angle} {c} {c})"
  />
</svg>

<style>
  .knob {
    display: block;
    touch-action: none;
    outline: none;
    border-radius: 50%;
  }
  .knob:focus-visible {
    box-shadow: 0 0 0 2px rgba(251, 191, 36, 0.4);
  }
</style>
