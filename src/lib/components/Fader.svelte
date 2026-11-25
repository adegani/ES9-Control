<script lang="ts">
  /**
   * Vertical fader. Relative drag (no jumps), Shift = fine, wheel, arrow keys,
   * double-click = default value.
   */
  interface Props {
    value: number;
    min?: number;
    max?: number;
    defaultValue?: number;
    height?: number;
    /** value positions to draw tick marks at (e.g. unity) */
    marks?: number[];
    disabled?: boolean;
    accent?: string;
    onchange: (v: number) => void;
    ondefault?: () => void;
    label?: string;
  }
  let {
    value,
    min = 0,
    max = 127,
    defaultValue,
    height = 170,
    marks = [],
    disabled = false,
    accent = "var(--accent)",
    onchange,
    ondefault,
    label = "Fader",
  }: Props = $props();

  const THUMB = 26;
  const travel = $derived(height - THUMB);
  const norm = $derived(Math.max(0, Math.min(1, (value - min) / (max - min))));
  const thumbY = $derived((1 - norm) * travel);

  let dragging = $state(false);
  let lastY = 0;
  let acc = 0;

  function set(v: number) {
    const r = Math.round(Math.max(min, Math.min(max, v)));
    if (r !== value) onchange(r);
  }

  function down(e: PointerEvent) {
    if (disabled || e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    (e.currentTarget as HTMLElement).focus();
    dragging = true;
    lastY = e.clientY;
    acc = value;
    // Clicking on the track (not the thumb) jumps there.
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = e.clientY - rect.top;
    if (y < thumbY || y > thumbY + THUMB) {
      acc = min + (1 - (y - THUMB / 2) / travel) * (max - min);
      set(acc);
    }
  }
  function move(e: PointerEvent) {
    if (!dragging) return;
    const fine = e.shiftKey ? 0.12 : 1;
    acc += ((lastY - e.clientY) / travel) * (max - min) * fine;
    acc = Math.max(min, Math.min(max, acc));
    lastY = e.clientY;
    set(acc);
  }
  function up() {
    dragging = false;
  }
  function wheel(e: WheelEvent) {
    if (disabled) return;
    e.preventDefault();
    const step = Math.max(1, Math.round((max - min) / 127));
    set(value + (e.deltaY < 0 ? step : -step) * (e.shiftKey ? 1 : 2));
  }
  function key(e: KeyboardEvent) {
    const step = Math.max(1, Math.round((max - min) / 127)) * (e.shiftKey ? 10 : 1);
    if (e.key === "ArrowUp" || e.key === "ArrowRight") set(value + step);
    else if (e.key === "ArrowDown" || e.key === "ArrowLeft") set(value - step);
    else if (e.key === "Home") set(max);
    else if (e.key === "End") set(min);
    else return;
    e.preventDefault();
  }
  function dbl() {
    if (disabled) return;
    if (ondefault) ondefault();
    else if (defaultValue !== undefined) set(defaultValue);
  }
</script>

<div
  class="fader"
  class:dragging
  class:disabled
  style:height="{height}px"
  style:--accent-c={accent}
  role="slider"
  tabindex={disabled ? -1 : 0}
  aria-label={label}
  aria-valuemin={min}
  aria-valuemax={max}
  aria-valuenow={value}
  onpointerdown={down}
  onpointermove={move}
  onpointerup={up}
  onpointercancel={up}
  ondblclick={dbl}
  onwheel={wheel}
  onkeydown={key}
>
  <div class="track"></div>
  <div class="fill" style:height="{norm * travel}px" style:bottom="{THUMB / 2}px"></div>
  {#each marks as m (m)}
    <div class="mark" style:top="{(1 - (m - min) / (max - min)) * travel + THUMB / 2}px"></div>
  {/each}
  <div class="thumb" style:transform="translateY({thumbY}px)"><span></span></div>
</div>

<style>
  .fader {
    position: relative;
    width: 30px;
    flex: none;
    touch-action: none;
    outline: none;
    border-radius: 6px;
  }
  .fader:focus-visible {
    box-shadow: 0 0 0 2px rgba(45, 212, 191, 0.35);
  }
  .track {
    position: absolute;
    left: 50%;
    top: 13px;
    bottom: 13px;
    width: 4px;
    margin-left: -2px;
    border-radius: 4px;
    background: #0a0c10;
    box-shadow: inset 0 0 0 1px #1f2430;
  }
  .fill {
    position: absolute;
    left: 50%;
    width: 4px;
    margin-left: -2px;
    border-radius: 4px;
    background: var(--accent-c);
    opacity: 0.9;
  }
  .mark {
    position: absolute;
    left: 3px;
    right: 3px;
    height: 1px;
    background: #4a5368;
    pointer-events: none;
  }
  .thumb {
    position: absolute;
    left: 2px;
    right: 2px;
    top: 0;
    height: 26px;
    border-radius: 5px;
    background: linear-gradient(#3b4356, #282e3c);
    border: 1px solid #4b556b;
    box-shadow:
      0 2px 6px rgba(0, 0, 0, 0.5),
      inset 0 1px 0 rgba(255, 255, 255, 0.08);
    display: flex;
    align-items: center;
    justify-content: center;
    will-change: transform;
  }
  .thumb span {
    width: 16px;
    height: 2px;
    border-radius: 2px;
    background: var(--accent-c);
  }
  .fader:hover .thumb,
  .dragging .thumb {
    border-color: #6b7590;
  }
  .disabled {
    opacity: 0.35;
  }
</style>
