<script lang="ts">
  interface Props {
    checked: boolean;
    onchange: (v: boolean) => void;
    label?: string;
    disabled?: boolean;
  }
  let { checked, onchange, label = "", disabled = false }: Props = $props();
</script>

<button
  class="tg"
  class:on={checked}
  role="switch"
  aria-checked={checked}
  aria-label={label}
  {disabled}
  onclick={() => onchange(!checked)}
>
  <span class="knob"></span>
</button>

<style>
  .tg {
    position: relative;
    width: 32px;
    height: 18px;
    border-radius: 999px;
    border: 1px solid var(--border-2);
    background: #0b0d12;
    padding: 0;
    flex: none;
    transition: all 0.15s;
  }
  .tg.on {
    background: var(--accent-2);
    border-color: var(--accent);
  }
  .knob {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: #9aa2b4;
    transition: transform 0.15s;
  }
  .on .knob {
    transform: translateX(14px);
    background: #fff;
  }
  .tg:disabled {
    opacity: 0.4;
  }
</style>
