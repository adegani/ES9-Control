<script lang="ts">
  /**
   * Compact horizontal slider with inline value text. Click/drag sets the
   * value absolutely; hold Shift for fine relative adjustment. Bipolar
   * (filled from the centre) when min < 0 < max.
   */
  interface Props {
    value: number;
    min: number;
    max: number;
    text?: string;
    defaultValue?: number;
    disabled?: boolean;
    accent?: string;
    height?: number;
    label?: string;
    onchange: (v: number) => void;
    ondefault?: () => void;
  }
  let {
    value,
    min,
    max,
    text = "",
    defaultValue,
    disabled = false,
    accent = "var(--accent)",
    height = 24,
    label = "Slider",
    onchange,
    ondefault,
  }: Props = $props();

  const bipolar = $derived(min < 0 && max > 0);
  const norm = $derived(Math.max(0, Math.min(1, (value - min) / (max - min))));
  const zero = $derived(bipolar ? (0 - min) / (max - min) : 0);
  const left = $derived(Math.min(norm, zero));
  const width = $derived(Math.abs(norm - zero));

  let el: HTMLDivElement;
  let dragging = $state(false);
  let lastX = 0;
  let acc = 0;

  function set(v: number) {
    const r = Math.round(Math.max(min, Math.min(max, v)));
    if (r !== value) onchange(r);
  }
  function fromX(x: number) {
    const rect = el.getBoundingClientRect();
    return min + ((x - rect.left) / rect.width) * (max - min);
  }
  function down(e: PointerEvent) {
    if (disabled || e.button !== 0) return;
    el.setPointerCapture(e.pointerId);
    el.focus();
    dragging = true;
    lastX = e.clientX;
    acc = e.shiftKey ? value : fromX(e.clientX);
    set(acc);
  }
  function move(e: PointerEvent) {
    if (!dragging) return;
    if (e.shiftKey) {
      const w = el.getBoundingClientRect().width;
      acc += ((e.clientX - lastX) / w) * (max - min) * 0.1;
    } else {
      acc = fromX(e.clientX);
    }
    lastX = e.clientX;
    set(acc);
  }
  function wheel(e: WheelEvent) {
    if (disabled) return;
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : -e.deltaY;
    if (d === 0) return;
    e.preventDefault();
    const step = ((max - min) / 200) * (e.shiftKey ? 0.2 : 1);
    set(value + Math.sign(d) * Math.max(1, step));
  }
  function key(e: KeyboardEvent) {
    const step = Math.max(1, (max - min) / 100) * (e.shiftKey ? 0.1 : 1);
    if (e.key === "ArrowRight" || e.key === "ArrowUp") set(value + Math.max(1, step));
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") set(value - Math.max(1, step));
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
  bind:this={el}
  class="hs"
  class:disabled
  class:dragging
  style:height="{height}px"
  style:--accent-c={accent}
  role="slider"
  tabindex={disabled ? -1 : 0}
  aria-label={label}
  aria-valuemin={min}
  aria-valuemax={max}
  aria-valuenow={value}
  aria-disabled={disabled}
  onpointerdown={down}
  onpointermove={move}
  onpointerup={() => (dragging = false)}
  onpointercancel={() => (dragging = false)}
  ondblclick={dbl}
  onwheel={wheel}
  onkeydown={key}
>
  <div class="fill" style:left="{left * 100}%" style:width="{width * 100}%"></div>
  {#if bipolar}<div class="zero" style:left="{zero * 100}%"></div>{/if}
  <div class="cursor" style:left="{norm * 100}%"></div>
  {#if text}<span class="txt"><span class="mono">{text}</span></span>{/if}
</div>

<style>
  .hs {
    position: relative;
    width: 100%;
    min-width: 60px;
    border-radius: 6px;
    background: #0b0d12;
    border: 1px solid #222837;
    overflow: hidden;
    touch-action: none;
    outline: none;
    cursor: ew-resize;
  }
  .hs:hover {
    border-color: #343c50;
  }
  .hs:focus-visible {
    border-color: var(--accent-c);
  }
  .fill {
    position: absolute;
    top: 0;
    bottom: 0;
    background: var(--accent-c);
    opacity: 0.28;
  }
  .zero {
    position: absolute;
    top: 3px;
    bottom: 3px;
    width: 1px;
    background: #3a4255;
  }
  .cursor {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    margin-left: -1px;
    background: var(--accent-c);
  }
  .txt {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    color: var(--text);
    pointer-events: none;
  }
  .txt span {
    padding: 0 5px;
    border-radius: 4px;
    background: rgba(11, 13, 18, 0.85);
    line-height: 16px;
  }
  .disabled {
    opacity: 0.3;
    cursor: default;
  }
</style>
