<script lang="ts">
  import { tick } from "svelte";
  import { es9 } from "../store.svelte";
  import Icon from "../components/Icon.svelte";

  let listEl: HTMLDivElement;
  let follow = $state(true);
  let expanded = $state<Set<number>>(new Set());

  const fmtTime = (d: Date) =>
    d.toLocaleTimeString([], { hour12: false }) + "." + String(d.getMilliseconds()).padStart(3, "0");

  $effect(() => {
    void es9.log.length;
    void es9.log[es9.log.length - 1]?.count;
    if (follow) tick().then(() => listEl && (listEl.scrollTop = listEl.scrollHeight));
  });

  function toggle(id: number) {
    const s = new Set(expanded);
    s.has(id) ? s.delete(id) : s.add(id);
    expanded = s;
  }
  function onScroll() {
    follow = listEl.scrollTop + listEl.clientHeight >= listEl.scrollHeight - 8;
  }
</script>

<div class="page full">
  <div class="page-head">
    <div>
      <h1 class="page-title">MIDI monitor</h1>
      <p class="page-desc">SysEx traffic between this app and the ES-9. Click an entry to show its bytes.</p>
    </div>
    <div class="spacer"></div>
    <div class="btnrow">
      <button class="btn sm" disabled={!es9.connected} onclick={() => es9.requestVersion()}>Version</button>
      <button class="btn sm" disabled={!es9.connected} onclick={() => es9.requestConfig()}>Config</button>
      <button class="btn sm" disabled={!es9.connected} onclick={() => es9.requestMix()}>Mix</button>
      <button class="btn sm ghost" onclick={() => es9.clearLog()}><Icon name="trash" /> Clear</button>
    </div>
  </div>

  <div class="mon">
    <section class="card log">
      <div class="list mono" bind:this={listEl} onscroll={onScroll}>
        {#each es9.log as e (e.id)}
          <div class="entry {e.dir}" class:open={expanded.has(e.id)}>
            <button class="line" onclick={() => e.hex && toggle(e.id)}>
              <span class="t">{fmtTime(e.time)}</span>
              <span class="dir">{e.dir === "tx" ? "TX" : e.dir === "rx" ? "RX" : e.dir === "error" ? "ERR" : "•"}</span>
              <span class="txt">{e.text}</span>
              {#if e.count > 1}<span class="cnt">×{e.count}</span>{/if}
            </button>
            {#if e.hex && expanded.has(e.id)}
              <pre class="hex">{e.hex}</pre>
            {/if}
          </div>
        {:else}
          <div class="empty">No traffic yet.</div>
        {/each}
      </div>
    </section>

    <div class="side">
      <section class="card">
        <div class="card-head"><span class="dirb tx">TX</span><div class="card-title">Last sent</div></div>
        <div class="card-body"><pre class="hex big mono">{es9.lastTx || "—"}</pre></div>
      </section>
      <section class="card">
        <div class="card-head"><span class="dirb rx">RX</span><div class="card-title">Last received</div></div>
        <div class="card-body"><pre class="hex big mono">{es9.lastRx || "—"}</pre></div>
      </section>
    </div>
  </div>
</div>

<style>
  .full {
    height: 100%;
  }
  .btnrow {
    display: flex;
    gap: 6px;
  }
  .mon {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: 1fr 380px;
    gap: 16px;
  }
  .log {
    min-height: 0;
    display: flex;
    overflow: hidden;
  }
  .list {
    flex: 1;
    overflow: auto;
    padding: 6px;
    font-size: 12px;
    user-select: text;
    -webkit-user-select: text;
  }
  .entry .line {
    display: flex;
    gap: 12px;
    width: 100%;
    padding: 4px 8px;
    border: 0;
    background: transparent;
    border-radius: 5px;
    text-align: left;
    font-family: inherit;
  }
  .entry .line:hover {
    background: var(--panel-2);
  }
  .t {
    color: var(--faint);
  }
  .dir {
    width: 28px;
    font-weight: 700;
  }
  .tx .dir {
    color: var(--sky);
  }
  .rx .dir {
    color: var(--accent);
  }
  .info .dir {
    color: var(--muted);
  }
  .error .dir,
  .error .txt {
    color: var(--rose);
  }
  .txt {
    flex: 1;
    color: var(--text-2);
  }
  .cnt {
    color: var(--muted);
  }
  .hex {
    margin: 2px 8px 6px 128px;
    padding: 8px 10px;
    background: #0b0d12;
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text-2);
    white-space: pre-wrap;
    word-break: normal;
    font-size: 11px;
    user-select: text;
    -webkit-user-select: text;
  }
  .hex.big {
    margin: 0;
    max-height: 260px;
    overflow: auto;
  }
  .side {
    display: flex;
    flex-direction: column;
    gap: 16px;
    min-width: 0;
  }
  .dirb {
    font-size: 10px;
    font-weight: 700;
    padding: 2px 6px;
    border-radius: 4px;
  }
  .dirb.tx {
    color: var(--sky);
    background: rgba(56, 189, 248, 0.12);
  }
  .dirb.rx {
    color: var(--accent);
    background: var(--accent-soft);
  }
</style>
