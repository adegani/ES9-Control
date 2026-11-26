<script lang="ts">
  /**
   * Max/Pd-style patch bay for the routing. Two kinds of cable:
   *  - capture: any source outlet → a DSP input slot (USB Audio Input, mixer inputs, S/PDIF Out).
   *    Every slot always has exactly one source, so a new cable replaces the old one.
   *  - output: a DSP output (USB Audio Output, mixer outputs, S/PDIF In) → a physical output or bus.
   *    Every DSP output always has exactly one destination; destinations can take many cables.
   */
  import { onMount, tick } from "svelte";
  import { es9 } from "../store.svelte";
  import { captureLabel } from "../protocol";
  import Icon from "./Icon.svelte";

  interface Port {
    key: string;
    label: string;
    full: string;
    color: string;
    /** Outlet: capture source code it provides. */
    code?: number;
    /** Outlet: DSP output slot it represents. */
    dsp?: [number, number];
    /** Inlet: DSP capture slot it sets. */
    cap?: [number, number];
    /** Inlet: output destination value it represents. */
    dest?: number;
  }
  interface PNode {
    id: string;
    title: string;
    sub?: string;
    color: string;
    inlets: Port[];
    outlets: Port[];
  }
  interface Pt {
    x: number;
    y: number;
  }
  interface Cable {
    id: string;
    from: string;
    to: string;
    color: string;
    linked: boolean;
  }

  const C = {
    analog: "var(--sky)",
    usb: "var(--violet)",
    spdif: "var(--rose)",
    bus: "var(--amber)",
    mix: "var(--accent)",
    out: "var(--text-2)",
  };

  const range = (n: number) => Array.from({ length: n }, (_, i) => i);
  const usbCode = (i: number) => (i < 8 ? i : 0x10 + i - 8);
  const analogOut = [8, 9, 4, 5, 2, 3, 11, 10];

  function node(id: string, title: string, color: string, sub: string | undefined, inlets: Omit<Port, "key" | "full" | "color">[], outlets: Omit<Port, "key" | "full" | "color">[]): PNode {
    const mk = (side: string) => (p: Omit<Port, "key" | "full" | "color">, i: number) => ({ ...p, key: `${side}:${id}:${i}`, full: `${title} ${p.label}`, color });
    return { id, title, sub, color, inlets: inlets.map(mk("i")), outlets: outlets.map(mk("o")) };
  }

  const mixer2 = $derived(es9.mixer2Enabled);
  const cfg = $derived(es9.cfg);

  const columns = $derived.by((): PNode[][] => {
    const left = [
      node("ain", "Analog In", C.analog, undefined, [], range(14).map((i) => ({ label: `${i + 1}`, code: 0x70 + i }))),
      node("usbo", "USB Audio Output", C.usb, "from DAW", [], range(16).map((i) => ({ label: `${i + 1}`, code: usbCode(i), dsp: [i >> 3, i & 7] as [number, number] }))),
      ...(mixer2
        ? []
        : [
            node("spdi", "S/PDIF In", C.spdif, undefined, [], [
              { label: "L", code: 48, dsp: [3, 0] as [number, number] },
              { label: "R", code: 49, dsp: [3, 1] as [number, number] },
            ]),
          ]),
      node("busr", "Bus", C.bus, "read", [], range(16).map((i) => ({ label: `${i + 1}`, code: 0x60 + i }))),
    ];
    const mid = [
      node("mx1", "Mixer 1", C.mix, undefined,
        range(8).map((i) => ({ label: `In ${i + 1}`, cap: [2, i] as [number, number] })),
        range(8).map((i) => ({ label: `Out ${i + 1}`, code: 0x20 + i, dsp: [2, i] as [number, number] }))),
      ...(mixer2
        ? [
            node("mx2", "Mixer 2", C.mix, undefined,
              range(8).map((i) => ({ label: `In ${i + 1}`, cap: [3, i] as [number, number] })),
              range(8).map((i) => ({ label: `Out ${i + 1}`, dsp: [3, i] as [number, number] }))),
          ]
        : []),
    ];
    const right = [
      node("usbi", "USB Audio Input", C.usb, "to DAW", range(16).map((i) => ({ label: `${i + 1}`, cap: [i >> 3, i & 7] as [number, number] })), []),
      ...(mixer2
        ? []
        : [
            node("spdo", "S/PDIF Out", C.spdif, undefined, [
              { label: "L", cap: [3, 0] as [number, number] },
              { label: "R", cap: [3, 1] as [number, number] },
            ], []),
          ]),
      node("main", "Main Out", C.out, undefined, [{ label: "L", dest: 6 }, { label: "R", dest: 7 }], []),
      node("phn", "Phones Out", C.out, undefined, [{ label: "L", dest: 12 }, { label: "R", dest: 13 }], []),
      node("es5", "ES-5 Out", C.out, undefined, [{ label: "L", dest: 14 }, { label: "R", dest: 15 }], []),
      node("euro", "Analog Out", C.out, undefined, analogOut.map((d, i) => ({ label: `${i + 1}`, dest: d })), []),
      node("busw", "Bus", C.bus, "write", range(16).map((i) => ({ label: `${i + 1}`, dest: 0x10 + i })), []),
    ];
    return [left, mid, right];
  });

  const nodes = $derived(columns.flat());
  const ports = $derived(new Map(nodes.flatMap((n) => [...n.inlets, ...n.outlets]).map((p) => [p.key, p])));
  const codeToOutlet = $derived(new Map(nodes.flatMap((n) => n.outlets).filter((p) => p.code !== undefined).map((p) => [p.code!, p])));
  const destToInlet = $derived(new Map(nodes.flatMap((n) => n.inlets).filter((p) => p.dest !== undefined).map((p) => [p.dest!, p])));

  const cables = $derived.by((): Cable[] => {
    const out: Cable[] = [];
    for (const n of nodes) {
      for (const p of n.inlets) {
        if (!p.cap) continue;
        const v = cfg.capture[p.cap[0]][p.cap[1]];
        const src = codeToOutlet.get(v);
        if (src) out.push({ id: `c:${p.key}`, from: src.key, to: p.key, color: src.color, linked: es9.isCaptureLinked(v) });
      }
      for (const p of n.outlets) {
        if (!p.dsp) continue;
        const dst = destToInlet.get(cfg.outputs[p.dsp[0]][p.dsp[1]]);
        if (dst) out.push({ id: `o:${p.key}`, from: p.key, to: dst.key, color: p.color, linked: false });
      }
    }
    return out;
  });
  const connectedPorts = $derived(new Set(cables.flatMap((c) => [c.from, c.to])));

  /** Capture slots whose source has no outlet in the current layout. */
  function orphanSource(p: Port): string | null {
    if (!p.cap) return null;
    const v = cfg.capture[p.cap[0]][p.cap[1]];
    return codeToOutlet.has(v) ? null : captureLabel(v);
  }

  function describe(p: Port): string {
    const lines = cables.filter((c) => c.from === p.key || c.to === p.key).map((c) => (c.to === p.key ? `← ${ports.get(c.from)?.full}` : `→ ${ports.get(c.to)?.full}`));
    const orphan = orphanSource(p);
    if (orphan) lines.push(`← ${orphan}`);
    return [p.full, ...lines].join("\n");
  }

  // ───────────── geometry ─────────────

  let wrap: HTMLDivElement;
  let pos = $state<Record<string, Pt>>({});

  function measure() {
    if (!wrap) return;
    const r = wrap.getBoundingClientRect();
    const next: Record<string, Pt> = {};
    for (const el of wrap.querySelectorAll<HTMLElement>("[data-jack]")) {
      const b = el.getBoundingClientRect();
      next[el.dataset.jack!] = { x: b.left + b.width / 2 - r.left, y: b.top + b.height / 2 - r.top };
    }
    pos = next;
  }

  $effect(() => {
    void columns;
    tick().then(measure);
  });

  onMount(() => {
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    return () => ro.disconnect();
  });

  function curve(a: Pt, b: Pt) {
    const dx = Math.max(60, Math.abs(b.x - a.x) * 0.45);
    return `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`;
  }

  // ───────────── interaction ─────────────

  let hoverPort = $state<string | null>(null);
  let hoverNode = $state<string | null>(null);

  type Kind = "capture" | "output";
  function compatible(a: Port, b: Port): { kind: Kind; outlet: Port; inlet: Port } | null {
    const aOut = a.key.startsWith("o:");
    if (aOut === b.key.startsWith("o:")) return null;
    const outlet = aOut ? a : b;
    const inlet = aOut ? b : a;
    if (inlet.cap && outlet.code !== undefined) return { kind: "capture", outlet, inlet };
    if (inlet.dest !== undefined && outlet.dsp) return { kind: "output", outlet, inlet };
    return null;
  }

  let drag = $state<{ from: Port; pt: Pt } | null>(null);
  const dropTarget = $derived(drag && hoverPort ? ports.get(hoverPort) : undefined);
  const dropOk = $derived(drag && dropTarget ? compatible(drag.from, dropTarget) : null);

  function toLocal(e: PointerEvent): Pt {
    const r = wrap.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function startDrag(e: PointerEvent, p: Port) {
    if (e.button !== 0) return;
    e.preventDefault();
    drag = { from: p, pt: toLocal(e) };
    const move = (ev: PointerEvent) => {
      if (drag) drag.pt = toLocal(ev);
      const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>("[data-port]");
      hoverPort = el?.dataset.port ?? null;
    };
    const end = (ev: PointerEvent | KeyboardEvent) => {
      if (ev instanceof KeyboardEvent && ev.key !== "Escape") return;
      if (ev instanceof PointerEvent && drag) {
        const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>("[data-port]");
        const target = el ? ports.get(el.dataset.port!) : undefined;
        if (target) connect(drag.from, target);
      }
      drag = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("keydown", end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("keydown", end);
  }

  function connect(a: Port, b: Port) {
    const c = compatible(a, b);
    if (!c) return;
    if (c.kind === "capture") es9.setCapture(c.inlet.cap![0], c.inlet.cap![1], c.outlet.code!);
    else es9.setOutput(c.outlet.dsp![0], c.outlet.dsp![1], c.inlet.dest!);
  }

  function portState(p: Port): "ok" | "no" | "src" | "" {
    if (!drag) return "";
    if (drag.from.key === p.key) return "src";
    return compatible(drag.from, p) ? "ok" : "no";
  }

  const nodeOf = (key: string) => key.split(":")[1];
  function cableActive(c: Cable): boolean {
    if (drag) return false;
    if (hoverPort) return c.from === hoverPort || c.to === hoverPort;
    if (hoverNode) return nodeOf(c.from) === hoverNode || nodeOf(c.to) === hoverNode;
    return false;
  }
  const focusing = $derived(!drag && (hoverPort !== null || hoverNode !== null));

  const status = $derived.by(() => {
    if (drag) {
      if (dropTarget && dropTarget.key !== drag.from.key) {
        if (!dropOk) return `${drag.from.full} ✕ ${dropTarget.full}`;
        return `${dropOk.outlet.full} → ${dropOk.inlet.full}`;
      }
      return `${drag.from.full} → …`;
    }
    const p = hoverPort ? ports.get(hoverPort) : undefined;
    return p ? describe(p).replaceAll("\n", "   ") : null;
  });
</script>

{#snippet port(p: Port, side: "in" | "out")}
  {@const st = portState(p)}
  {@const orphan = side === "in" ? orphanSource(p) : null}
  {@const linked = !!p.cap && es9.isCaptureLinked(cfg.capture[p.cap[0]][p.cap[1]])}
  <div
    class="port {side} {st}"
    class:hot={hoverPort === p.key}
    class:on={connectedPorts.has(p.key) || !!orphan}
    data-port={p.key}
    title={describe(p)}
    role="button"
    tabindex="-1"
    onpointerdown={(e) => startDrag(e, p)}
    onpointerenter={() => (hoverPort = p.key)}
    onpointerleave={() => !drag && (hoverPort = null)}
  >
    <span class="jack" data-jack={p.key} style:--c={p.color}></span>
    <span class="plabel">{p.label}</span>
    {#if linked && (p.cap![1] & 1) === 0}<span class="lk"><Icon name="link" size={11} /></span>{/if}
    {#if orphan}<span class="orphan">← {orphan}</span>{/if}
  </div>
{/snippet}

{#snippet pnode(n: PNode)}
  <div class="node" class:hot={hoverNode === n.id} style:--c={n.color}>
    <div class="node-head" role="presentation" onpointerenter={() => (hoverNode = n.id)} onpointerleave={() => (hoverNode = null)}>
      <span class="dot"></span>
      <span class="title">{n.title}</span>
      {#if n.sub}<span class="sub">{n.sub}</span>{/if}
    </div>
    <div class="node-body" class:both={n.inlets.length && n.outlets.length}>
      {#if n.inlets.length}
        <div class="ports">{#each n.inlets as p (p.key)}{@render port(p, "in")}{/each}</div>
      {/if}
      {#if n.outlets.length}
        <div class="ports">{#each n.outlets as p (p.key)}{@render port(p, "out")}{/each}</div>
      {/if}
    </div>
  </div>
{/snippet}

<div class="bay-status" class:idle={!status}>
  {status ?? "Drag from one jack to another to patch. Hover a jack or a block title to follow its cables."}
</div>

<div class="bay" class:dragging={!!drag} bind:this={wrap}>
  <div class="col">{#each columns[0] as n (n.id)}{@render pnode(n)}{/each}</div>
  <div class="col mid">
    {#each columns[1] as n (n.id)}{@render pnode(n)}{/each}
    {#if !mixer2}<div class="ghost">Mixer 2 is off: DSP 4 runs the S/PDIF ports. Switch it in Settings.</div>{/if}
  </div>
  <div class="col">{#each columns[2] as n (n.id)}{@render pnode(n)}{/each}</div>

  <svg class="wires" aria-hidden="true">
    {#each cables as c (c.id)}
      {@const a = pos[c.from]}
      {@const b = pos[c.to]}
      {#if a && b}
        <path d={curve(a, b)} class:active={cableActive(c)} class:dim={focusing && !cableActive(c)} class:linked={c.linked} style:stroke={c.color} />
      {/if}
    {/each}
    {#if drag && pos[drag.from.key]}
      {@const start = pos[drag.from.key]}
      {@const end = dropOk && dropTarget && pos[dropTarget.key] ? pos[dropTarget.key] : drag.pt}
      {@const fromOut = drag.from.key.startsWith("o:")}
      <path class="temp" class:ok={!!dropOk} d={fromOut ? curve(start, end) : curve(end, start)} style:stroke={drag.from.color} />
    {/if}
  </svg>
</div>

<style>
  .bay-status {
    font-size: 12px;
    color: var(--text-2);
    font-family: var(--mono);
    min-height: 18px;
    margin-bottom: 10px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .bay-status.idle {
    font-family: var(--font);
    color: var(--muted);
  }
  .bay {
    position: relative;
    display: grid;
    grid-template-columns: 185px minmax(110px, 1fr) 210px minmax(110px, 1fr) 185px;
    align-items: start;
  }
  .bay.dragging,
  .bay.dragging * {
    cursor: crosshair !important;
  }
  .col {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .col:nth-child(1) {
    grid-column: 1;
  }
  .col.mid {
    grid-column: 3;
    align-self: stretch;
    justify-content: center;
    gap: 28px;
  }
  .col:nth-child(3) {
    grid-column: 5;
  }
  .ghost {
    position: relative;
    z-index: 1;
    background: var(--panel);
    color: var(--faint);
    font-size: 11px;
    text-align: center;
    padding: 10px;
    border: 1px dashed var(--border-2);
    border-radius: var(--radius-sm);
  }

  .node {
    position: relative;
    z-index: 1;
    background: var(--panel-2);
    border: 1px solid var(--border-2);
    border-radius: var(--radius-sm);
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
  }
  .node.hot {
    border-color: color-mix(in srgb, var(--c) 60%, transparent);
  }
  .node-head {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    border-bottom: 1px solid var(--border);
    font-size: 12px;
    font-weight: 600;
  }
  .node-head .dot {
    width: 7px;
    height: 7px;
    border-radius: 2px;
    background: var(--c);
    flex: none;
  }
  .node-head .title {
    white-space: nowrap;
  }
  .node-head .sub {
    color: var(--muted);
    font-weight: 400;
    font-size: 11px;
    margin-left: auto;
    white-space: nowrap;
  }
  .node-body {
    padding: 4px 0;
  }
  .node-body.both {
    display: grid;
    grid-template-columns: 1fr 1fr;
  }

  .port {
    position: relative;
    display: flex;
    align-items: center;
    gap: 6px;
    height: 19px;
    padding: 0 12px;
    font-size: 11px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
    cursor: crosshair;
    outline: none;
  }
  .port.out {
    flex-direction: row-reverse;
  }
  .port:hover,
  .port.hot {
    color: var(--text);
    background: rgba(255, 255, 255, 0.04);
  }
  .port.on {
    color: var(--text-2);
  }
  .port.no {
    opacity: 0.25;
  }
  .port.ok .jack {
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 35%, transparent);
  }
  .port.ok.hot .jack {
    box-shadow: 0 0 0 4px var(--accent);
  }
  .jack {
    position: absolute;
    top: 50%;
    width: 11px;
    height: 11px;
    margin-top: -5.5px;
    border-radius: 50%;
    border: 2px solid var(--c);
    background: var(--panel);
    transition: box-shadow 0.1s;
  }
  .port.in .jack {
    left: -6.5px;
  }
  .port.out .jack {
    right: -6.5px;
  }
  .port.on .jack {
    background: var(--c);
  }
  .port.src .jack {
    box-shadow: 0 0 0 4px color-mix(in srgb, var(--c) 45%, transparent);
  }
  .lk {
    display: inline-flex;
    color: var(--accent);
  }
  .orphan {
    color: var(--amber);
    font-size: 10px;
    white-space: nowrap;
  }

  .wires {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
    pointer-events: none;
    z-index: 0;
  }
  .wires path {
    fill: none;
    stroke-width: 1.8;
    stroke-linecap: round;
    opacity: 0.7;
    transition:
      opacity 0.12s,
      stroke-width 0.12s;
  }
  .wires path.linked {
    stroke-width: 2.6;
  }
  .wires path.active {
    opacity: 1;
    stroke-width: 3;
  }
  .wires path.dim {
    opacity: 0.08;
  }
  .wires path.temp {
    stroke-width: 2.4;
    stroke-dasharray: 5 5;
    opacity: 0.9;
  }
  .wires path.temp.ok {
    stroke-dasharray: none;
    opacity: 1;
  }
</style>
