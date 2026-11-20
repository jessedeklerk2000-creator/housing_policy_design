import { useState } from 'react';
import type { Element, Flow, MapData, Scenario, Selection } from './types';

export const STATE_NOTE: Record<string, string> = {
  readout: 'Read-out only. It computes a signal and carries no flow in the circuit.',
  signal: 'Separate from the main circuit. Its value is read by another source.',
  unused: 'Not connected in this run, so it has no effect on the results.',
};
export const CHAIN = ['B§Reference', 'B§Error', 'B§PID_P', 'B§PID_D', 'B§PID_I_Robust'];
export function stateOf(e: Element, s: Scenario): string {
  if (e.name === 'I§Owner_occupied_subsidies') return s.feedback ? 'unused' : 'active';
  if (e.name === 'B§PID' || CHAIN.includes(e.name)) return s.feedback ? 'active' : 'unused';
  return e.state;
}
const LABEL_OFFSET: Record<string, [number, number]> = {
  'B§Mortgage_rate_ALM': [-60, -62],  // bank view (Bank.tsx): above the source, clear of L9 and the u₁ arrow
  'I§Rental_subsidies1': [-24, 56], 'I§Owner_occupied_subsidies': [-24, 56], 'B§PID': [-24, 56], 'L§Supply_owner_occupied': [-142, 0], 'C3': [-14, 62], 'C2': [-14, 62], 'R20': [-74, 0], 'L§Supply_rent': [-132, 0], 'B§Housing_services': [-30, 205], 'Interest_Rates': [-176, 0], 'V§Shock_covid': [0, -6], 'V§Shock_financialcrisis': [0, -6], 'L§F_Consumption': [18, -6], 'C7': [0, 0],
};
const DISPLAY: Record<string, string> = {
  'B§Mortgage_rate_ALM': 'Mortgage rate (ALM)', 'B§Deposit_flow': 'Inflow', 'B§Net_interest': 'NII', 'C§Deposits': 'Deposits', 'C§Equity': 'Equity', 'B§Loans_funding': 'Loan-to-deposit',  // bank view
  'L§Supply_owner_occupied': 'Supply owner', 'L§Supply_rent': 'Supply rent', 'L§Gross_imputed_rent': 'Gross imp.', 'V§Maintenance_costs': 'Maintenance', 'L§Demand_owner_occupied': 'Demand owner', 'I§Owner_occupied_subsidies': 'Owner subsidies', 'I§Rental_subsidies1': 'Rental subsidies', 'B§PID': 'PID output', 'B§PID_I_Robust': 'PID I', 'V§Shock_financialcrisis': 'Crisis shock', 'V§Shock_covid': 'Covid shock', 'L§Supply_consumption': 'Supply goods', 'L§Demand_consumption': 'Demand goods', 'I§Mortgages': 'Mortgages', 'B§Mortgage_interest': 'Mortgage interest', 'Interest_Rates': 'Interest rates', 'Incomeactual': 'Income (historical)', 'V§Construction_cost': 'Construction cost',
};
const short = (e: Element) => DISPLAY[e.name] ?? e.name.split('§').pop()!.replace(/_/g, ' ');

export function Glyph({ type, length }: { type: string; length: number }) {
  const mid = length / 2, half = Math.min(26, length / 2 - 6);
  const leads = (gap: number) => <path d={`M0 0H${mid - gap}M${mid + gap} 0H${length}`}/>;
  if (type === 'res') { const n = 6, s = (2 * half) / n; return <path d={`M0 0H${mid - half}` + Array.from({ length: n }, (_, i) => `L${mid - half + s * (i + .5)} ${i % 2 ? 11 : -11}`).join('') + `L${mid + half} 0H${length}`}/>; }
  if (type === 'ind' || type === 'ind2') { const n = 4, s = (2 * half) / n; return <path d={`M0 0H${mid - half}` + Array.from({ length: n }, () => `a${s / 2} ${s / 2} 0 0 1 ${s} 0`).join('') + `H${length}`}/>; }
  if (type === 'cap') return <>{leads(6)}<path d={`M${mid - 6} -15V15M${mid + 6} -15V15`}/></>;
  const diamond = <path d={`M${mid - 21} 0L${mid} -21L${mid + 21} 0L${mid} 21Z`}/>, ring = <circle cx={mid} cy={0} r={19}/>;
  if (type === 'voltage' || type === 'bv') return <>{leads(type === 'bv' ? 21 : 19)}{type === 'bv' ? diamond : ring}<path d={`M${mid - 12} 0h7M${mid - 8.5} -3.5v7M${mid + 5} 0h7`}/></>;
  return <>{leads(type === 'current' ? 19 : 21)}{type === 'current' ? ring : diamond}<path d={`M${mid - 10} 0H${mid + 9}M${mid + 3} -5L${mid + 10} 0L${mid + 3} 5`}/></>;
}

function ElementView({ e, state, selected, pick, menu }: { e: Element; state: string; selected: boolean; pick: () => void; menu?: (ev: React.MouseEvent) => void }) {
  const [[ax, ay], [bx, by]] = e.pins, length = Math.hypot(bx - ax, by - ay), angle = Math.atan2(by - ay, bx - ax) * 180 / Math.PI;
  const vertical = Math.abs(by - ay) > Math.abs(bx - ax), mx = (ax + bx) / 2, my = (ay + by) / 2, shift = LABEL_OFFSET[e.name] ?? [0, 0];
  return <g className={`element ${state}${selected ? ' selected' : ''}`} role="button" tabIndex={0} aria-label={`${e.name}, ${e.role}${state === 'active' ? '' : `. ${STATE_NOTE[state] ?? ''}`}`} onClick={ev => { ev.stopPropagation(); pick(); }} onContextMenu={ev => { if (menu) { ev.preventDefault(); ev.stopPropagation(); menu(ev); } }} onKeyDown={k => { if (k.key === 'Enter' || k.key === ' ') { k.preventDefault(); k.stopPropagation(); pick(); } }}>
    <rect className="hit" x={Math.min(ax, bx) - (vertical ? 26 : 2)} y={Math.min(ay, by) - (vertical ? 2 : 26)} width={Math.abs(bx - ax) + (vertical ? 52 : 4)} height={Math.abs(by - ay) + (vertical ? 4 : 52)} rx={5}/>
    <g className="glyph" transform={`translate(${ax} ${ay}) rotate(${angle})`}><Glyph type={e.type} length={length}/></g>
    <text x={(vertical ? mx + 26 : mx) + shift[0]} y={(vertical ? my + 7 : my - 28) + shift[1]} textAnchor={vertical ? 'start' : 'middle'}>{short(e)}</text>
  </g>;
}

/** Terminal pair on the agent border: flow rail with ammeter, return rail, voltmeter between them. */
function PortMark({ x, y, w, h, flow, selected, pick, ret }: { x: number; y: number; w: number; h: number; flow: Flow; selected: boolean; pick: () => void; ret?: number[] }) {
  const out: [number, number] = x === 0 ? [-1, 0] : x === w ? [1, 0] : y === 0 ? [0, -1] : [0, 1];
  const side: [number, number] = out[0] ? [0, 1] : [1, 0], rail = 30, reach = 56;
  const px = (t: number, s = 0): [number, number] => [x + out[0] * t + side[0] * s, y + out[1] * t + side[1] * s];
  const line = (a: [number, number], b: [number, number]) => `M${a[0]} ${a[1]}L${b[0]} ${b[1]}`;
  const [lx, ly] = px(reach + 14, rail / 2), anchor = out[0] < 0 ? 'end' : out[0] > 0 ? 'start' : 'middle';
  const end = px(reach), retStart = ret ?? px(0, rail), retEnd = px(reach, rail), A = px(24), V = px(40, rail / 2);
  return <g className={`port ${flow.kind}${selected ? ' selected' : ''}`} role="button" tabIndex={0} aria-label={`Port ${flow.label}`} onClick={pick} onKeyDown={k => { if (k.key === 'Enter' || k.key === ' ') { k.preventDefault(); pick(); } }}>
    <path className="rail" d={line([x, y], end)}/><path className="return" d={line(retStart as [number, number], retEnd)}/><path className="return" d={line(px(40), px(40, rail))}/>
    <circle className="dot" cx={end[0]} cy={end[1]} r={5}/><circle className="open" cx={retEnd[0]} cy={retEnd[1]} r={5}/>
    <circle className="meter" cx={A[0]} cy={A[1]} r={11}/><text className="m" x={A[0]} y={A[1] + 5}>A</text><circle className="meter" cx={V[0]} cy={V[1]} r={11}/><text className="m" x={V[0]} y={V[1] + 5}>V</text>
    <text className="port-name" x={lx} y={out[1] < 0 ? ly - 6 : out[1] > 0 ? ly + 20 : ly + 6} textAnchor={anchor}>{flow.short}</text>
  </g>;
}

export const BREADBOARD = <defs><pattern id="breadboard" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="10" cy="10" r="1.6" fill="#c9bb9c"/></pattern></defs>;

/** Dashed arrow from where a disturbance enters the block (same spacing as the canvas arrows in ModelMap) to the
 * source element it drives. Left entry: across, then down/up to the element; top entry: down, then across. */
export function inputPath(side: 'left' | 'top', i: number, n: number, size: [number, number], pins: number[][]): number[][] {
  const [w, h] = size, cx = (pins[0][0] + pins[1][0]) / 2, cy = (pins[0][1] + pins[1][1]) / 2, gap = 38;
  if (side === 'left') { const y = h * (i + 1) / (n + 1); return Math.abs(y - cy) < gap ? [[0, y], [cx - gap, y]] : [[0, y], [cx, y], [cx, cy + (y < cy ? -gap : gap)]]; }
  const x = w * (i + 1) / (n + 1); return Math.abs(x - cx) < gap ? [[x, 0], [x, cy - gap]] : [[x, 0], [x, cy], [cx + (x < cx ? -gap : gap), cy]];
}
// Wires that carry a flow inside an agent drawing: start at the flow's port (or its return point), follow connected
// wire segments (shared ends and T-junctions), pass through the flow's own chain elements (pin to pin) and stop at
// any other element. Claude's tracing of the drawing, for the equation highlight.
type Seg = number[];
const near = (a: number[], b: number[]) => Math.abs(a[0] - b[0]) < .5 && Math.abs(a[1] - b[1]) < .5;
const onSeg = (p: number[], w: Seg) => Math.abs((w[2] - w[0]) * (p[1] - w[1]) - (w[3] - w[1]) * (p[0] - w[0])) < .5 * Math.hypot(w[2] - w[0], w[3] - w[1]) + 1e-9
  && p[0] >= Math.min(w[0], w[2]) - .5 && p[0] <= Math.max(w[0], w[2]) + .5 && p[1] >= Math.min(w[1], w[3]) - .5 && p[1] <= Math.max(w[1], w[3]) + .5;
function traceFlow(segs: Seg[], start: number[], pins: { name: string; pins: number[][] }[], chain: Set<string>): Set<number> {
  const lit = new Set<number>(), seen: number[][] = [], todo: number[][] = [start];
  while (todo.length) {
    const p = todo.pop()!;
    if (seen.some(q => near(q, p))) continue;
    seen.push(p);
    const el = pins.find(e => e.pins.some(q => near(q, p)));
    if (el && !near(p, start)) {
      if (!chain.has(el.name)) continue;                      // another element: the flow stops here
      el.pins.forEach(q => { if (!near(q, p)) todo.push(q); });  // through its own element to the other pin
    }
    segs.forEach((w, i) => {
      if (!onSeg(p, w)) return;
      lit.add(i); todo.push([w[0], w[1]], [w[2], w[3]]);
      segs.forEach(v => { [[v[0], v[1]], [v[2], v[3]]].forEach(q => { if (onSeg(q, w)) todo.push(q); }); });  // T-junctions on this segment
    });
  }
  return lit;
}
const SHOCK_RED = '#c5352a', SUBSIDY_BLUE = '#1f6fc4';
export function AgentCircuit({ map, agent, scenario, selection, pick, menu, inputs = [], inputSide = 'left', outside = false, highlight = [], litFlows = [], trace = [] }: { outside?: boolean; highlight?: string[]; litFlows?: string[]; trace?: string[]; map: MapData; agent: string; scenario: Scenario; selection: Selection; pick: (s: Selection) => void; menu?: (s: Selection, ev: React.MouseEvent) => void; inputs?: { id: string; label: string; element?: string }[]; inputSide?: 'left' | 'top' }) {
  const layout = map.layouts[agent], [w, h] = layout.size;
  const hidden = (e: Element) => (e.name === 'I§Owner_occupied_subsidies' && scenario.feedback) || (e.name === 'B§PID' && !scenario.feedback);
  const elements = map.elements.filter(e => e.agent === agent && !hidden(e));
  const flow = (id: string) => map.flows.find(f => f.id === id)!;
  const line = (w: number[]) => `M${w[0]} ${w[1]}L${w[2]} ${w[3]}`;
  // Lit flows (equation highlight): the wires carrying them, coloured like their rails, and their chain elements
  const pinsOf = elements.filter(e => e.pins && e.pins.length >= 2).map(e => ({ name: e.name, pins: e.pins! }));
  const flowsHere = litFlows.map(id => map.flows.find(f => f.id === id)).filter((f): f is NonNullable<typeof f> => !!f && !!layout.ports[f.id]);
  const litW = new Map<number, string>(), litR = new Map<number, string>(), chainLit = new Set<string>();
  const KIND_COLOR: Record<string, string> = { money: '#3f8f4f', real: '#c8861a', policy: '#1f6fc4' };
  flowsHere.forEach(f => { const chain = new Set(f.chain), col = KIND_COLOR[f.kind] ?? '#2b6599'; f.chain.forEach(n => chainLit.add(n));
    traceFlow(layout.wires, layout.ports[f.id], pinsOf, chain).forEach(i => litW.set(i, col));
    if (layout.returns[f.id]) traceFlow(layout.return_wires, layout.returns[f.id], pinsOf, chain).forEach(i => litR.set(i, col)); });
  // Equation trace: the wires between the named elements (money green), starting at each of their pins.
  const traceSet = new Set(trace.filter(n => pinsOf.some(e => e.name === n)));
  pinsOf.filter(e => traceSet.has(e.name)).forEach(e => e.pins.forEach(p => traceFlow(layout.wires, p, pinsOf, traceSet).forEach(i => { if (!litW.has(i)) litW.set(i, KIND_COLOR.money); })));
  // Trim dangling ends: a lit wire must end at a lit element's pin, a lit flow's port or another lit wire; a loose end is
  // cut back to the last connection on that wire (or the wire goes dark when it has none).
  const geo = new Map<number, Seg>();
  if (traceSet.size) {
    const anchors = [...pinsOf.filter(e => traceSet.has(e.name) || chainLit.has(e.name) || highlight.includes(e.name)).flatMap(e => e.pins), ...flowsHere.map(f => layout.ports[f.id])];
    litW.forEach((_, i) => geo.set(i, [...layout.wires[i]]));
    const ends = (g: Seg) => [[g[0], g[1]], [g[2], g[3]]];
    for (let changed = true, guard = 0; changed && guard < 500; guard++) { changed = false;
      for (const [i, g] of [...geo]) {
        const others = [...geo].filter(([j]) => j !== i).map(([, h]) => h);
        const held = (q: number[]) => anchors.some(a => near(a, q)) || others.some(h => onSeg(q, h));
        const [a, b] = ends(g), la = !held(a), lb = !held(b);
        if (!la && !lb) continue;
        // connections on this wire: anchors and other wires' ends lying on it
        const pts = [...anchors, ...others.flatMap(ends)].filter(q => onSeg(q, g));
        const t = (q: number[]) => Math.hypot(q[0] - a[0], q[1] - a[1]), L = t(b);
        const ts = pts.map(t).filter(v => v > .5 && v < L - .5);
        const lo = la ? (ts.length ? Math.min(...ts) : null) : 0, hi = lb ? (ts.length ? Math.max(...ts) : null) : L;
        changed = true;
        if (lo === null || hi === null || hi - lo < .5) { geo.delete(i); litW.delete(i); continue; }
        const at = (v: number) => [a[0] + (b[0] - a[0]) * v / L, a[1] + (b[1] - a[1]) * v / L];
        geo.set(i, [...at(lo), ...at(hi)]);
      }
    }
  }
  return <svg className="circuit embedded" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={`${map.agents[agent].label} circuit`}>
    {BREADBOARD}<rect x={0} y={0} width={w} height={h} fill="url(#breadboard)"/>
    <defs>{([['shock', SHOCK_RED], ['subsidy', SUBSIDY_BLUE]] as const).map(([k, c]) => <marker key={k} id={`in-${agent}-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="22" markerHeight="22" markerUnits="userSpaceOnUse" orient="auto"><path d="M0 0 10 5 0 10z" fill={c}/></marker>)}</defs>
    <g className="return-wires">{[...layout.return_wires, ...layout.common_returns].map((r, i) => <path key={i} d={line(r)}/>)}{layout.dots.map(([x, y], i) => <circle key={`d${i}`} className="return-dot" cx={x} cy={y} r={5}/>)}</g>
    <g className="wires">{layout.wires.map((r, i) => <path key={i} d={line(r)}/>)}</g>
    {(litW.size > 0 || litR.size > 0) && <g className="lit-wires">{[...litR].map(([i, c]) => <path key={'r' + i} className="ret" stroke={c} d={line(layout.return_wires[i])}/>)}{[...litW].map(([i, c]) => <path key={'w' + i} stroke={c} d={line(geo.get(i) ?? layout.wires[i])}/>)}</g>}
    <g className="grounds">{layout.grounds.map(([x, y], i) => <path key={i} d={`M${x - 14} ${y}H${x + 14}L${x} ${y + 16}Z`}/>)}</g>
    {/* outside: the canvas draws the subsidy and shock arrows straight through to the element (one unbroken arrow) */}
    {!outside && layout.signals.filter(sig => sig.flow !== 'rental_subsidy' || scenario.rental_subsidy).map(sig => <g key={sig.flow} className={`u-signal${selection.kind === 'flow' && selection.id === sig.flow ? ' selected' : ''}`} role="button" tabIndex={0} aria-label={`Control signal ${flow(sig.flow).label}`} onClick={ev => { ev.stopPropagation(); pick({ kind: 'flow', id: sig.flow }); }} onContextMenu={ev => { if (menu) { ev.preventDefault(); ev.stopPropagation(); menu({ kind: 'flow', id: sig.flow }, ev); } }}>
      <path d={sig.path.map(([x, y], j) => `${j ? 'L' : 'M'}${x} ${y}`).join('')} markerEnd={`url(#in-${agent}-subsidy)`}/></g>)}
    {!outside && inputs.map((d, i) => { const e = d.element ? map.elements.find(x => x.name === d.element && x.agent === agent) : undefined; if (!e || !e.pins || e.pins.length < 2) return null;
      const pts = inputPath(inputSide, i, inputs.length, [w, h], e.pins);
      return <g key={d.id} className={`d-input${selection.kind === 'signal' && selection.id === d.id ? ' selected' : ''}`} role="button" tabIndex={0} aria-label={`Disturbance ${d.label} enters at ${e.name}`} onClick={ev => { ev.stopPropagation(); pick({ kind: 'signal', id: d.id }); }}>
        <title>{`${d.label} enters here`}</title><path d={pts.map(([x, y], j) => `${j ? 'L' : 'M'}${x} ${y}`).join('')} markerEnd={`url(#in-${agent}-shock)`}/></g>; })}
    {elements.map(e => <ElementView key={e.name} e={e} state={stateOf(e, scenario)} selected={(selection.kind === 'element' && selection.id === e.name) || highlight.includes(e.name) || chainLit.has(e.name)} pick={() => pick({ kind: 'element', id: e.name })} menu={menu && (ev => menu({ kind: 'element', id: e.name }, ev))}/>)}
  </svg>;
}

/** Controller with its ports where the outside arrows meet it: e in at mid-left, u2 out at mid-right, u1 out lower right. */
const num = (v: number) => (+v.toFixed(3)).toString();
export const CONTROLLER_SIZE: [number, number] = [1100, 480];
export type GainKey = 'kp' | 'ki' | 'kd' | 'skp' | 'ski' | 'skd';
type Part = 'P' | 'I' | 'D';
// ---- op-amp breadboard of one PID part (normalised component values: Claude's choice, the model itself is a behavioural source)
export const W = (pts: number[][], k: string) => <path key={k} className="bb-wire" d={pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join('')}/>;
export const res = (x: number, y: number, len: number, label: string, value: string, k: string) => { const z = Array.from({ length: 7 }, (_, i) => `L${x + 20 + i * (len - 40) / 6 - (len - 40) / 12} ${y + (i % 2 ? -12 : 12)}`).join(''); return <g key={k}><path className="bb-part" d={`M${x} ${y}L${x + 20 - (len - 40) / 12} ${y}${z}L${x + len - 20} ${y}L${x + len} ${y}`}/><text className="bb-label" x={x + len / 2} y={y - 22}>{label}</text><text className="bb-value" x={x + len / 2} y={y + 36}>{value}</text></g>; };
export const cap = (x: number, y: number, len: number, label: string, value: string, k: string) => <g key={k}><path className="bb-part" d={`M${x} ${y}L${x + len / 2 - 8} ${y}M${x + len / 2 - 8} ${y - 22}L${x + len / 2 - 8} ${y + 22}M${x + len / 2 + 8} ${y - 22}L${x + len / 2 + 8} ${y + 22}M${x + len / 2 + 8} ${y}L${x + len} ${y}`}/><text className="bb-label" x={x + len / 2} y={y - 30}>{label}</text><text className="bb-value" x={x + len / 2} y={y + 44}>{value}</text></g>;
export const gnd = (x: number, y: number, k: string) => <path key={k} className="bb-part" d={`M${x} ${y}L${x} ${y + 16}M${x - 16} ${y + 16}L${x + 16} ${y + 16}M${x - 10} ${y + 23}L${x + 10} ${y + 23}M${x - 4} ${y + 30}L${x + 4} ${y + 30}`}/>;
export const opamp = (x: number, y: number, k: string) => <g key={k}><path className="bb-amp" d={`M${x} ${y - 60}L${x} ${y + 60}L${x + 110} ${y}Z`}/><text className="bb-pin" x={x + 10} y={y - 22}>−</text><text className="bb-pin" x={x + 10} y={y + 38}>+</text></g>;
/** Inverting stage at (x, y): input part, feedback part, op-amp, + input grounded; output at x + 330. */
export function stage(x: number, y: number, input: React.ReactNode, feedback: React.ReactNode, k: string) {
  return <g key={k}>{input}{W([[x + 150, y], [x + 190, y], [x + 190, y - 30], [x + 200, y - 30]], `${k}a`)}{W([[x + 190, y], [x + 190, y - 110], [x + 210, y - 110]], `${k}fb1`)}{feedback}
    {W([[x + 310, y - 110], [x + 330, y - 110], [x + 330, y], [x + 310, y]], `${k}fb2`)}{opamp(x + 200, y, `${k}amp`)}{W([[x + 200, y + 30], [x + 180, y + 30], [x + 180, y + 50]], `${k}g`)}{gnd(x + 180, y + 50, `${k}gnd`)}<circle className="bb-dot" cx={x + 190} cy={y} r={5}/><circle className="bb-dot" cx={x + 330} cy={y} r={5}/></g>;
}
export function PartBreadboard({ part, K, filtered, close }: { part: Part; K: [number, number, number]; filtered: boolean; close: () => void }) {
  const [w, h] = CONTROLLER_SIZE, y = 310, x0 = 120;
  const title = { P: 'P · proportional: inverting amplifier', I: 'I · integral: integrator', D: 'D · derivative: differentiator' }[part];
  const first = part === 'P' ? stage(x0, y, res(x0, y, 150, 'R_in', '1', 'pin'), res(x0 + 210, y - 110, 100, 'R_f', num(K[0]), 'pf'), 'p')
    : part === 'I' ? stage(x0, y, res(x0, y, 150, 'R', num(1 / K[1]), 'iin'), cap(x0 + 210, y - 110, 100, 'C', '1', 'if'), 'i')
    : stage(x0, y, filtered ? <g key="din">{res(x0, y, 70, 'R_s', 'filter', 'ds')}{cap(x0 + 70, y, 80, 'C', '1', 'dc')}</g> : cap(x0, y, 150, 'C', '1', 'dc'), res(x0 + 210, y - 110, 100, 'R', num(K[2]), 'df'), 'd');
  const law = { P: `u = (R_f / R_in) · error = ${num(K[0])} · error`, I: `u = 1/(R·C) · ∫error dt = ${num(K[1])} · ∫error dt`, D: `u = R·C · d(error)/dt = ${num(K[2])} · d(error)/dt${filtered ? ', R_s adds the 0.5-year filter' : ''}` }[part];
  return <svg className="circuit embedded" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={`${part} part breadboard`}>
    {BREADBOARD}<rect x={0} y={0} width={w} height={h} fill="url(#breadboard)"/>
    <g className="bb-head" role="button" tabIndex={0} onClick={e => { e.stopPropagation(); close(); }}><rect x={10} y={96} width={w - 20} height={46} rx={6}/><text x={30} y={128}>{title}</text><text x={w - 40} y={131} textAnchor="middle" className="bb-close">−</text></g>
    {W([[20, y], [x0, y]], 'in')}<text className="port-label" x={24} y={y - 14}>error</text>
    {first}
    {/* second inverting stage with equal resistors restores the sign */}
    {W([[x0 + 330, y], [x0 + 400, y]], 'mid')}{stage(x0 + 400, y, res(x0 + 400, y, 150, 'R', '1', 's2in'), res(x0 + 610, y - 110, 100, 'R', '1', 's2f'), 's2')}
    {W([[x0 + 730, y], [w - 20, y]], 'out')}<text className="port-label" x={w - 30} y={y - 14} textAnchor="end">{part.toLowerCase()} part</text>
    <text className="bb-law" x={w / 2} y={h - 44}>{law}</text>
    <text className="bb-note" x={w / 2} y={h - 18}>Normalised values (model units). The second stage (gain −1) restores the sign. A low-pass filter stage can be added between the stages.</text>
  </svg>;
}

export function ControllerCircuit({ map, scenario, selection, pick, step }: { map: MapData; scenario: Scenario; selection: Selection; pick: (s: Selection) => void; step?: (k: GainKey, up: boolean) => void }) {
  const [part, setPart] = useState<Part | null>(null);
  if (part) return <PartBreadboard part={part} K={[scenario.kp, scenario.ki, scenario.kd]} filtered={scenario.derivative_filter} close={() => setPart(null)}/>;
  const stepper = (x: number, y: number, k: GainKey, s = 1) => step && <g className="gain-arrows">
    {([[true, -1], [false, 1]] as const).map(([up, d]) => <g key={String(up)} role="button" tabIndex={0} aria-label={`${k} ${up ? 'up' : 'down'}`} onClick={ev => { ev.stopPropagation(); step(k, up); pick({ kind: 'agent', id: 'controller' }); }}>
      <rect x={x} y={y + (d < 0 ? -36 : 2) * s} width={34 * s} height={34 * s} rx={5}/><path d={up ? `M${x + 7 * s} ${y - 10 * s}L${x + 17 * s} ${y - 26 * s}L${x + 27 * s} ${y - 10 * s}Z` : `M${x + 7 * s} ${y + 12 * s}L${x + 17 * s} ${y + 28 * s}L${x + 27 * s} ${y + 12 * s}Z`}/></g>)}</g>;
  const zoom = (x: number, y: number, p: Part) => <g className="part-zoom" role="button" tabIndex={0} aria-label={`Open the ${p} breadboard`} onClick={ev => { ev.stopPropagation(); setPart(p); }}><rect x={x} y={y} width={30} height={30} rx={5}/><path d={`M${x + 8} ${y + 15}L${x + 22} ${y + 15}M${x + 15} ${y + 8}L${x + 15} ${y + 22}`}/></g>;
  const [w, h] = CONTROLLER_SIZE, closed = scenario.feedback, el = (name: string) => map.elements.find(e => e.name === name);
  const box = (name: string, x: number, y: number, bw: number, title: string, sub: string, active: boolean) => {
    const e = el(name), on = selection.kind === 'element' && selection.id === name;
    return <g className={`ctrl-box${active ? '' : ' off'}${on ? ' selected' : ''}`} role="button" tabIndex={0} aria-label={`${name}, ${title}`} onClick={ev => { ev.stopPropagation(); if (e) pick({ kind: 'element', id: name }); }}>
      <rect x={x} y={y - 42} width={bw} height={84} rx={8}/><text className="t" x={x + bw / 2} y={y - 4}>{title}</text><text className="s" x={x + bw / 2} y={y + 28}>{sub}</text></g>;
  };
  const path = (pts: number[][], active: boolean, key: string) => <path key={key} className={active ? 'sig on' : 'sig off'} d={pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join('')}/>;
  if (closed && scenario.share_control) {
    // Two goals: price PID (top) and rental-share PID (bottom). The share PID moves money: - from u2, + to u1.
    const mini = (name: string, x: number, y: number, label: string) => {
      const e = el(name), on = selection.kind === 'element' && selection.id === name;
      return <g key={label} className={`ctrl-box${on ? ' selected' : ''}`} role="button" tabIndex={0} aria-label={`${name}, ${label}`} onClick={ev => { ev.stopPropagation(); if (e) pick({ kind: 'element', id: name }); }}>
        <rect x={x} y={y - 24} width={230} height={48} rx={7}/><text className="t mini" x={x + 115} y={y + 7}>{label}</text></g>;
    };
    const pid = (y0: number, k: [number, number, number], names: [string, string, string], key: string) => <g key={key}>
      {path([[110, y0], [180, y0]], true, `${key}in`)}{path([[180, y0 - 62], [180, y0 + 62]], true, `${key}bus`)}
      {[-62, 0, 62].map((dy, i) => path([[180, y0 + dy], [250, y0 + dy]], true, `${key}a${i}`))}
      {[-62, 62].map((dy, i) => path([[480, y0 + dy], [540, y0 + dy], [540, y0 + Math.sign(dy) * 22]], true, `${key}b${i}`))}{path([[480, y0], [518, y0]], true, `${key}c`)}
      {mini(names[0], 250, y0 - 62, `P · Kp ${num(k[0])}`)}{mini(names[1], 250, y0, `I · Ki ${num(k[1])}`)}{mini(names[2], 250, y0 + 62, `D · Kd ${num(k[2])}${scenario.derivative_filter ? ' (filtered)' : ''}`)}
      {(['p', 'i', 'd'] as const).map((g, i) => <g key={g}>{stepper(440, y0 + (i - 1) * 62, (key === 's' ? 's' + 'k' + g : 'k' + g) as GainKey, .6)}{key === 'p' && zoom(254, y0 + (i - 1) * 62 - 20, g.toUpperCase() as Part)}</g>)}
      <circle className="sum-mark" cx={540} cy={y0} r={22}/></g>;
    return <svg className="circuit embedded" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label="Controller circuit, two goals">
      {path([[0, 240], [110, 240]], true, 'e')}{path([[110, 100], [110, 370]], true, 'split')}<circle cx={110} cy={240} r={7} className="junction"/>
      <text className="port-sub" x={128} y={92}>error₁</text><text className="port-sub" x={128} y={362}>error₂</text>
      {pid(100, [scenario.kp, scenario.ki, scenario.kd], ['B§PID_P', 'B§PID_I_Robust', 'B§PID_D'], 'p')}
      {pid(370, [scenario.skp, scenario.ski, scenario.skd], ['', '', ''], 's')}
      <text className="port-sub strong" x={580} y={86}>Price PID</text><text className="port-sub strong" x={580} y={356}>Rental-share PID</text>
      {path([[562, 100], [900, 100], [900, 218]], true, 'up')}
      {path([[562, 370], [790, 370]], true, 'so')}<circle cx={790} cy={370} r={7} className="junction"/>
      {path([[790, 370], [790, 300], [900, 300], [900, 262]], true, 'minus')}{path([[790, 370], [1000, 370], [1000, 378]], true, 'plus')}
      <circle className="sum-mark" cx={900} cy={240} r={22}/><text className="sign" x={912} y={212}>+</text><text className="sign" x={912} y={284}>−</text>
      {path([[922, 240], [1100, 240]], true, 'u2')}
      <circle className="sum-mark" cx={1000} cy={400} r={22}/><text className="sign" x={1012} y={372}>+</text><text className="sign" x={1012} y={444}>+</text>
      <g className={`ctrl-box${selection.kind === 'element' && selection.id === 'I§Rental_subsidies1' ? ' selected' : ''}`} role="button" tabIndex={0} aria-label="I§Rental_subsidies1, rental baseline" onClick={ev => { ev.stopPropagation(); pick({ kind: 'element', id: 'I§Rental_subsidies1' }); }}>
        <rect x={700} y={410} width={230} height={56} rx={7}/><text className="t mini" x={815} y={433}>Rental baseline</text><text className="s mini" x={815} y={457}>historical: 4, then 0</text></g>
      {path([[930, 438], [1000, 438], [1000, 422]], true, 'base')}
      {path([[1022, 400], [1100, 400]], true, 'u1')}
      <text className="port-label" x={10} y={222}>error</text><text className="port-label" x={1090} y={222} textAnchor="end">u2</text><text className="port-label" x={1090} y={382} textAnchor="end">u1</text>
    </svg>;
  }
  return <svg className="circuit embedded" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label="Controller circuit">
    {path([[0, 240], [160, 240]], closed, 'e')}{path([[160, 240], [160, 100], [330, 100]], closed, 'p')}{path([[160, 240], [330, 240]], closed, 'i')}{path([[160, 240], [160, 380], [330, 380]], closed, 'd')}
    {path([[610, 100], [700, 100], [700, 216]], closed, 'po')}{path([[610, 240], [676, 240]], closed, 'io')}{path([[610, 380], [700, 380], [700, 264]], closed, 'do')}
    {path([[724, 240], [930, 240]], closed, 'pid-out')}{path([[930, 140], [930, 240]], !closed, 'hist-out')}{path([[930, 240], [1100, 240]], true, 'u2')}{path([[1060, 400], [1100, 400]], true, 'u1')}
    <circle className={closed ? 'sum-mark' : 'sum-mark off'} cx={700} cy={240} r={24}/><circle cx={930} cy={240} r={7} className="junction"/>
    {box('B§PID_P', 330, 100, 280, 'P', `Kp ${num(scenario.kp)}`, closed)}{box('B§PID_I_Robust', 330, 240, 280, 'I', `Ki ${num(scenario.ki)}`, closed)}{box('B§PID_D', 330, 380, 280, 'D', `Kd ${num(scenario.kd)}${scenario.derivative_filter ? ', filtered' : ''}`, closed)}
    {stepper(568, 100, 'kp')}{stepper(568, 240, 'ki')}{stepper(568, 380, 'kd')}{zoom(336, 64, 'P')}{zoom(336, 204, 'I')}{zoom(336, 344, 'D')}
    {box('I§Owner_occupied_subsidies', 800, 98, 260, 'Owner path', 'historical', !closed)}{box('I§Rental_subsidies1', 800, 400, 260, 'Rental path', 'historical', true)}
    <text className="port-label" x={10} y={222}>error</text><text className="port-label" x={1090} y={222} textAnchor="end">u2</text><text className="port-label" x={1090} y={382} textAnchor="end">u1</text>
  </svg>;
}
