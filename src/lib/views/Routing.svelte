<script lang="ts">
  import { es9 } from "../store.svelte";
  import { CAPTURE_GROUPS, linkGroups, OUTPUT_GROUPS } from "../protocol";
  import Select from "../components/Select.svelte";
  import Icon from "../components/Icon.svelte";
  import PatchBay from "../components/PatchBay.svelte";

  type Mode = "patch" | "lists";
  let mode = $state<Mode>(localStorage.getItem("es9.routingMode") === "lists" ? "lists" : "patch");
  $effect(() => localStorage.setItem("es9.routingMode", mode));

  const cfg = $derived(es9.cfg);

  interface Slot {
    dsp: number;
    ch: number;
    label: string;
  }
  const usbSlots = (base: string): Slot[] =>
    Array.from({ length: 16 }, (_, i) => ({ dsp: i >> 3, ch: i & 7, label: `${base} ${i + 1}` }));
  const mixerSlots = (dsp: number, n: number, base: string): Slot[] =>
    Array.from({ length: n }, (_, i) => ({ dsp, ch: i, label: `${base} ${i + 1}` }));

  const mixer2 = $derived(es9.mixer2Enabled);
  const dsp3In = $derived(mixer2 ? mixerSlots(3, 8, "Ch") : [{ dsp: 3, ch: 0, label: "S/PDIF L" }, { dsp: 3, ch: 1, label: "S/PDIF R" }]);
  const dsp3Out = $derived(mixer2 ? mixerSlots(3, 8, "Mix").map((s, i) => ({ ...s, label: `Mix ${i + 9}` })) : [{ dsp: 3, ch: 0, label: "S/PDIF L" }, { dsp: 3, ch: 1, label: "S/PDIF R" }]);

  function linkedCapture(s: Slot) {
    return es9.isCaptureLinked(cfg.capture[s.dsp][s.ch]);
  }
</script>

{#snippet captureGrid(slots: Slot[], cols = 8)}
  <div class="grid" style:--cols={cols}>
    {#each slots as s (s.dsp * 8 + s.ch)}
      <div class="slot" class:linked={linkedCapture(s)} class:pair-start={(s.ch & 1) === 0}>
        <div class="slot-label">
          <span>{s.label}</span>
          {#if linkedCapture(s) && (s.ch & 1) === 0}<span class="lk" title="Stereo linked"><Icon name="link" size={12} /></span>{/if}
        </div>
        <Select
          label="{s.label} source"
          value={cfg.capture[s.dsp][s.ch]}
          groups={CAPTURE_GROUPS}
          highlight={linkedCapture(s)}
          onchange={(v) => es9.setCapture(s.dsp, s.ch, v)}
        />
      </div>
    {/each}
  </div>
{/snippet}

{#snippet outputGrid(slots: Slot[], cols = 8)}
  <div class="grid" style:--cols={cols}>
    {#each slots as s (s.dsp * 8 + s.ch)}
      <div class="slot">
        <div class="slot-label"><span>{s.label}</span></div>
        <Select
          label="{s.label} destination"
          value={cfg.outputs[s.dsp][s.ch]}
          groups={OUTPUT_GROUPS}
          onchange={(v) => es9.setOutput(s.dsp, s.ch, v)}
        />
      </div>
    {/each}
  </div>
{/snippet}

<div class="page">
  <div class="page-head">
    <div>
      <h1 class="page-title">Routing</h1>
      <p class="page-desc">Choose the sources feeding each DSP block and where its outputs go. Stereo-linked sources set both channels of a pair.</p>
    </div>
    <div class="spacer"></div>
    <div class="seg">
      <button class:on={mode === "patch"} onclick={() => (mode = "patch")}>Patch bay</button>
      <button class:on={mode === "lists"} onclick={() => (mode = "lists")}>Lists</button>
    </div>
  </div>

  {#if mode === "patch"}
  <section class="card">
    <div class="card-body patch">
      <PatchBay />
    </div>
  </section>
  {:else}

  <section class="card">
    <div class="card-head">
      <span class="badge usb">USB</span>
      <div class="card-title">USB Audio</div>
      <div class="card-sub">16 channels to and from the computer</div>
    </div>
    <div class="card-body flow">
      <div class="row-title"><span class="arrow">→</span> To computer: <b>source</b> for each USB input</div>
      {@render captureGrid(usbSlots("USB In"))}
      <div class="row-title"><span class="arrow">←</span> From computer: <b>destination</b> of each USB output</div>
      {@render outputGrid(usbSlots("USB Out"))}
    </div>
  </section>

  <div class="two">
    <section class="card">
      <div class="card-head">
        <span class="badge mix">MIX 1</span>
        <div class="card-title">Mixer 1</div>
        <div class="card-sub">8 inputs → 8 mixes</div>
      </div>
      <div class="card-body flow">
        <div class="row-title"><span class="arrow">↓</span> Input channel sources</div>
        {@render captureGrid(mixerSlots(2, 8, "Ch"), 4)}
        <div class="row-title"><span class="arrow">↓</span> Mix destinations</div>
        {@render outputGrid(mixerSlots(2, 8, "Mix"), 4)}
      </div>
    </section>

    <section class="card">
      <div class="card-head">
        <span class="badge {mixer2 ? 'mix' : 'spdif'}">{mixer2 ? "MIX 2" : "S/PDIF"}</span>
        <div class="card-title">{mixer2 ? "Mixer 2" : "S/PDIF ports"}</div>
        <div class="card-sub">
          {mixer2 ? "8 inputs → 8 mixes" : "Switch to Mixer 2 in Settings to use this DSP as a second mixer"}
        </div>
      </div>
      <div class="card-body flow">
        <div class="row-title"><span class="arrow">↓</span> {mixer2 ? "Input channel sources" : "Sources sent to S/PDIF out"}</div>
        {@render captureGrid(dsp3In, 4)}
        <div class="row-title"><span class="arrow">↓</span> {mixer2 ? "Mix destinations" : "Destinations of S/PDIF in"}</div>
        {@render outputGrid(dsp3Out, 4)}
      </div>
    </section>
  </div>

  {/if}

  <section class="card">
    <div class="card-head">
      <div class="card-title">Stereo links</div>
      <div class="card-sub">Linked pairs move together in routing and appear as stereo strips in the mixer</div>
    </div>
    <div class="card-body links">
      {#each linkGroups(mixer2) as g (g.label)}
        <div class="link-row">
          <div class="label">{g.label}</div>
          <div class="pills">
            {#each g.links as l (l.index)}
              <button class="pill" class:on={cfg.links[l.index]} onclick={() => es9.setLink(l.index, !cfg.links[l.index])}>
                <span class="dot"></span>{l.label}
              </button>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  </section>
</div>

<style>
  .patch {
    padding: 14px 18px 18px;
  }
  .flow {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .row-title {
    color: var(--text-2);
    font-size: 12px;
    margin-top: 4px;
  }
  .row-title b {
    color: var(--text);
    font-weight: 600;
  }
  .arrow {
    color: var(--accent);
    font-weight: 700;
    margin-right: 4px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
    gap: 8px 6px;
  }
  .slot {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  .slot-label {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: var(--muted);
    font-weight: 500;
    padding-left: 2px;
    height: 14px;
  }
  .slot.linked .slot-label {
    color: var(--accent);
  }
  .lk {
    display: inline-flex;
    color: var(--accent);
  }
  .two {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }
  @media (max-width: 1180px) {
    .two {
      grid-template-columns: 1fr;
    }
  }
  .badge {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.06em;
    padding: 3px 7px;
    border-radius: 5px;
    background: var(--panel-3);
  }
  .badge.usb {
    color: var(--sky);
    background: rgba(56, 189, 248, 0.12);
  }
  .badge.mix {
    color: var(--accent);
    background: var(--accent-soft);
  }
  .badge.spdif {
    color: var(--violet);
    background: rgba(167, 139, 250, 0.12);
  }
  .links {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .link-row {
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .link-row .label {
    width: 64px;
    flex: none;
  }
  .pills {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
</style>
