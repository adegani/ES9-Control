<script lang="ts">
  import type { OptionGroup } from "../protocol";

  interface Props {
    value: number;
    groups: OptionGroup[];
    onchange: (v: number) => void;
    highlight?: boolean;
    label?: string;
    compact?: boolean;
  }
  let { value, groups, onchange, highlight = false, label = "Select", compact = false }: Props = $props();
</script>

<div class="sel" class:highlight class:compact>
  <select aria-label={label} {value} onchange={(e) => onchange(Number((e.currentTarget as HTMLSelectElement).value))}>
    {#each groups as g (g.label)}
      <optgroup label={g.label}>
        {#each g.options as o (o.value)}
          <option value={o.value}>{o.label}</option>
        {/each}
      </optgroup>
    {/each}
  </select>
  <svg viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.4" /></svg>
</div>

<style>
  .sel {
    position: relative;
    width: 100%;
  }
  select {
    appearance: none;
    -webkit-appearance: none;
    width: 100%;
    height: 30px;
    padding: 0 24px 0 9px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-2);
    background: var(--panel-2);
    color: var(--text);
    font-size: 12px;
    font-weight: 500;
    outline: none;
    text-overflow: ellipsis;
    transition:
      border-color 0.12s,
      background 0.12s;
  }
  .compact select {
    height: 26px;
  }
  select:hover {
    background: var(--panel-3);
  }
  select:focus-visible {
    border-color: var(--accent);
  }
  .highlight select {
    border-color: rgba(45, 212, 191, 0.5);
    background: linear-gradient(rgba(45, 212, 191, 0.08), rgba(45, 212, 191, 0.03)), var(--panel-2);
  }
  svg {
    position: absolute;
    right: 9px;
    top: 50%;
    width: 9px;
    height: 6px;
    margin-top: -3px;
    color: var(--muted);
    pointer-events: none;
  }
</style>
