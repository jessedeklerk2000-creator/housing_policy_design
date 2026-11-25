import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { BaseEdge, Controls, Handle, Position, ReactFlow, ReactFlowProvider, useReactFlow, useStore, type Edge, type EdgeProps, type Node, type NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Activity, BarChart3, Camera, Coins, Globe, Home, Landmark, Sigma, ShieldCheck, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, LoaderCircle, Maximize2, Minus, Pause, Play, Plus, Image as ImageIcon } from 'lucide-react';
import { savePng } from './shot';
import { LabelCtx, TERMS, mappingCsv, mappingTex, namePlain, symbolsFor, type LabelMode, type LabelState } from './elementNames';
import { IdentPanel } from './Ident';
import { api } from './api';
import { Chart, type Line } from './Chart';
import { AgentCircuit, CONTROLLER_SIZE, ControllerCircuit, STATE_NOTE, inputPath, stateOf, type GainKey } from './Schematic';
import type { Element, Flow, MapData, Result, Scenario, Selection } from './types';
import { ControllerLocus, Robustness, TransferPanel, type Design, type K3, type Pick } from './Analysis';
import { NyquistPanel } from './Nyquist';
import { FormulaCards, FORMULAS, STRIP_BOTTOM, STRIP_H, useFormulaWidths, type Formula } from './Formulas';
import { BodeBody, SensBody, YoyBody } from './Cards';
import type { GuideCmd, Snap } from './Guide';
import { CPB_PEAKS, FLAT, GROWTH, NO_SHOCKS, NO_SUBSIDY, ONE_STEP, PHASE, SHOCKS_CBS } from './Tour';

type Point = [number, number];
type Side = 'L' | 'R' | 'T' | 'B';
type Rect = { x: number; y: number; w: number; h: number };
const COLOR = { money: '#4f9a4f', real: '#c98a1b', policy: '#38b2d3' };
const SHOCK = '#c5352a', LOOP = '#3f9a1f';
const NONE: Selection = { kind: 'none', id: '' };
const fmt = (v: number) => Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(1) : v.toFixed(3);

// Bank controls (20 Nov 2026): the same canvas with the bank's ALM desk as the controller. Set by Bank.tsx; null on
// the main view, where nothing below changes.
export interface BankVariant {
  desk: React.ReactNode;          // inside of the opened controller
  sensor: React.ReactNode;        // inside of the opened sensor (the bank's reporting)
  patch: (m: MapData) => MapData; // disturbances and control-signal names of the bank netlist
  inspect: (s: Selection) => React.ReactNode | null;  // side panel for the bank's blocks (null: the normal panel)
}
export const BankCtx = createContext<BankVariant | null>(null);

export function readTrace(result: Result, signal: string): number[] | undefined {
  if (['owner_subsidy', 'rental_subsidy', 'share_target', 'rental_share'].includes(signal)) return result.series[signal];
  if (signal === 'yoy') return result.series.yoy;
  const lookup = (name: string) => { const wanted = name.toLowerCase(); const key = Object.keys(result.traces).find(k => k.toLowerCase() === wanted); return key ? result.traces[key] : undefined; };
  const pair = /^V\(([^,]+),([^)]+)\)$/.exec(signal);
  if (pair) {
    const a = pair[1] === '0' ? undefined : lookup(`V(${pair[1]})`), b = pair[2] === '0' ? undefined : lookup(`V(${pair[2]})`);
    const base = a ?? b; if (!base) return undefined;
    return base.map((_, i) => (a?.[i] ?? 0) - (b?.[i] ?? 0));
  }
  return lookup(signal);
}
function Spark({ y, color, at }: { y?: number[]; color: string; at: number }) {
  if (!y) return null;
  const lo = Math.min(...y), hi = Math.max(...y), span = hi - lo || 1, w = 64, h = 20, sx = (i: number) => i / (y.length - 1) * w, sy = (v: number) => h - 2 - (v - lo) / span * (h - 4);
  return <svg className="spark" width={w} height={h} aria-hidden="true"><path d={y.filter((_, i) => i % 4 === 0).map((v, i) => `${i ? 'L' : 'M'}${sx(i * 4).toFixed(1)} ${sy(v).toFixed(1)}`).join('')} fill="none" stroke={color} strokeWidth={1.5}/><circle cx={sx(at)} cy={sy(y[at])} r={2.4} fill={color}/></svg>;
}

// ---------- geometry
const SCALE = { collapsed: 0.22, expanded: 0.5, controller: 0.34 };
const len = (a: Point, b: Point) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const along = (a: Point, b: Point, t: number): Point => { const l = len(a, b) || 1; return [a[0] + (b[0] - a[0]) / l * t, a[1] + (b[1] - a[1]) / l * t]; };
const toPath = (pts: Point[]) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
function offset(points: Point[], d: number): Point[] {
  const normal = (a: Point, b: Point): Point => { const l = len(a, b) || 1; return [-(b[1] - a[1]) / l, (b[0] - a[0]) / l]; };
  return points.map((p, i) => {
    const n1 = i > 0 ? normal(points[i - 1], p) : normal(p, points[i + 1]), n2 = i < points.length - 1 ? normal(p, points[i + 1]) : n1;
    const same = Math.abs(n1[0] - n2[0]) + Math.abs(n1[1] - n2[1]) < 1e-6;
    return same ? [p[0] + n1[0] * d, p[1] + n1[1] * d] : [p[0] + (n1[0] + n2[0]) * d, p[1] + (n1[1] + n2[1]) * d];
  });
}
function crossings(a: Point[], b: Point[]) {
  let n = 0;
  for (let i = 1; i < a.length; i++) for (let j = 1; j < b.length; j++) {
    const [p, q, r, s] = [a[i - 1], a[i], b[j - 1], b[j]];
    const av = p[0] === q[0], bv = r[0] === s[0];
    if (av === bv) continue;
    const [v1, v2, h1, h2] = av ? [p, q, r, s] : [r, s, p, q];
    const x = v1[0], y = h1[1];
    if (x > Math.min(h1[0], h2[0]) + .5 && x < Math.max(h1[0], h2[0]) - .5 && y > Math.min(v1[1], v2[1]) + .5 && y < Math.max(v1[1], v2[1]) - .5) n++;
  }
  return n;
}
function permutations<T>(xs: T[]): T[][] { return xs.length <= 1 ? [xs] : xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map(r => [x, ...r])); }
/** Orthogonal route from P to Q, with the jog on the given lane coordinate. */
function route(P: Point, sp: Side, Q: Point, lane: number): Point[] {
  if ((sp === 'L' || sp === 'R')) return Math.abs(P[1] - Q[1]) < .5 ? [P, Q] : [P, [lane, P[1]], [lane, Q[1]], Q];
  return Math.abs(P[0] - Q[0]) < .5 ? [P, Q] : [P, [P[0], lane], [Q[0], lane], Q];
}
type Wire = { id: string; P: Point; sp: Side; Q: Point; channel: string };
function assignLanes(wires: Wire[], channels: Record<string, [number, number]>) {
  const out: Record<string, Point[]> = {};
  for (const [name, [lo, hi]] of Object.entries(channels)) {
    const group = wires.filter(w => w.channel === name);
    if (!group.length) continue;
    const lanes = group.map((_, i) => lo + (hi - lo) * (i + .5) / group.length);
    let best: Point[][] = [], score = Infinity;
    for (const order of permutations(group.map((_, i) => i)).slice(0, 720)) {
      const paths = group.map((w, i) => route(w.P, w.sp, w.Q, lanes[order[i]]));
      let c = 0;
      for (let i = 0; i < paths.length; i++) for (let j = i + 1; j < paths.length; j++) c += crossings(paths[i], paths[j]) + crossings(offset(paths[i], 12), paths[j]) + crossings(paths[i], offset(paths[j], 12));
      if (c < score) { score = c; best = paths; }
    }
    group.forEach((w, i) => { out[w.id] = best[i]; });
  }
  return out;
}

// ---------- nodes
type BlockData = { icon?: React.ReactNode; label: string; sub?: string; tone: string; width: number; height: number; selected?: boolean; children?: React.ReactNode; toggle?: () => void; open?: boolean; tab?: 'tl' | 'br' | 'bl' | 'above'; headSpace?: number; scale?: number; resize?: (scale: number) => void };
// Open CBS block: how the published numbers are made from the two measurements (netlist 19okt):
//   house price index  = I(Construction_cost) = x1, unscaled;
//   year-on-year (%)   = (x1(t) - x1(t - 1 yr)) / x1(t - 1 yr) x 100   (B§Year_on_year_change1, delay 6 s = 1 year);
//   x2 (new construction) is recorded but does not enter the index.
// Drawn in its own units (1000 x 520); x1 enters at y 218, x2 at 342, the index leaves at 280 (where the canvas wires are).
// The year marker (Play, slider) reaches the drawing through this context, so the graph's nodes and edges are not
// rebuilt every frame: React Flow then keeps its measured blocks (rebuilding them each frame hid blocks and arrows).
export const AtContext = createContext<{ result: Result | null; at: number }>({ result: null, at: 0 });
function Val({ signal, digits }: { signal: string; digits?: number }) {
  const { result, at } = useContext(AtContext); const t = result && readTrace(result, signal);
  const v = t ? t[Math.min(at, t.length - 1)] : null;
  return <>{v == null ? '' : digits != null ? v.toFixed(digits) : fmt(v)}</>;
}
const CBS_SIZE: Point = [1000, 520], CBS_Y = { x1: 218, x2: 342, out: 280 };
function CbsCircuit() {
  const { result, at } = useContext(AtContext);
  const x1 = result ? readTrace(result, 'I(Construction_cost)') : undefined, x2 = result ? readTrace(result, 'I(Construction)') : undefined;
  const yr = result ? Math.round(1 / (result.year[1] - result.year[0])) : 10, back = at - yr;
  const v = (t: number[] | undefined, i: number) => t && i >= 0 ? fmt(t[i]) : '–';
  const yoy = result && back >= 0 ? result.series.yoy[at] : undefined;
  const year = result ? result.year[at].toFixed(1) : '';
  const box = (x: number, y: number, w: number, title: string, formula: string, value: string, tone = '') => <g className={'cbs-box ' + tone}>
    <rect x={x} y={y - 46} width={w} height={92} rx={8}/><text className="t" x={x + w / 2} y={y - 14}>{title}</text>
    <text className="f" x={x + w / 2} y={y + 12}>{formula}</text>{result && <text className="v" x={x + w / 2} y={y + 36}>{value}</text>}</g>;
  const wire = (pts: number[][], cls = '') => <path className={'cbs-wire ' + cls} d={pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join('')}/>;
  const { x1: a, x2: b, out } = CBS_Y;
  return <svg className="circuit embedded" viewBox={`0 0 ${CBS_SIZE[0]} ${CBS_SIZE[1]}`} preserveAspectRatio="none" role="img" aria-label="Inside CBS: house price index and year-on-year change">
    {wire([[0, a], [300, a]])}{wire([[90, a], [90, 80], [130, 80]])}{wire([[380, 80], [460, 80]])}{wire([[230, a], [230, 160], [630, 160], [630, 126]])}
    <circle cx={90} cy={a} r={7} className="cbs-dot"/><circle cx={230} cy={a} r={7} className="cbs-dot"/>
    {wire([[560, a], [900, a], [900, out], [1000, out]])}{wire([[800, 80], [1000, 80]])}{wire([[0, b], [300, b]], 'muted')}
    {box(130, 80, 250, 'One year earlier', 'x₁(t − 1 yr)', `${v(x1, back)}`)}
    {box(460, 80, 340, 'Year-on-year change', '(x₁(t) − x₁(t−1 yr)) / x₁(t−1 yr) × 100', yoy !== undefined ? `${yoy.toFixed(1)} % a year` : '–', 'yoy')}
    {box(300, a, 260, 'House price index', 'y = x₁ (no scaling)', `${v(x1, at)}`, 'index')}
    {box(300, b, 260, 'New construction', 'x₂: recorded, not in the index', `${v(x2, at)}`, 'muted')}
    <text className="cbs-port" x={8} y={a - 12}>x₁ payments</text><text className="cbs-port" x={8} y={b - 12}>x₂ houses</text>
    <text className="cbs-port" x={992} y={68} textAnchor="end">year-on-year</text><text className="cbs-port" x={992} y={out - 12} textAnchor="end">index y</text>
    <text className="cbs-note" x={20} y={500}>{result ? `Values in ${year}. ` : ''}Year-on-year needs one year of history: it starts after the first model year.</text>
  </svg>;
}
// Drag handle in the bottom-right corner (opened controller): the block grows or shrinks, the layout follows.
function Grip({ data }: { data: BlockData }) {
  const k = useStore(s => s.transform[2]), last = useRef(0);
  const down = (e: React.PointerEvent) => {
    e.stopPropagation(); e.preventDefault();
    // two presses within 350 ms: back to the original size
    if (e.timeStamp - last.current < 350) { last.current = 0; data.resize!(1); return; }
    last.current = e.timeStamp;
    const x0 = e.clientX, y0 = e.clientY, s0 = data.scale ?? 1, w0 = data.width, h0 = data.height;
    let raf = 0;
    const move = (ev: PointerEvent) => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => {
      const f = Math.max((w0 + (ev.clientX - x0) / k) / w0, (h0 + (ev.clientY - y0) / k) / h0);
      data.resize!(Math.min(3, Math.max(0.6, +(s0 * f).toFixed(3)))); }); };
    const up = () => { cancelAnimationFrame(raf); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  return <div className="block-grip nodrag nopan" role="separator" aria-label={`Resize ${data.label}`} title="Drag to make the block bigger or smaller (double-click: original size)"
    onPointerDown={down} onClick={e => e.stopPropagation()}/>;
}
function Block({ data }: NodeProps<Node<BlockData>>) {
  const button = data.toggle && <button className="toggle nodrag" aria-label={`${data.open ? 'Collapse' : 'Expand'} ${data.label}`} onClick={e => { e.stopPropagation(); data.toggle!(); }}>{data.open ? <Minus size={13}/> : <Plus size={13}/>}</button>;
  return <div className={`map-node ${data.tone}${data.open ? ' open' : ''}${data.selected ? ' selected' : ''}`} style={{ width: data.width, height: data.height }}>
    <Handle type="target" position={Position.Left} className="hidden-handle"/><Handle type="source" position={Position.Right} className="hidden-handle"/>
    {data.open && data.resize && <Grip data={data}/>}{data.open ? data.headSpace ? <div className="open-body" style={{ top: data.headSpace }}>{data.children}</div> : <>{data.children}</> : data.label ? <><div className="block-head"><strong>{data.label.replace('\n', ' ')}</strong>{button}</div><div className="block-body">{data.icon && <span className="block-icon" aria-hidden="true">{data.icon}</span>}{data.sub && <span>{data.sub}</span>}{data.children}</div></> : <>{button}{data.children}</>}
  </div>;
}
// ---------- probes: one effort e and one flow f per port (supervisor 3.1-3.3)
export type Probe = { flow: string; q: 'e' | 'f' | 's' };  // s: a signal arrow (a disturbance or a subsidy input)
type XY = { x: number; y: number };
type ChartCard = { id: string; kind: 'bode'; from: Probe; to: Probe } | { id: string; kind: 'sens' } | { id: string; kind: 'cbs' };
type CbsData = { year: number[]; yoy: number[]; lag_months: number; corr: number; corr_zero: number; source: string };
type Ctx = { K: K3; filtered: boolean; feedback: boolean; settling: number; overshoot: number };
/** What a probe means as the input of a transfer function (null: it cannot be an input). */
function probeInput(map: MapData, p: Probe): { kind: string; id: string } | null {
  if (p.q === 'e') return null;
  if (p.q === 'f') return { kind: 'flow', id: p.flow };
  if (p.flow === 'y_reference') return { kind: 'signal', id: 'y_reference' };
  if (loopSig(map, p.flow)) return null;
  return map.disturbances.some(d => d.id === p.flow) ? { kind: 'signal', id: p.flow } : { kind: 'flow', id: p.flow };
}
type ProbeState = { waiting?: boolean; waitingStep?: boolean; shockShow?: Result | null; compare?: { result: Result; color: string; label: string; align: boolean } | null; compare2?: { result: Result; color: string; label: string } | null; cardSize?: { w: number; h: number }; pins: Probe[]; sensed: Probe[]; unpin: (p: Probe) => void; dock: (p: Probe) => void; muted?: boolean; stepAt?: string; stepLabel?: string; charts: ChartCard[]; bodeFrom: Probe | null; setBodeFrom: (p: Probe | null) => void; addBode: (from: Probe, to: Probe, at: XY) => void; addChart: (c: ChartCard, at?: XY) => void; removeChart: (id: string) => void; openSensor: () => void; ctx: Ctx; cbs?: CbsData; lag: number; cpb?: { year: number[]; yoy: number[] }; pos: Record<string, XY>; setPos: (id: string, p: XY) => void; place: (p: Probe, at: XY) => void; sense: (p: Probe) => void; show?: (p: Probe, e: React.MouseEvent) => void };
type ProbeActions = { addSens: () => void; hasSens: boolean; pinned: (p: Probe) => boolean; sensed: (p: Probe) => boolean; pin: (p: Probe) => void; sense: (p: Probe) => void; list: Probe[]; count: number; stepInput: string; setStepInput: (id: string) => void };
const probeKey = (p: Probe) => `${p.flow}:${p.q}`;
const probeOf = (id: string): Probe => { const [flow, q] = id.split(':'); return { flow, q: q as Probe['q'] }; };
// Loop signals that open a card when clicked: what they read, their colour, their step output and what 'dock' opens.
const LOOP_SIGNALS: Record<string, { label: string; title: string; note?: string; signal: string; unit: string; color: string; pair?: { signal: string; label: string; color: string; first?: string }; third?: { signal: string; label: string; color: string }; step?: { kind: 'signal' | 'flow'; id: string }; dock: Selection }> = {
  y_yoy: { label: 'Year-on-year', title: 'Output · year-on-year price change', signal: 'yoy', unit: '% a year', color: '#3f9a1f', dock: { kind: 'signal', id: 'y_yoy' } },
  y_reference: { label: 'Target r', title: 'Reference r · House price target', signal: 'I(Reference)', unit: 'Model units', color: '#2b6599', step: { kind: 'signal', id: 'y_reference' }, dock: { kind: 'signal', id: 'y_reference' } },
  y_error: { label: 'Gap e', title: 'Gap e · target minus price', signal: 'I(Error)', unit: 'Model units', color: '#1f2a26', step: { kind: 'signal', id: 'y_error' }, dock: { kind: 'signal', id: 'y_error' } },
  x1: { label: 'Construction payments', title: 'State x₁ · Construction payments', signal: 'I(Construction_cost)', unit: 'Model units', color: COLOR.money, step: { kind: 'signal', id: 'y_price' }, dock: { kind: 'signal', id: 'y_price' } },
  x2: { label: 'New construction', title: 'State x₂ · New construction', signal: 'I(Construction)', unit: '#/year', color: '#c98a1b', step: { kind: 'flow', id: 'houses' }, dock: { kind: 'flow', id: 'houses' } },
  y_price: { label: 'House price', title: 'Output y · House price', signal: 'I(Construction_cost)', unit: 'Model units', color: '#3f9a1f', step: { kind: 'signal', id: 'y_price' }, dock: { kind: 'signal', id: 'y_price' } },
  // second output of the MIMO loop (guided tour, housing ladder)
  // housing ladder: what renters and owners pay per m² (rent ÷ rental services, imputed rent ÷ owner-occupied services;
  // these are the netlist outputs Net_housing_rent1 and Net_housing1), two lines on one card
  y_rent_cost: { label: 'Rent vs owner cost', title: 'Cost per m²: rent vs owner', signal: 'I(Net_housing_rent1)', unit: '€/m² a year', color: '#b9770e', pair: { signal: 'I(Net_housing1)', label: 'owner', color: '#1f6fc4' }, dock: { kind: 'signal', id: 'y_price' } },
  y_share: { label: 'Rental share', title: 'Output y₂ · Rental share of housing services', signal: 'rental_share', unit: '%', color: '#b9770e', dock: { kind: 'signal', id: 'y_reference' } },
};
// bank mode: the patched map carries its own loop signals (Tier 1, loan-to-deposit), else the housing ones
const loopSig = (map: MapData | null | undefined, id: string) => map?.loop?.[id] ?? LOOP_SIGNALS[id];
function probeInfo(map: MapData, p: Probe) {
  const loop = p.q === 's' ? loopSig(map, p.flow) : undefined;
  if (loop) return { f: { id: p.flow, label: loop.label, short: loop.label, kind: 'policy', port: null, unit: loop.unit } as unknown as Flow, signal: loop.signal, title: loop.title, unit: loop.unit, color: loop.color, step: loop.step };
  if (p.q === 's') {
    const d = map.disturbances.find(x => x.id === p.flow), f = map.flows.find(x => x.id === p.flow);
    const label = d?.label ?? f?.label ?? p.flow;
    return { f: f ?? { id: p.flow, label, short: label, kind: 'policy', port: null, unit: d?.unit ?? '' } as unknown as Flow, signal: d?.signal ?? f?.signal, title: `${label} · ${d ? 'disturbance d' : /rate$/i.test(label) ? 'client rate u' : 'subsidy u'}`, unit: d?.unit ?? f?.unit ?? '', color: d ? SHOCK : COLOR.policy,
      step: f ? { kind: 'flow', id: f.id } as const : undefined };
  }
  const f = map.flows.find(x => x.id === p.flow)!;
  const signal = p.q === 'f' ? f.signal : f.port ? (f.port.ret === '0' ? `V(${f.port.node})` : `V(${f.port.node},${f.port.ret})`) : undefined;
  return { f, signal, title: `${f.label} · ${p.q === 'f' ? 'flow f' : 'effort e'}`, unit: p.q === 'f' ? f.unit : 'Model units (node voltage)', color: p.q === 'f' ? COLOR[f.kind] : '#6b4fa0',
    step: { kind: p.q === 'f' ? 'flow' : 'effort', id: f.id } as const };
}
function MiniPlot({ y, at, color, w = 240, h = 92, k = 1, label, ghost, ghostColor = '#2F6FB5', ghost2, ghost2Color = '#7cc96a', second, secondColor = '#1f6fc4', third, thirdColor = '#c0392b' }: { third?: number[]; thirdColor?: string; y: number[]; at?: number; color: string; w?: number; h?: number; k?: number; label?: string; ghost?: number[]; ghostColor?: string; ghost2?: number[]; second?: number[]; secondColor?: string; ghost2Color?: string }) {
  // White space above and below the line (10% of the range plus room for the max/min labels), so a step that jumps
  // straight to its final value does not run along the top edge.
  const all = [...y, ...(ghost ?? []), ...(ghost2 ?? []), ...(second ?? []), ...(third ?? [])], lo = Math.min(...all), hi = Math.max(...all), pad = (hi - lo) * .1, top = 18 * k, bot = 16 * k;
  const sx = (i: number) => 4 + i / (y.length - 1) * (w - 8), sy = (v: number) => h - bot - (hi > lo ? (v - lo + pad) / (hi - lo + 2 * pad) : .5) * (h - top - bot);
  // With a time marker: the line up to that time is dark, the rest faint, and a dot with the year rides on it (Play).
  const pts = (a: number, b: number) => y.slice(a, b).map((v, i) => `${sx(a + i)},${sy(v)}`).join(' ');
  const lx = at !== undefined ? Math.min(Math.max(sx(at), 18 * k), w - 18 * k) : 0, ly = at !== undefined ? (sy(y[at]) < h / 2 ? sy(y[at]) + 15 * k : sy(y[at]) - 8 * k) : 0;
  return <svg width={w} height={h} className="mini-plot"><rect x={0} y={0} width={w} height={h} fill="#fff"/>
    {lo < 0 && hi > 0 && <line x1={0} x2={w} y1={sy(0)} y2={sy(0)} stroke="#d5dbd8"/>}
    {ghost2 && <polyline fill="none" stroke={ghost2Color} strokeWidth={3.6 * k} strokeDasharray={`${0.5 * k} ${5 * k}`} strokeLinecap="round" strokeLinejoin="round" points={ghost2.map((v, i) => `${sx(i)},${sy(v)}`).join(' ')}/>}
    {ghost && <polyline fill="none" stroke={ghostColor} strokeWidth={2 * k} strokeDasharray={`${6 * k} ${4 * k}`} strokeLinejoin="round" points={ghost.map((v, i) => `${sx(i)},${sy(v)}`).join(' ')}/>}
    {second && <><polyline fill="none" stroke={secondColor} strokeOpacity={at !== undefined ? .22 : 1} strokeWidth={2.2 * k} strokeLinejoin="round" points={second.map((v, i) => `${sx(i)},${sy(v)}`).join(' ')}/>
      {at !== undefined && <><polyline fill="none" stroke={secondColor} strokeWidth={2.4 * k} strokeLinejoin="round" points={second.slice(0, at + 1).map((v, i) => `${sx(i)},${sy(v)}`).join(' ')}/>
        <circle cx={sx(at)} cy={sy(second[at])} r={3.6 * k} fill={secondColor} stroke="#fff" strokeWidth={1.2 * k}/></>}</>}
    {third && <><polyline fill="none" stroke={thirdColor} strokeOpacity={at !== undefined ? .22 : 1} strokeWidth={2.2 * k} strokeLinejoin="round" points={third.map((v, i) => `${sx(i)},${sy(v)}`).join(' ')}/>
      {at !== undefined && <><polyline fill="none" stroke={thirdColor} strokeWidth={2.4 * k} strokeLinejoin="round" points={third.slice(0, at + 1).map((v, i) => `${sx(i)},${sy(v)}`).join(' ')}/>
        <circle cx={sx(at)} cy={sy(third[at])} r={3.6 * k} fill={thirdColor} stroke="#fff" strokeWidth={1.2 * k}/></>}</>}
    <polyline fill="none" stroke={color} strokeOpacity={at !== undefined ? .22 : 1} strokeWidth={2.2 * k} strokeLinejoin="round" points={pts(0, y.length)}/>
    {at !== undefined && <><polyline fill="none" stroke={color} strokeWidth={2.4 * k} strokeLinejoin="round" points={pts(0, at + 1)}/>
      <line x1={sx(at)} x2={sx(at)} y1={2} y2={h - 2} stroke="#8a9692" strokeDasharray="3 3"/><circle cx={sx(at)} cy={sy(y[at])} r={3.6 * k} fill={color} stroke="#fff" strokeWidth={1.2 * k}/>
      {label && <text x={lx} y={ly} textAnchor="middle" className="mini-year">{label}</text>}</>}
    <text x={w - 4} y={11 * k} textAnchor="end" className="mini-tick">{fmt(hi)}</text><text x={w - 4} y={h - 6 * k} textAnchor="end" className="mini-tick">{fmt(lo)}</text></svg>;
}
// Card buttons (Bode, →CBS, dock, close) hidden behind a small arrow, so the title has room. Shown while a Bode plot
// is being built, so the output card's Bode→ can be clicked.
function PinTools({ children, keepOpen }: { children: React.ReactNode; keepOpen?: boolean }) {
  const [open, setOpen] = useState(false), show = open || !!keepOpen;
  return <span className={'pin-tools' + (show ? ' open' : '')}>{show && children}
    {!keepOpen && <button className="tools-toggle" aria-label={show ? 'Hide the card buttons' : 'Show the card buttons'} title={show ? 'Hide the buttons' : 'Bode, send to CBS, dock, remove'} onClick={() => setOpen(o => !o)}>{show ? '›' : '‹'}</button>}</span>;
}
// Plot cards live in their own layer, scaled with the canvas but drawn above the block headers.
const PIN_W = 252, PIN_H = 150, MUTED = '#b3bab7';
// Disturbance rejection (tour): a realistic shock size instead of +1 (Claude's choices, a fifth of each historical
// shock where there is one; the linear response scales with it).
const SHOCK_STEP: Record<string, [number, string]> = {
  d_crisis: [-10, '−10 (a fifth of the crisis depth)'], d_loans: [-4, '−4 (a fifth of the lending drop)'], d_covid: [16, '+16 (a fifth of the Covid shock)'],
  d_interest: [0.01, '+1 percentage point'], d_income: [-10, '−10'], d_mortgages: [-1, '−1'],
};
const stepSize = (steps: NonNullable<StepData>): [number, string] => steps.inputId === 'd_interest' ? [0.01, '+1 percentage point'] : steps.reject && steps.inputId && SHOCK_STEP[steps.inputId] ? SHOCK_STEP[steps.inputId] : [1, '+1'];
// Year-on-year step response (no own response): from the house-price step, 100·(Δp(t) − Δp(t − 1 yr)) / p₀,
// p₀ the price at the start of the run; Δp is zero before the step.
const PRICE_KEY = 'signal:y_price';
const yoyStep = (t: number[], dp: number[], p0: number) => t.map((ti, i) => { const back = ti - 1; let j = 0; while (j < t.length - 1 && t[j + 1] <= back) j++;
  const prev = back < t[0] ? 0 : dp[j]; return 100 * (dp[i] - prev) / p0; });
export type StepData = { input: string; inputId?: string; reject?: boolean; responses: Record<string, { t?: number[]; y?: number[]; error?: string }>; open?: Record<string, { t?: number[]; y?: number[]; error?: string }> } | null;
// Canvas pickers (guided tour, 12 Nov 2026): the inputs the story needs, on the blocks they belong to, so everything
// can be done on the canvas. Drawn in screen pixels at the block's place, so they stay readable at any zoom.
// Shown only once their block is clicked (opened or selected), or when the guided tour points at them (Jesse, 11 Nov 2026).
type ChipCtx = { update: (patch: Partial<Scenario>) => void; stepping: boolean; stepInput: string; setStepInput: (id: string) => void; showCtrl: boolean; showMarket: boolean };
const subsidyName = (s: Scenario) => s.subsidy_scale === 0 ? 'none' : s.subsidy_path === 'step' ? 'one step' : s.subsidy_path === 'staircase' ? 'phase-out' : s.subsidy_scale === 10 ? 'compare with CPB' : s.subsidy_scale === 1 ? 'historical' : `historical × ${s.subsidy_scale}`;
const incomeName = (s: Scenario) => s.income_path === 'historical' ? 'historical' : s.income_growth_pct === 0 ? 'constant' : `grows ${+s.income_growth_pct.toFixed(2)}% a year`;
function CanvasChips({ nodes, scenario: s, chips, map }: { nodes: Node[]; scenario: Scenario; chips: ChipCtx; map: MapData }) {
  const [tx, ty, k] = useStore(st => st.transform);
  const [open, setOpen] = useState<string | null>(null), layer = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!open) return; const close = () => setOpen(null); window.addEventListener('click', close); return () => window.removeEventListener('click', close); }, [open]);
  const rect = (id: string) => { const n = nodes.find(x => x.id === id); return n ? { x: n.position.x, y: n.position.y, w: (n.data as BlockData).width, h: (n.data as BlockData).height } : null; };
  const scr = (x: number, y: number) => ({ left: x * k + tx, top: y * k + ty });
  const ctrl = chips.showCtrl ? rect('controller') : null, sys = chips.showMarket ? rect('system') : null;
  // a picker in the lower half of the canvas opens its menu upwards, so it stays on screen
  const upAt = (y: number) => y > (layer.current?.clientHeight ?? 800) * 0.45;
  const menu = (id: string, label: string, value: string, body: React.ReactNode, y: number, extra?: React.ReactNode) => <div className="chip-wrap" data-guide={`chip-${id}`}>
    <button className={'chip' + (open === id ? ' on' : '')} aria-expanded={open === id} onClick={e => { e.stopPropagation(); setOpen(o => o === id ? null : id); }}>{label}: <b>{value}</b> <ChevronDown size={13}/></button>{extra}
    {open === id && <div className={'chip-menu' + (upAt(y) ? ' up' : '')} role="menu" onClick={e => e.stopPropagation()}>{body}</div>}</div>;
  const opt = (label: string, active: boolean, act: () => void, note?: string, keep?: boolean) => <button role="menuitemradio" aria-checked={active} data-opt={label} className={'chip-opt' + (active ? ' on' : '')} onClick={() => { act(); if (!keep) setOpen(null); }}><span>{label}</span>{note && <small>{note}</small>}</button>;
  const set = (patch: Partial<Scenario>) => () => chips.update(patch);
  const stair = s.subsidy_path === 'staircase' && s.subsidy_scale > 0, shocksOn = s.crisis_scale > 0 || s.covid_scale > 0;
  // the lending crisis shock gives no response in the linear model (all plots flat), so it is not offered as a step
  const stepList = [...map.disturbances.filter(d => d.id !== 'd_loans').map(d => ({ id: d.id, label: d.label })), ...(s.feedback ? [{ id: 'y_reference', label: 'Target r (Parliament)' }] : [])];
  const ctrlY = ctrl ? (ctrl.y + ctrl.h) * k + ty : 0, sysY = sys ? (sys.y + sys.h) * k + ty : 0;
  return <div className="chip-layer" ref={layer}>
    {ctrl && <div className="chip-row" style={{ ...scr(ctrl.x + ctrl.w / 2, ctrl.y + ctrl.h), transform: 'translate(-50%, 10px)' }}>
      {!s.feedback ? menu('subsidy', 'Subsidy path', subsidyName(s), <>
        {opt('None', s.subsidy_scale === 0, set(NO_SUBSIDY), 'no owner-occupied subsidy')}
        {opt('One step', s.subsidy_path === 'step' && s.subsidy_scale > 0, set(ONE_STEP), 'from 0 to 20 in 2005')}
        {opt('Phase-out', stair, set(PHASE(stair ? s.phase_steps : 20)), '30 removed 2005–2015, in equal steps', true)}
        {opt('Historical', s.subsidy_path === 'historical' && s.subsidy_scale === 1, set({ subsidy_path: 'historical', subsidy_scale: 1 }), 'the netlist path')}
        {opt('Compare with CPB', s.subsidy_path === 'historical' && s.subsidy_scale === 10, set(CPB_PEAKS), 'historical × 10, income fitted to the CPB peaks; bank and shocks off')}
      </>, ctrlY, stair && <label className="chip chip-slider" data-opt="steps" onClick={e => e.stopPropagation()}>Steps <output>{s.phase_steps}</output><input type="range" min={1} max={20} step={1} value={s.phase_steps} aria-label="Number of phase-out steps" onChange={e => chips.update({ phase_steps: Number(e.target.value) })}/></label>) : <div className="chip-wrap" data-guide="chip-controller"><div className="chip seg" role="group" aria-label="Rule"><span>Rule</span>
        {(['zn', 'hinf'] as const).map(c => <button key={c} data-opt={c} className={s.controller === c ? 'on' : ''} aria-pressed={s.controller === c} onClick={e => { e.stopPropagation(); chips.update({ controller: c }); }}>{c === 'zn' ? 'Ziegler–Nichols' : 'H∞'}</button>)}
        {s.controller !== 'zn' && s.controller !== 'hinf' && <em>custom</em>}</div></div>}
      {s.feedback && <div className="chip-wrap" data-guide="chip-share"><div className="chip seg" role="group" aria-label="Second goal: rental share"><span>Rental share</span>
        <button data-opt="off" className={!s.share_control ? 'on' : ''} aria-pressed={!s.share_control} onClick={e => { e.stopPropagation(); chips.update({ share_control: false }); }}>Free</button>
        <button data-opt="on" className={s.share_control ? 'on' : ''} aria-pressed={s.share_control} title="Add a second PID controller: it holds the rental share at its target by moving money between the owner-occupied and the rental subsidy (MIMO: two inputs, two outputs)" onClick={e => { e.stopPropagation(); chips.update({ share_control: true }); }}>+ PID</button></div>
        {s.share_control && <label className="chip chip-slider" data-opt="target" onClick={e => e.stopPropagation()}>Target <output>{s.share_target_pct.toFixed(1)}%</output><input type="range" min={15} max={25} step={0.5} value={s.share_target_pct} aria-label="Rental-share target" onChange={e => chips.update({ share_target_pct: Number(e.target.value) })}/></label>}</div>}
    </div>}
    {sys && <div className="chip-row" style={{ ...scr(sys.x, sys.y + sys.h), transform: 'translate(0, 10px)' }}>
      {menu('income', 'Income', incomeName(s), <>
        {opt('Constant', s.income_path === 'stable' && s.income_growth_pct === 0, set(FLAT))}
        {opt('Grows 2% a year', s.income_path === 'stable' && s.income_growth_pct === 2, set(GROWTH), 'from 80 in 1996')}
        {opt('Historical', s.income_path === 'historical', set({ income_path: 'historical', income_scale: 1 }), 'the netlist path')}
      </>, sysY)}
      {chips.stepping ? menu('shocks', 'Step in', stepList.find(d => d.id === chips.stepInput)?.label ?? chips.stepInput, <>{stepList.map(d => <span key={d.id} data-opt={d.id}>{opt(d.label, chips.stepInput === d.id, () => chips.setStepInput(d.id))}</span>)}</>, sysY)
        : menu('shocks', 'Shocks', shocksOn ? 'historical' : 'none', <>
          {opt('None', !shocksOn, set(NO_SHOCKS), 'no crisis, no Covid')}
          {opt('Historical', shocksOn && s.mortgage_scale === SHOCKS_CBS.mortgage_scale, set(SHOCKS_CBS), 'crisis, Covid, interest, mortgages, income: every input fitted to CBS, bank on')}
        </>, sysY)}
      <div className="chip-wrap" data-guide="chip-bank"><button className={'chip' + (s.bank ? ' on' : '')} aria-pressed={s.bank} onClick={e => { e.stopPropagation(); chips.update({ bank: !s.bank }); }}>Bank: <b>{s.bank ? 'on' : 'off'}</b></button></div>
    </div>}
  </div>;
}
function PinLayer({ map, probes, result, at, fallback, steps, lines = {} }: { map: MapData; probes: ProbeState; result: Result | null; at: number; fallback: Record<string, XY>; steps?: StepData; lines?: Record<string, Point[]> }) {
  const [tx, ty, k] = useStore(s => s.transform);
  const [live, setLive] = useState<{ id: string; x: number; y: number } | null>(null);
  // the card last clicked or dragged lies on top; the outputs (price, year-on-year) lie above the other plots
  const [front, setFront] = useState('');
  const [size, setSize] = useState<Record<string, { w: number; h: number }>>({});  // card sizes in model units, kept while the canvas lives
  const resize = (id: string, start: { w: number; h: number }) => (e: React.PointerEvent) => {
    e.stopPropagation(); e.preventDefault(); const el = e.currentTarget as HTMLElement; el.setPointerCapture(e.pointerId);
    const x0 = e.clientX, y0 = e.clientY;
    const move = (m: PointerEvent) => setSize(old => ({ ...old, [id]: { w: Math.max(180, start.w + (m.clientX - x0) / k), h: Math.max(110, start.h + (m.clientY - y0) / k) } }));
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up);
  };
  const DEFAULT: Record<string, { w: number; h: number }> = { probe: probes.cardSize ?? { w: PIN_W, h: PIN_H }, cbs: probes.cardSize ? { w: probes.cardSize.w * 1.3, h: probes.cardSize.h } : { w: 372, h: 200 }, bode: { w: 284, h: 210 }, sens: { w: 284, h: 260 } };
  const sz = (id: string, kind: string) => size[id] ?? DEFAULT[kind];
  const handle = (id: string, kind: string) => <span className="card-resize" title="Drag to resize" aria-label="Resize" style={{ width: 18 / k, height: 18 / k }} onPointerDown={resize(id, sz(id, kind))}/>;
  const rf = useReactFlow();
  // Cards sit outside the zoom pane, so zoom around the pointer ourselves when the wheel turns over a card.
  const wheel = (e: React.WheelEvent) => {
    const box = (e.currentTarget as HTMLElement).closest('.react-flow')!.getBoundingClientRect(), px = e.clientX - box.left, py = e.clientY - box.top;
    const k2 = Math.min(4, Math.max(.1, k * Math.exp(-e.deltaY * .002)));
    rf.setViewport({ x: px - (px - tx) * k2 / k, y: py - (py - ty) * k2 / k, zoom: k2 });
  };
  const drag = (id: string, start: XY) => (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.stopPropagation(); const el = e.currentTarget as HTMLElement; el.setPointerCapture(e.pointerId);
    const x0 = e.clientX, y0 = e.clientY; let last = start;
    const move = (m: PointerEvent) => { last = { x: start.x + (m.clientX - x0) / k, y: start.y + (m.clientY - y0) / k }; setLive({ id, ...last }); };
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); probes.setPos(id, last); setLive(null); };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up);
  };
  const at_ = (id: string, i = 0): XY => (live?.id === id ? live : probes.pos[id] ?? fallback[id] ?? { x: 0, y: i * (PIN_H + 20) });
  const charts = probes.charts.map((c, i) => {
    const id = c.id, pos = at_(id, i), base = probes.pos[id] ?? fallback[id] ?? { x: 0, y: 0 };
    // Step mode: the CBS card shows the year-on-year step response (from the price step), not the historical run
    const pr = steps && c.kind === 'cbs' ? steps.responses[PRICE_KEY] : undefined, p0 = result ? readTrace(result, 'I(Construction_cost)')?.[0] : undefined;
    const title = c.kind === 'sens' ? 'S, T, KS · price loop' : c.kind === 'cbs' ? (steps ? 'Year-on-year house price change · step response' : 'Year-on-year house price change · model and CBS') : `Bode · ${probeInfo(map, c.from).f.label} → ${probeInfo(map, c.to).f.label}`;
    const S = sz(id, c.kind), bw = S.w - 16, D = DEFAULT[c.kind], f = Math.max(1, Math.min(S.w / D.w, S.h / D.h));
    return <div key={id} className={'pin-card chart-card ' + c.kind} style={{ left: pos.x, top: pos.y, width: S.w, height: S.h, ['--s' as string]: f }} onPointerDown={drag(id, base)}>{handle(id, c.kind)}
      <div className="pin-head"><strong title={title}>{title}</strong>{c.kind === 'cbs' && <PinTools><button aria-label="Send to the dock" title="Open the CBS sensor in the dock" onClick={probes.openSensor}>⇥</button></PinTools>}<button className="pin-close" aria-label="Remove from the canvas" title="Remove from the canvas" onClick={() => probes.removeChart(id)}>×</button></div>
      {c.kind === 'cbs' && steps && probes.waitingStep ? <small className="muted waiting">Press ▶ to show the response.</small>
      : c.kind === 'cbs' && steps ? (() => {
          if (!pr?.t || !pr.y || !p0) return <small className="muted">{pr?.error ?? 'Computing…'}</small>;
          const [k0] = stepSize(steps), y1 = yoyStep(pr.t, pr.y.map(v => v * k0), p0), po = steps.open?.[PRICE_KEY];
          const g = po?.t && po.y && po.y.length === pr.y.length ? yoyStep(po.t, po.y.map(v => v * k0), p0) : undefined;
          const frac = result && result.year.length > 1 ? at / (result.year.length - 1) : 1, i1 = frac < 1 ? Math.round(frac * (y1.length - 1)) : undefined;
          return <><MiniPlot y={y1} at={i1} label={i1 !== undefined ? `${(frac * pr.t[pr.t.length - 1]).toFixed(1)} yr` : undefined} color="#3f9a1f" w={bw} h={S.h - 64 * f} k={f} ghost={g} ghostColor="#8a9692"/><small>Change in the year-on-year rate after the step, percentage points, {pr.t[pr.t.length - 1].toFixed(0)} years.{g ? ' Grey dashed: without the controller.' : ''}</small></>; })()
      : c.kind === 'cbs' && probes.waiting ? <small className="muted waiting">New settings: press ▶ to run them.</small>
      : c.kind === 'cbs' ? <><YoyBody at={at} color={probes.muted ? MUTED : undefined} k={f} w={bw} h={S.h - 64 * f} year={result?.year} model={result?.scenario.inflation_pct ? result.series.yoy.map(v => v + result.scenario.inflation_pct) : result?.series.yoy} cbs={probes.cbs} lag={probes.lag} cpb={probes.cpb} ghost={probes.compare && !probes.compare.align && probes.compare.result.series.yoy ? probes.compare.result.series.yoy.map(v => v + (probes.compare!.result.scenario.inflation_pct ?? 0)) : undefined} ghost2={probes.compare2?.result.series.yoy ? probes.compare2.result.series.yoy.map(v => v + (probes.compare2!.result.scenario.inflation_pct ?? 0)) : undefined}/><small>Green: model run{probes.compare && !probes.compare.align ? `, ${probes.compare.label}` : ''}{probes.compare2 ? ', green dotted: Ziegler–Nichols PID' : ''}{result ? '' : ' (run the simulation)'}.{probes.cpb ? ' Green dashed: CPB model.' : ''} Grey: CBS index, moved {probes.lag} month{Math.abs(probes.lag) === 1 ? '' : 's'}. % a year.</small></>
      : c.kind === 'sens' ? <SensBody k={f} w={bw} h={S.h - 100 * f} K={probes.ctx.K} filtered={probes.ctx.filtered} settling={probes.ctx.settling} overshoot={probes.ctx.overshoot}/>
        : <BodeBody k={f} w={bw} h={S.h - 74 * f} input={probeInput(map, c.from)!} output={probeInfo(map, c.to).step!} feedback={probes.ctx.feedback} K={probes.ctx.K} filtered={probes.ctx.filtered}/>}</div>;
  });
  const links = probes.charts.filter(c => c.kind === 'bode').flatMap(c => { if (c.kind !== 'bode') return []; const b = at_(c.id), m = { x: b.x + PIN_W / 2, y: b.y };
    return ([[c.from, 'in'], [c.to, 'out']] as const).map(([p, role]) => { const a = at_(`pin-${probeKey(p)}`); return <g key={c.id + role}><line x1={a.x + PIN_W / 2} y1={a.y + PIN_H} x2={m.x} y2={m.y} className="bode-link"/><text x={(a.x + PIN_W / 2 + m.x) / 2 + 6} y={(a.y + PIN_H + m.y) / 2} className="bode-link-label">{role}</text></g>; }); });
  // Each card is linked to its line: a dot at the point of the line closest to the card, a dashed link to the card's edge.
  // (Not in the guided tour: its cards sit in a row under the loop, far from their lines, and carry their titles.)
  const leads = probes.cardSize ? [] : probes.pins.flatMap(p => {
    const id = `pin-${probeKey(p)}`, line = lines[p.flow]; if (!line || line.length < 2) return [];
    const pos = live?.id === id ? live : probes.pos[id] ?? fallback[id]; if (!pos) return [];
    const S = sz(id, 'probe'), c: Point = [pos.x + S.w / 2, pos.y + S.h / 2];
    let q: Point = line[0], best = Infinity;
    for (let j = 1; j < line.length; j++) { const a = line[j - 1], b = line[j], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((c[0] - a[0]) * dx + (c[1] - a[1]) * dy) / l2)), m: Point = [a[0] + t * dx, a[1] + t * dy], d = Math.hypot(m[0] - c[0], m[1] - c[1]);
      if (d < best) { best = d; q = m; } }
    const r: Point = [Math.min(Math.max(q[0], pos.x), pos.x + S.w), Math.min(Math.max(q[1], pos.y), pos.y + S.h)];
    if (Math.hypot(r[0] - q[0], r[1] - q[1]) < 2) return [];
    return [<g key={'lead-' + id} className="pin-lead"><line x1={q[0]} y1={q[1]} x2={r[0]} y2={r[1]} strokeWidth={1.6 / k} strokeDasharray={`${6 / k} ${4 / k}`}/><circle cx={q[0]} cy={q[1]} r={4.5 / k}/></g>];
  });
  return <div className="pin-layer" style={{ transform: `translate(${tx}px, ${ty}px) scale(${k})` }} onWheel={wheel}><svg className="pin-links">{links}{leads}</svg>{charts}{probes.pins.map((p, i) => {
    const id = `pin-${probeKey(p)}`, info = probeInfo(map, p), base = probes.pos[id] ?? fallback[id] ?? { x: 0, y: i * (PIN_H + 20) }, pos = live?.id === id ? live : base;
    // Before the first Play after a run, the simulation plots are grey; Play (or the year slider) colours them.
    // slide W: the two crisis-shock cards draw the shock of the W run (drawn only; all else is the fitted run)
    const src = probes.shockShow && (p.flow === 'd_crisis' || p.flow === 'd_loans') ? probes.shockShow : result;
    const y = src && info.signal ? readTrace(src, info.signal) : undefined, color = probes.muted && !steps ? MUTED : info.color;
    const st = steps && (info.step ? steps.responses[`${info.step.kind}:${info.step.id}`] : { error: 'An input: no step response' });
    const sent = probes.sensed.some(q => probeKey(q) === probeKey(p));
    const S = sz(id, 'probe'), f = Math.max(1, Math.min(S.w / PIN_W, S.h / PIN_H)), pw = S.w - 12 * f, ph = S.h - (steps ? 40 : 58) * f;
    // Step response with Play: the year slider's progress runs the step through its own 15 years (no marker at the end)
    const frac = result && result.year.length > 1 ? at / (result.year.length - 1) : 1, tStep = Object.values(steps?.responses ?? {}).find(r => r.t)?.t;
    const sAt = (n: number) => frac < 1 ? Math.round(frac * (n - 1)) : undefined, sLab = (i?: number) => i !== undefined && tStep ? `${(frac * tStep[tStep.length - 1]).toFixed(1)} yr` : undefined;
    return <div key={id} data-pin={probeKey(p)} className={'pin-card' + (steps ? ' step-mode' : '')} style={{ left: pos.x, top: pos.y, width: S.w, ...(p.q === 's' && map.loop?.[p.flow]?.note ? { minHeight: S.h } : { height: S.h }), ['--s' as string]: f, zIndex: front === id ? 3 : p.flow === 'y_yoy' || p.flow === 'y_price' ? 2 : 1 }} onPointerDownCapture={() => setFront(id)} onPointerDown={drag(id, base)}>{handle(id, 'probe')}
      <div className="pin-head"><strong title={info.title}>{steps ? `${info.f.label} · step response` : info.title}</strong><PinTools keepOpen={!!probes.bodeFrom}>
        {(() => { const from = probes.bodeFrom, isFrom = !!from && probeKey(from) === probeKey(p), canIn = !!probeInput(map, p);
          return from ? <button className={isFrom ? 'on' : 'bode-ready'} title={isFrom ? 'Cancel the Bode plot' : 'Bode plot from the marked input to this signal'} aria-label={isFrom ? 'Cancel Bode' : 'Bode to here'}
              onClick={() => { if (isFrom) probes.setBodeFrom(null); else { const a = probes.pos[`pin-${probeKey(from)}`] ?? fallback[`pin-${probeKey(from)}`] ?? pos; probes.addBode(from, p, { x: (a.x + pos.x) / 2 + 20, y: (a.y + pos.y) / 2 + PIN_H + 30 }); } }}>{isFrom ? 'in ✕' : 'Bode→'}</button>
            : <button disabled={!canIn} title={canIn ? 'Use as the input of a Bode plot, then click Bode→ on the output card' : 'An effort or an output cannot be an input'} aria-label="Bode from here" onClick={() => probes.setBodeFrom(p)}>Bode</button>; })()}
        <button className={sent ? 'on' : ''} aria-label={sent ? 'Stop sending to CBS' : 'Send to CBS'} title={sent ? 'Stop sending to CBS' : 'Send to CBS'} onClick={() => probes.sense(p)}>→CBS</button>
        <button aria-label="Send to the dock" title="Send to the dock" onClick={() => probes.dock(p)}>⇥</button>
        </PinTools><button className="pin-close" aria-label="Remove from the canvas" title="Remove from the canvas" onClick={() => probes.unpin(p)}>×</button></div>
      {probes.waitingStep && steps ? <small className="muted waiting">Press ▶ to show the response.</small>
      : probes.waiting && !steps ? <small className="muted waiting">New settings: press ▶ to run them.</small>
      : steps && p.flow === steps.inputId && p.q === 's' ? (() => {
          const [k0, unit] = stepSize(steps), tt = Object.values(steps.responses).find(r => r.t)?.t;
          if (!tt) return <small className="muted">Computing…</small>;
          const y0 = tt.map(t => t < 0 ? 0 : k0);
          const i0 = sAt(y0.length + 1);
          return <><MiniPlot y={[0, ...y0]} at={i0} label={sLab(i0)} color={color} w={pw} h={ph} k={f}/></>; })()
      : steps && p.flow === 'y_yoy' && p.q === 's' ? (() => {
          const pr = steps.responses[PRICE_KEY], po = steps.open?.[PRICE_KEY], p0 = result ? readTrace(result, 'I(Construction_cost)')?.[0] : undefined;
          if (!pr?.t || !pr.y || !p0) return <small className="muted">{pr?.error ?? 'Computing…'}</small>;
          const [k0] = stepSize(steps), y1 = yoyStep(pr.t, pr.y.map(v => v * k0), p0), g = po?.t && po.y && po.y.length === pr.y.length ? yoyStep(po.t, po.y.map(v => v * k0), p0) : undefined, i1 = sAt(y1.length);
          return <><MiniPlot y={y1} at={i1} label={sLab(i1)} color={color} w={pw} h={ph} k={f} ghost={g} ghostColor="#8a9692"/></>; })()
      : steps ? st?.y ? (() => {
          // The interest rate is a fraction (0.01 = 1%): its step is shown per +1 percentage point, not per +1.
          const [k0, unit] = stepSize(steps);
          const y1 = st.y!.map(v => v * k0), so = steps.open && info.step ? steps.open[`${info.step.kind}:${info.step.id}`]?.y : undefined;
          const g = so && so.length === y1.length ? so.map(v => v * k0) : undefined;
          const i1 = sAt(y1.length), lab1 = sLab(i1);
          return <><MiniPlot y={y1} at={i1} label={lab1} color={color} w={pw} h={ph} k={f} ghost={g} ghostColor="#8a9692"/></>; })() : <small className="muted">{st?.error ?? 'Computing…'}</small>
        : y ? (() => {
          // Proposed parameters (identification): new R, L, C values also move the level, so the proposed run is
          // shifted to start where the current run starts; then only the dynamics differ.
          // or (tour) the open-loop run with the historical subsidies, grey dashed, as it is.
          // inputs (disturbances, the target r) and the gap e have no open-loop counterpart: no comparison line on their cards
          const cmp = p.flow.startsWith('d_') || p.flow === 'y_reference' || p.flow === 'y_error' ? null : probes.compare, g0 = cmp && info.signal ? readTrace(cmp.result, info.signal) : undefined;
          const g = g0 && g0.length === y.length ? (cmp!.align ? g0.map(v => v - g0[0] + y[0]) : g0) : undefined;
          const c2 = cmp && !(p.flow === 'owner_subsidy' && probes.cardSize === GUIDE_CARD) ? probes.compare2 : null,  // guided tour: no ZN dots on the subsidy card
          g2r = c2 && info.signal ? readTrace(c2.result, info.signal) : undefined, g2 = g2r && g2r.length === y.length ? g2r : undefined;
          if (p.flow === 'y_yoy' && p.q === 's') {
            // year-on-year: the CBS index as grey bars behind it, as in the CBS card (model + inflation for the nominal index)
            const infl = result!.scenario.inflation_pct ?? 0, gy = cmp && cmp.result.series.yoy ? cmp.result.series.yoy.map(v => v + infl) : undefined, gz = c2 && c2.result.series.yoy ? c2.result.series.yoy.map(v => v + infl) : undefined;
            return <><YoyBody at={at} color={color} k={f} w={pw} h={ph} year={result!.year} model={y.map(v => v + infl)} cbs={probes.cbs} lag={probes.lag} cpb={probes.cpb} ghost={gy} ghost2={gz}/><small>{result!.year[at].toFixed(1)}: <b>{fmt(y[at] + infl)}</b>{gy ? <span className="ghost-note" style={{ color: '#8a9692' }}> · {cmp!.label}: {fmt(gy[at])}</span> : null}{gz ? <span className="ghost-note" style={{ color }}> · Ziegler–Nichols PID (dotted): {fmt(gz[at])}</span> : null}{probes.cbs ? <span className="ghost-note" style={{ color: '#8a9692' }}> · grey bars: CBS</span> : null}</small></>;
          }
          const pair = p.q === 's' ? loopSig(map, p.flow)?.pair : undefined, y2 = pair ? readTrace(result!, pair.signal) : undefined;
          const th = pair ? loopSig(map, p.flow)?.third : undefined, y3 = th ? readTrace(result!, th.signal) : undefined;
          if (pair && y2) return <><MiniPlot y={y} at={at} color={color} w={pw} h={ph} k={f} label={result!.year[at].toFixed(1)} second={y2} secondColor={color === MUTED ? MUTED : pair.color} third={y3} thirdColor={color === MUTED ? MUTED : th?.color}/><small>{result!.year[at].toFixed(1)}: <b style={{ color }}>{pair.first ?? 'rent'} {fmt(y[at])}</b> · <b style={{ color: color === MUTED ? MUTED : pair.color }}>{pair.label} {fmt(y2[at])}</b>{th && y3 ? <> · <b style={{ color: color === MUTED ? MUTED : th.color }}>{th.label} {fmt(y3[at])}</b></> : null}{!pair.first && <> · renters pay {fmt(Math.abs(y[at] / y2[at] - 1) * 100)}% {y[at] >= y2[at] ? 'more' : 'less'}</>}</small></>;
          return <><MiniPlot y={y} at={at} color={color} w={pw} h={ph} k={f} label={result!.year[at].toFixed(1)} ghost={g} ghostColor={cmp?.color} ghost2={g2} ghost2Color={color}/><small>{result!.year[at].toFixed(1)}: <b>{map.loop && p.q === 's' && map.loop[p.flow] ? y[at].toFixed(2) : fmt(y[at])}</b>{g ? <span className="ghost-note" style={{ color: cmp!.color }}> · {cmp!.label}: {fmt(g[at])}</span> : null}{g2 ? <span className="ghost-note" style={{ color }}> · Ziegler–Nichols PID (dotted): {fmt(g2[at])}</span> : null}</small>{p.q === 's' && map.loop?.[p.flow]?.note ? <p className="card-note">{map.loop[p.flow].note}</p> : null}</>;
        })() : <small className="muted">Run the simulation to see this signal.</small>}</div>;
  })}</div>;
}
const nodeTypes = { block: Block };

// Header bars of open blocks, drawn in screen space so they keep one size and stay visible when zoomed in:
// a header sits on its block's top edge and, once that edge scrolls out of view, sticks to the top of the canvas
// (below the headers of the blocks that contain it) until the block itself leaves the view.
const HEAD_FLOW = 30, HEAD_MAX = 30; // header height in model units, and its cap in screen pixels
const DEPTH: Record<string, number> = { 'system-group': 0, controller: 0, 'sub-group': 1, agent: 2 };
function StickyHeaders({ nodes, lab = 1 }: { nodes: Node<BlockData>[]; lab?: number }) {
  const [tx, ty, k] = useStore(s => s.transform), W = useStore(s => s.width), H = useStore(s => s.height);
  return <div className="sticky-heads">{nodes.filter(n => n.data.open).map(n => {
    const d = n.data, depth = DEPTH[d.tone.split(' ')[0]] ?? 0, HEAD_H = Math.min(HEAD_MAX * lab, HEAD_FLOW * lab * k);
    const left = tx + n.position.x * k, top = ty + n.position.y * k, right = left + d.width * k, bottom = top + d.height * k;
    const x0 = Math.max(left, 0), x1 = Math.min(right, W);
    if (x1 - x0 < 20 || bottom < depth * HEAD_H + HEAD_H || top > H) return null;
    const y = Math.min(Math.max(top, depth * HEAD_H), bottom - HEAD_H);
    return <div key={n.id} className={`sticky-head ${d.tone}`} style={{ left: x0, top: y, width: x1 - x0, height: HEAD_H, zIndex: 10 + depth, fontSize: HEAD_H * .5, padding: `0 ${HEAD_H * .3}px` }}>
      <strong>{d.label.replace('\n', ' ')}</strong>
      {d.toggle && HEAD_H > 14 && <button className="toggle" style={{ width: HEAD_H * .7, height: HEAD_H * .7 }} aria-label={`Collapse ${d.label}`} onClick={e => { e.stopPropagation(); d.toggle!(); }}><Minus size={13}/></button>}
    </div>;
  })}</div>;
}

// ---------- edges
type RailData = { points: Point[]; color: string; name: string; value?: React.ReactNode; selected?: boolean; labelT: number; side: number; pick: (e?: React.MouseEvent) => void; menu?: (e: React.MouseEvent) => void; probe?: (q: 'e' | 'f', e: React.MouseEvent) => void; probed?: ('e' | 'f')[]; animate?: boolean };
function PortPair({ a, b, ra, rb, color }: { a: Point; b: Point; ra: Point; rb: Point; color: string }) {
  const e1 = along(a, b, 11), e2 = along(ra, rb, 11), em: Point = [(e1[0] + e2[0]) / 2, (e1[1] + e2[1]) / 2], f = along(a, b, 27), t1 = along(a, b, 39), t2 = along(ra, rb, 39);
  return <g className="pair-mark"><path d={`M${e1[0]} ${e1[1]}L${e2[0]} ${e2[1]}`} stroke={color} strokeWidth={1.2}/>
    <circle cx={em[0]} cy={em[1]} r={6.2} fill="#fff" stroke={color} strokeWidth={1.2}/><text x={em[0]} y={em[1] + 3} fill={color}>e</text>
    <circle cx={f[0]} cy={f[1]} r={6.2} fill="#fff" stroke={color} strokeWidth={1.2}/><text x={f[0]} y={f[1] + 3} fill={color}>f</text>
    <circle cx={t1[0]} cy={t1[1]} r={2.6} fill="#fff" stroke={color}/><circle cx={t2[0]} cy={t2[1]} r={2.6} fill="#fff" stroke={color}/></g>;
}
function longest(points: Point[]) { let k = 1; for (let i = 2; i < points.length; i++) if (len(points[i - 1], points[i]) > len(points[k - 1], points[k])) k = i; return k; }
function Rail({ id, data }: EdgeProps<Edge<RailData>>) {
  const d = data!, back = offset(d.points, 12 * d.side), n = d.points.length, k = longest(d.points);
  const [p, q] = [d.points[k - 1], d.points[k]], mid = along(p, q, len(p, q) * d.labelT), dir = along([0, 0], [q[0] - p[0], q[1] - p[1]], 1), vertical = Math.abs(dir[1]) > .5;
  const tri = along(p, q, len(p, q) * (d.labelT < .5 ? .62 : .38)), angle = Math.atan2(dir[1], dir[0]) * 180 / Math.PI;
  // Name on the flow-rail side, away from the return rail.
  const lx = vertical ? mid[0] - 8 * Math.sign(back[k][0] - p[0] || 1) : mid[0], ly = vertical ? mid[1] : mid[1] - 8 * Math.sign(back[k][1] - p[1] || 1) + (Math.sign(back[k][1] - p[1]) > 0 ? 0 : 9);
  const labelAngle = vertical ? -90 : 0;
  // Horizontal names sit at alternating ends of their segment, so parallel pairs never collide.
  // Horizontal names go to the far left or far right of the whole connection, at that end's height.
  const near = d.labelT < .5, ends = [d.points[0], d.points[n - 1]], flat = !vertical && d.points[0][1] === d.points[1][1] && d.points[n - 1][1] === d.points[n - 2][1];
  const pick = flat ? (near ? ends.reduce((a, b) => a[0] < b[0] ? a : b) : ends.reduce((a, b) => a[0] > b[0] ? a : b)) : null;
  const left = Math.min(p[0], q[0]), right = Math.max(p[0], q[0]);
  const anchor = vertical ? 'middle' : near ? 'start' : 'end';
  const tx = vertical ? lx : pick ? pick[0] + (near ? 48 : -48) : near ? left + 48 : right - 48;
  const ty = pick ? pick[1] - 8 * Math.sign(back[d.points.indexOf(pick) === 0 ? 0 : n - 1][1] - pick[1] || 1) + (Math.sign(back[d.points.indexOf(pick) === 0 ? 0 : n - 1][1] - pick[1]) > 0 ? 0 : 9) : ly;
  return <g className={'rail' + (d.selected ? ' selected' : '')}>
    <path d={toPath(back)} fill="none" stroke={d.color} strokeWidth={1.4} strokeOpacity={.75}/>
    <BaseEdge id={id} path={toPath(d.points)} style={{ stroke: d.color, strokeWidth: d.selected ? 4.2 : 2.4 }}/>
    {d.animate && <path d={toPath(d.points)} className="flow-dots" stroke={d.color}/>}
    <path d="M-6 -5L5 0L-6 5Z" fill={d.color} transform={`translate(${tri[0]} ${tri[1]}) rotate(${angle})`}/>
    <PortPair a={d.points[0]} b={d.points[1]} ra={back[0]} rb={back[1]} color={d.color}/><PortPair a={d.points[n - 1]} b={d.points[n - 2]} ra={back[n - 1]} rb={back[n - 2]} color={d.color}/>
    <text className="rail-name" transform={`translate(${tx} ${ty}) rotate(${labelAngle})`} textAnchor={anchor} fill={d.color}>{d.name}{d.value && <tspan className="rail-value" dx={5}>{d.value}</tspan>}</text>
    <path className="rail-hit" d={toPath(d.points)} onClick={d.pick} onContextMenu={d.menu}/><path className="rail-hit" d={toPath(back)} onClick={d.pick} onContextMenu={d.menu}/>
    {d.probe && ([[d.points[0], d.points[1], back[0], back[1]], [d.points[n - 1], d.points[n - 2], back[n - 1], back[n - 2]]] as Point[][]).map(([a, b, ra, rb], j) => {
      const e1 = along(a, b, 11), e2 = along(ra, rb, 11), em: Point = [(e1[0] + e2[0]) / 2, (e1[1] + e2[1]) / 2], f = along(a, b, 27);
      return <g key={j}>{(['e', 'f'] as const).map(q => { const c = q === 'e' ? em : f; return <circle key={q} cx={c[0]} cy={c[1]} r={7.5} className={'probe-hit' + (d.probed?.includes(q) ? ' on' : '')} stroke={d.color} onClick={e => { e.stopPropagation(); d.probe!(q, e); }}><title>{q === 'e' ? 'Effort e: click to plot' : 'Flow f: click to plot'}</title></circle>; })}</g>;
    })}
  </g>;
}
type SignalData = { points: Point[]; lab?: number; color: string; letter: string; name?: string; sub?: string; value?: React.ReactNode; markAt?: number; markDist?: number; dashed?: boolean; selected?: boolean; pick?: (e?: React.MouseEvent) => void; labelSide?: 'right' | 'left' | 'above' | 'below'; target?: Selection; menu?: (e: React.MouseEvent) => void; switchAt?: Point; switchOpen?: boolean; onSwitch?: () => void; animate?: boolean };
function Signal({ id, data }: EdgeProps<Edge<SignalData>>) {
  const d = data!, k = d.markAt ?? 1, [p, q] = [d.points[k - 1], d.points[k]], m = along(p, q, d.markDist ?? Math.min(len(p, q) / 2, 60));
  const side = d.labelSide ?? (Math.abs(q[0] - p[0]) < .5 ? 'right' : 'above');
  const L = d.lab ?? 1; // label size factor (Label size slider)
  const lx = side === 'right' ? m[0] + 13 : side === 'left' ? m[0] - 13 : m[0], ly = side === 'above' ? m[1] - (d.value ? 26 * L : 13 * L) : side === 'below' ? m[1] + 22 * L : m[1] - 2;
  return <g className={'signal' + (d.selected ? ' selected' : '')}>
    <defs><marker id={`s-${id}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto"><path d="M0 0 10 5 0 10z" fill={d.color}/></marker></defs>
    <BaseEdge id={id} path={toPath(d.points)} markerEnd={`url(#s-${id})`} style={{ stroke: d.color, strokeWidth: d.selected ? 3.2 : 1.6, strokeDasharray: d.dashed ? '6 5' : undefined }}/>
    {d.animate && !d.dashed && <path d={toPath(d.points)} className="flow-dots small" stroke={d.color}/>}
    <circle cx={m[0]} cy={m[1]} r={8} fill="#fff" stroke={d.color} strokeWidth={1.3}/><text className="sig-letter" x={m[0]} y={m[1] + 3.6} fill={d.color}>{d.letter}</text>
    {d.name && <text className="sig-name" style={{ fontSize: 11.5 * L }} x={lx} y={ly} textAnchor={side === 'right' ? 'start' : side === 'left' ? 'end' : 'middle'} fill={d.color}>{d.name}{d.value && <tspan className="sig-value" style={{ fontSize: 11 * L }} x={lx} dy={13 * L}>{d.value}</tspan>}</text>}
    {d.sub && <text className="sig-sub" style={{ fontSize: 11 * L }} x={side === 'right' ? m[0] - 13 : side === 'left' ? m[0] + 13 : m[0]} y={side === 'above' ? m[1] + 22 * L : side === 'below' ? m[1] - 13 * L : m[1] + 4} textAnchor={side === 'right' ? 'end' : side === 'left' ? 'start' : 'middle'} fill={d.color}>{d.sub}</text>}
    {d.pick && <path className="rail-hit" d={toPath(d.points)} onClick={d.pick} onContextMenu={d.menu}/>}
    {d.switchAt && <g className="loop-switch" role="switch" aria-checked={!d.switchOpen} aria-label="Feedback loop switch" tabIndex={0} onClick={e => { e.stopPropagation(); d.onSwitch?.(); }} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') d.onSwitch?.(); }}>
      <title>{d.switchOpen ? 'Loop open: click to close the feedback loop' : 'Loop closed: click to open the feedback loop'}</title>
      <rect x={d.switchAt[0] - 24} y={d.switchAt[1] - 24} width={48} height={36} fill="#fff" opacity={0.01}/>
      <line x1={d.switchAt[0] - 20} x2={d.switchAt[0] + 20} y1={d.switchAt[1]} y2={d.switchAt[1]} stroke="#fff" strokeWidth={5}/>
      <circle cx={d.switchAt[0] - 14} cy={d.switchAt[1]} r={3} fill="#fff" stroke={d.color} strokeWidth={1.6}/><circle cx={d.switchAt[0] + 14} cy={d.switchAt[1]} r={3} fill="#fff" stroke={d.color} strokeWidth={1.6}/>
      <line x1={d.switchAt[0] - 11} y1={d.switchAt[1]} x2={d.switchAt[0] + (d.switchOpen ? 9 : 11)} y2={d.switchAt[1] - (d.switchOpen ? 14 : 0)} stroke={d.color} strokeWidth={2.2} strokeLinecap="round"/>
      <text className="sig-sub" x={d.switchAt[0]} y={d.switchAt[1] + 22} textAnchor="middle" fill={d.color}>{d.switchOpen ? 'loop open' : 'loop closed'}</text>
    </g>}
  </g>;
}
const edgeTypes = { rail: Rail, signal: Signal };

const TAB: Record<string, 'tl' | 'br' | 'bl'> = { households: 'br', investors: 'br', firms: 'br', bank: 'br', constructors: 'bl' };

const STEP = 1.2; // one click = 20% stronger or weaker (Jesse, 11 Nov 2026: 10% changed too little, ×1.5 went unstable at once)
export const stepPatch = (scenario: Scenario, k: GainKey, up: boolean): Partial<Scenario> => {
  const v = +(scenario[k] * (up ? STEP : 1 / STEP)).toFixed(3), min = k === 'ki' ? 0.01 : 0;
  return k.startsWith('s') ? { [k]: Math.max(min, v) } : { controller: 'custom', [k]: Math.max(min, v) };
};
function GainSteps({ scenario, update, auto }: { scenario: Scenario; update: (patch: Partial<Scenario>) => void; auto?: boolean }) {
  const step = (k: GainKey, up: boolean) => update(stepPatch(scenario, k, up));
  const row = (k: GainKey, name: string) => <div className="gain-step" key={k}><span>{name}</span><output>{scenario[k].toFixed(3)}</output>
    <button className="ghost" aria-label={`${name} down`} onClick={() => step(k, false)}><ChevronDown size={14}/></button><button className="ghost" aria-label={`${name} up`} onClick={() => step(k, true)}><ChevronUp size={14}/></button></div>;
  return <><h4>{scenario.share_control && scenario.feedback ? 'Price PID gains' : 'PID gains'} <small className="muted">model units, ±20% a click</small></h4>
    {row('kp', 'Kp')}{row('ki', 'Ki')}{row('kd', 'Kd')}
    <label className="check"><input type="checkbox" checked={scenario.derivative_filter} onChange={e => update({ controller: 'custom', derivative_filter: e.target.checked })}/> Derivative filter (cycle of 0.5 years)</label>
    {scenario.share_control && scenario.feedback && <><h4>Rental-share PID gains</h4>{row('skp', 'Kp')}{row('ski', 'Ki')}{row('skd', 'Kd')}</>}
    {!scenario.feedback && <p className="muted small">The gains act once the loop switch is closed.</p>}
    <p className="muted small">A step sets the price PID to Custom. {auto ? 'The canvas runs again at once.' : 'Run again to see the effect.'}</p></>;
}
function Inspector({ map, selection, pick, result, pinned, scenario, enter, layer, tf, setTf, update, probes, design, setDesign, onPreview, auto, reject, robustOnly }: { robustOnly?: boolean; onPreview?: (scale: Record<string, number> | null) => void; auto?: boolean; reject?: boolean; map: MapData; selection: Selection; pick: (s: Selection) => void; result: Result | null; pinned: Result | null; scenario: Scenario; enter: (id: string) => void; layer: string; tf: TfPicks; setTf: (t: TfPicks) => void; update?: (patch: Partial<Scenario>) => void; probes?: ProbeActions; design?: Design; setDesign?: (d: Design) => void }) {
  const lines = (signal: string, name: string, color: string): Line[] => {
    if (!result) return [];
    const own = readTrace(result, signal), other = pinned && readTrace(pinned, signal);
    return [...(other ? [{ name: 'Comparison', x: pinned!.year, y: other, color: '#8a9692', dash: 'dash', width: 2 }] : []), ...(own ? [{ name, x: result.year, y: own, color }] : [])];
  };
  const hint = (what: string) => <p className="run-hint">Run the simulation to see {what}.</p>;
  const name = (id: string) => id === 'controller' ? 'Controller' : map.agents[id]?.label ?? id;
  const go = (id: string) => pick({ kind: 'agent', id });
  if (selection.kind === 'robust') return design ? <><Robustness design={{ ...design, K: [scenario.kp, scenario.ki, scenario.kd], filtered: scenario.derivative_filter }} docked only={robustOnly}/>{scenario.feedback && <section className="panel"><NyquistPanel K={[scenario.kp, scenario.ki, scenario.kd]} filtered={scenario.derivative_filter}/></section>}</> : null;
  if (selection.kind === 'ident') return <IdentPanel scenario={scenario} update={update ?? (() => undefined)} onPreview={onPreview} auto={auto}/>;
  if (selection.kind === 'tf') return <TransferPanel input={tf.input} output={tf.output} feedback={scenario.feedback} K={[scenario.kp, scenario.ki, scenario.kd]} filtered={scenario.derivative_filter} swap={() => setTf({ input: tf.output, output: tf.input })} clear={() => setTf({})}/>;
  if (selection.kind === 'probe') {
    const p = probeOf(selection.id), info = probeInfo(map, p), color = p.q === 'f' ? COLOR[info.f.kind] : '#6b4fa0';
    return <><p className="eyebrow">Probe · port {info.f.port?.node}</p><h3>{info.title}</h3>
      <p className="muted small">{p.q === 'f' ? `The flow through the port: ${info.signal}.` : `The effort across the port: ${info.signal}, the node voltage against its return.`} Each port has one effort and one flow.</p>
      {info.signal && result ? <Chart title={info.title} unit={info.unit} height={240} lines={lines(info.signal, info.title, color)}/> : hint('this signal')}
      {probes && <div className="row probe-actions">
        <button className="secondary" onClick={() => probes.pin(p)}>{probes.pinned(p) ? 'Unpin from canvas' : 'Pin on canvas'}</button>
        <button className="secondary" onClick={() => probes.sense(p)}>{probes.sensed(p) ? 'Stop sending to CBS' : 'Send to CBS'}</button></div>}
      <div className="chain"><button onClick={() => pick({ kind: 'probe', id: `${p.flow}:${p.q === 'e' ? 'f' : 'e'}` })}>Show the {p.q === 'e' ? 'flow f' : 'effort e'} of this port</button><button onClick={() => pick({ kind: 'flow', id: p.flow })}>Port details</button></div></>;
  }
  if (selection.kind === 'flow') {
    const f = map.flows.find(x => x.id === selection.id) as Flow;
    const chain = f.chain.filter(n => f.id !== 'owner_subsidy' || (scenario.feedback ? n === 'B§PID' : n !== 'B§PID'));
    return <>
      <p className="eyebrow">{f.kind === 'real' ? 'Goods port' : f.kind === 'policy' ? 'Control signal' : 'Money port'}</p><h3>{f.label}</h3>
      <p className="direction"><button className="link" onClick={() => go(f.source)}>{name(f.source)}</button> → <button className="link" onClick={() => go(f.target)}>{name(f.target)}</button>{f.port && <> · node {f.port.node}</>}</p>
      <p className="muted">{f.description}</p>
      {result ? <><Chart title="A · Flow" unit={f.unit} height={210} lines={lines(f.signal, f.label, COLOR[f.kind])}/>{f.port && <Chart title="V · Incentive at the port" unit="Model units" height={200} lines={lines(`V(${f.port.node.toLowerCase()},${f.port.ret.toLowerCase()})`, 'Incentive', '#a8660c')}/>}</> : hint('this flow')}
      <h4>Components along this flow</h4><div className="chain">{chain.map(n => <button key={n} onClick={() => pick({ kind: 'element', id: n })}>{n}</button>)}</div>
    </>;
  }
  if (selection.kind === 'signal') {
    const s = [...map.disturbances, ...map.outputs].find(x => x.id === selection.id)!;
    if (s.id === 'y_reference' && scenario.feedback && scenario.share_control) {
      const shareTarget = result?.scenario.share_control ? lines('share_target', 'Rental-share target', '#b9770e') : [];
      return <><p className="eyebrow">Signals r (two goals)</p><h3>Targets</h3><p className="muted">Parliament sets two targets: the house price path and the rental share of housing services.</p>
        {result ? <><h4>r₁ · House price target</h4><Chart title="" unit={s.unit} height={220} lines={lines(s.signal, 'Price target', '#2b6599')}/>
          <h4>r₂ · Rental-share target</h4>{shareTarget.length ? <Chart title="" unit="%" height={220} lines={[...shareTarget, ...lines('rental_share', 'Measured rental share', '#3c6e4e')]}/> : hint('the rental-share target (run with the rental share loop on)')}</> : hint('these signals')}</>;
    }
    if (s.id === 'y_error' && scenario.feedback && scenario.share_control) {
      const shareGap = result?.scenario.share_control ? lines('I(Serror)', 'Rental-share gap', '#b9770e') : [];
      return <><p className="eyebrow">Signals e (two goals)</p><h3>Gaps</h3><p className="muted">Each PID gets its own gap: the price PID the price gap, the rental-share PID the gap between the target and the measured rental share.</p>
        {result ? <><h4>e₁ · Price gap</h4><Chart title="" unit={s.unit} height={220} lines={lines(s.signal, 'Price gap', '#3c6e4e')}/>
          <h4>e₂ · Rental-share gap</h4>{shareGap.length ? <Chart title="" unit="% points" height={220} lines={shareGap}/> : hint('the rental-share gap (run with the rental share loop on)')}</> : hint('these signals')}</>;
    }
    return <><p className="eyebrow">{selection.id.startsWith('d_') ? 'Historical shock or input' : 'Signal'}</p><h3>{s.label}</h3>
      {result ? <Chart title="" unit={s.unit} height={250} lines={lines(s.signal, s.label, s.id === 'y_yoy' ? '#3f9a1f' : selection.id.startsWith('d_') ? '#b3322a' : '#3c6e4e')}/> : hint('this signal')}
      {s.element && <><h4>Component</h4><div className="chain"><button onClick={() => pick({ kind: 'element', id: s.element! })}>{s.element}</button></div></>}</>;
  }
  if (selection.kind === 'shocks') {
    return <><p className="eyebrow">Disturbances d</p><h3>Historical shocks and inputs</h3><p className="muted">Six signals act on the system. Open the Housing Market to see where each one enters.</p>
      <div className="sensor-list">{map.disturbances.map(o => { const t = result && readTrace(result, o.signal); return <button key={o.id} onClick={() => pick({ kind: 'signal', id: o.id })}><span>{o.label}</span>{t && <b>{fmt(t[t.length - 1])}</b>}{t && <Spark y={t} color="#c5352a" at={t.length - 1}/>}</button>; })}</div></>;
  }
  if (selection.kind === 'sensor') {
    return <><p className="eyebrow">Sensor</p><h3>CBS · sensor</h3>
      <h4>Inside the sensor</h4>
      <div className="sensor-inside"><div><b>x₁</b> Construction payments<br/><b>x₂</b> New construction</div><span>→</span><div><b>y</b> House price index = x₁</div></div>
      <p className="muted small">Both measurements enter CBS. The house price index sent to the controller is the construction payments x₁, as in the thesis model. New construction x₂ is measured but not yet used in the index.</p>
      {probes && probes.list.length > 0 && <><h4>Probed signals sent to CBS</h4><div className="chain">{probes.list.map(p => <button key={`${p.flow}:${p.q}`} onClick={() => pick({ kind: 'probe', id: `${p.flow}:${p.q}` })}>{probeInfo(map, p).title}</button>)}</div></>}
      <h4>All read-outs</h4>
      <div className="sensor-list">{map.outputs.map(o => { const t = result && readTrace(result, o.signal); return <button key={o.id} onClick={() => pick({ kind: 'signal', id: o.id })}><span>{o.label}</span>{t && <b>{fmt(t[t.length - 1])}</b>}{t && <Spark y={t} color="#3f9a1f" at={t.length - 1}/>}</button>; })}</div></>;
  }
  if (selection.kind === 'element') {
    const e = map.elements.find(x => x.name === selection.id) as Element, state = stateOf(e, scenario);
    return <><p className="eyebrow">{e.role}</p><h3 title={`Netlist id: ${e.name}`}>{namePlain(e.name)}</h3>
      {state !== 'active' && <p className="state-note">{STATE_NOTE[state]}</p>}
      <p className="direction">Nodes {e.a} → {e.b}{e.agent && layer !== e.agent ? <> · <button className="link" onClick={() => enter(e.agent!)}>Open {name(e.agent)}</button></> : null}</p>
      {result ? <><Chart title="Flow" unit="Model units" height={200} lines={lines(e.trace, 'Flow', '#3f8f4f')}/>{e.a !== e.b && <Chart title="Incentive across" unit="Model units" height={200} lines={lines(`V(${e.a.toLowerCase()},${e.b.toLowerCase()})`, 'Incentive across', '#a8660c')}/>}</> : hint('this component')}
      <details className="netlist-line"><summary>Netlist line</summary><code>{e.netlist}</code></details>
      {e.flows.length > 0 && <><h4>Part of</h4><div className="chain">{e.flows.map(id => <button key={id} onClick={() => pick({ kind: 'flow', id })}>{map.flows.find(f => f.id === id)?.label}</button>)}</div></>}</>;
  }
  const id = selection.kind === 'agent' ? selection.id : layer;
  if (id === 'controller') {
    return <><p className="eyebrow">Outside the system</p><h3>Controller</h3><p className="muted">{map.controller.description}</p>
      {update && <GainSteps scenario={scenario} update={update} auto={auto}/>}
      {probes && (!auto || reject) && <div className="step-pick"><h4>{reject ? 'Disturbance rejection: shock in' : 'Step responses on the canvas'}</h4>
        <label>Pinned plots show the response to a unit step in <select value={probes.stepInput} onChange={e => probes.setStepInput(e.target.value)}>
          {scenario.feedback && <option value="y_reference">the target r</option>}<option value="u_open">the controller output u, loop open</option>{map.disturbances.filter(d => d.id !== 'd_loans').map(d => <option key={d.id} value={d.id}>{d.label}</option>)}</select></label>
        <p className="muted small">{probes.count ? `${probes.count} pinned plot${probes.count > 1 ? 's' : ''} switch to the step response while the controller is selected. Linear model, 15 years${probes.stepInput === 'u_open' ? ', loop open: the market on its own' : scenario.feedback ? ', loop closed' : ', loop open'}.` : 'Click a port, a disturbance or a subsidy arrow to pin a plot; it shows the step response here while you tune.'}</p></div>}
      {probes && <button className="secondary sens-pin" onClick={probes.addSens}>{probes.hasSens ? 'Remove S, T, KS from the canvas' : 'Pin S, T, KS on the canvas'}</button>}
      {update && design && setDesign && <ControllerLocus K={[scenario.kp, scenario.ki, scenario.kd]} filtered={scenario.derivative_filter} design={design} setDesign={setDesign}
        setK={(K: K3, preset?: string) => { update(preset ? { controller: preset as Scenario['controller'], kp: K[0], ki: K[1], kd: K[2] } : { controller: 'custom', kp: K[0], ki: Math.max(0.01, K[1]), kd: K[2] }); setDesign({ ...design, K, filtered: scenario.derivative_filter }); }}
        below={scenario.feedback ? <NyquistPanel K={[scenario.kp, scenario.ki, scenario.kd]} filtered={scenario.derivative_filter}/> : null}/>}
      <h4>Sends</h4><div className="chain">{map.flows.filter(f => f.source === 'controller').map(f => <button key={f.id} onClick={() => pick({ kind: 'flow', id: f.id })}>{f.label}</button>)}</div>
      {layer !== 'controller' && <button className="secondary open-agent" onClick={() => enter('controller')}>Show inside <ChevronRight size={15}/></button>}</>;
  }
  const agent = map.agents[id];
  if (!agent) return <><h3>Model</h3><p className="muted">Click the Housing Market to open it in place, then an agent to see its components. Click any arrow, port pair or component to plot it.</p></>;
  const inFlows = map.flows.filter(f => f.target === id), outFlows = map.flows.filter(f => f.source === id), layout = map.layouts[id];
  return <><p className="eyebrow">Agent</p><h3>{agent.label}</h3><p className="muted">{agent.description}</p>
    {layer !== id && <button className="secondary open-agent" onClick={() => enter(id)}>Show components <ChevronRight size={15}/></button>}
    {inFlows.length > 0 && <><h4>Receives</h4><div className="chain">{inFlows.map(f => <button key={f.id} onClick={() => pick({ kind: 'flow', id: f.id })}>{f.label}</button>)}</div></>}
    {outFlows.length > 0 && <><h4>Sends</h4><div className="chain">{outFlows.map(f => <button key={f.id} onClick={() => pick({ kind: 'flow', id: f.id })}>{f.label}</button>)}</div></>}
    {layout.not_drawn.length > 0 && <p className="not-drawn">Not drawn, not in the circuit: {layout.not_drawn.join(', ')}</p>}</>;
}

type View = { system: boolean; cpb: boolean; finance: boolean; controller: boolean; agents: string[]; cbs?: boolean; formulas?: boolean; noParliament?: boolean; ctrlScale?: number };
const CPB_AGENTS = ['constructors', 'investors', 'firms', 'households'];
const CHANNEL: Record<string, string> = {
  construction_cost: 'c12', houses: 'c12', consumption: 'c12', income: 'c12', goods: 'c12',
  rental_services: 'row', owner_services: 'row', rent: 'row', imputed_rent: 'row',
  mortgages: 'c23', mortgage_interest: 'c23', savings: 'c23', savings_interest: 'c23', loans: 'bottom', loan_interest: 'bottom',
};
// Collapsed CPB box: where the six financial pairs leave it (px offsets), return rail 12 px on the +y / +x side.
const CPB_BOX: [number, number] = [300, 230];
const CPB_PORTS: Record<string, { p: Point; side: Side }> = {
  mortgages: { p: [300, 46], side: 'R' }, mortgage_interest: { p: [300, 92], side: 'R' }, savings: { p: [300, 138], side: 'R' }, savings_interest: { p: [300, 184], side: 'R' },
  loans: { p: [100, 230], side: 'B' }, loan_interest: { p: [200, 230], side: 'B' },
};
// Collapsed agents all have one size; the financial sector is as tall as the collapsed CPB box,
// so its four left ports line up with the CPB's four right ports.
const AGENT_BOX: Point = [250, 160], FIN_BOX: Point = [250, 230], FIG_BOX: Point = [220, 100];
// Closed agents in the CPB backbone view: room for their equation cards (canvas units)
const FORMULA_BOX: Record<string, Point> = { constructors: [600, 190], investors: [600, 230], households: [600, 360] };
/** Port of a collapsed block: ports keep their side and order from the drawing, evenly spaced along that side. */
function evenPort(l: MapData['layouts'][string], flow: string, [W, H]: Point): { p: Point; side: Side; ret: Point } {
  const [w, h] = l.size, sideOf = ([x, y]: number[]): Side => x === 0 ? 'L' : x === w ? 'R' : y === 0 ? 'T' : 'B';
  const side = sideOf(l.ports[flow]), vertical = side === 'L' || side === 'R', k = vertical ? 1 : 0;
  const same = Object.keys(l.ports).filter(f => sideOf(l.ports[f]) === side).sort((a, b) => l.ports[a][k] - l.ports[b][k]);
  const t = (same.indexOf(flow) + 1) / (same.length + 1), sign = Math.sign(l.returns[flow][k] - l.ports[flow][k]) || 1;
  const p: Point = side === 'L' ? [0, H * t] : side === 'R' ? [W, H * t] : side === 'T' ? [W * t, 0] : [W * t, H];
  return { p, side, ret: vertical ? [p[0], p[1] + 12 * sign] : [p[0] + 12 * sign, p[1]] };
}

function useModelGraph(map: MapData | undefined, view: View, toggle: (k: string) => void, scenario: Scenario, result: Result | null, at: number, selection: Selection, select: (s: Selection) => void, menu: (s: Selection, e: React.MouseEvent) => void, flip?: () => void, probes?: ProbeState, step?: (k: GainKey, up: boolean) => void, lab = 1, hl: Formula | null = null, setHl: (f: Formula | null) => void = () => undefined, natW: Record<string, number> | null = null, figure = false) {
  const bv = useContext(BankCtx);
  return useMemo(() => {
    // figure mode is for the chapter before the financial sector: drawn as with the bank off
    const bankOn = scenario.bank && !figure;
    if (!map) return { nodes: [] as Node[], edges: [] as Edge[], pinDefault: {} as Record<string, XY>, lines: {} as Record<string, Point[]> };
    const value = (signal: string) => result && readTrace(result, signal) ? <Val signal={signal}/> : undefined;
    // bank loop: r, e, y and x in % with two decimals, so that e = r - y can be read off the canvas
    const value2 = (signal: string) => result && readTrace(result, signal) ? <Val signal={signal} digits={2}/> : undefined;
    // bank mode: the loop carries two channels (Menkveld Fig. 3-2), Tier 1 capital ratio and NSFR
    const two = (a: string, b: string) => result && readTrace(result, a) && readTrace(result, b) ? <>T1 <Val signal={a}/> · NSFR <Val signal={b}/></> : undefined;
    const on = (s: Selection) => selection.kind === s.kind && selection.id === s.id;
    const nodes: Node[] = [], edges: Edge[] = [], railStart: Record<string, Point> = {}, pinDefault: Record<string, XY> = {}, lines: Record<string, Point[]> = {};
    const block = (id: string, r: Rect, data: Partial<BlockData>, z = 1) => nodes.push({ id, type: 'block', position: { x: r.x, y: r.y }, draggable: false, zIndex: z, data: { label: '', tone: '', width: r.w, height: r.h, ...data } });
    const sig = (id: string, points: Point[], data: Omit<SignalData, 'points'>) => edges.push({ id, source: 'anchor', target: 'anchor', type: 'signal', zIndex: 5, className: data.target?.kind === 'flow' && lit(data.target.id) ? 'lit' : undefined, data: { points, lab, ...data, menu: data.target ? (e: React.MouseEvent) => menu(data.target!, e) : undefined } });
    const card = (id: string) => probes?.show ? (e?: React.MouseEvent) => { if (e) probes.show!({ flow: id, q: 's' }, e); } : undefined;
    const GX = 640, GY = 300;
    const R: Record<string, Rect> = {}, scale: Record<string, number> = {};
    // CPB backbone view (tour): closed agents are larger and carry their CPB equations
    // figure mode: no formula cards (the equations go into the report); a picked formula still lights its flows
    const withEq = (id: string) => !figure && !!view.formulas && !!FORMULAS[id];
    // Equations beside the circuit (wider, flatter figure for slides) on a side without ports: Constructors left;
    // Investors and Households right, where only the bank connects (so only with the bank off). Otherwise above/below.
    const SIDE: Record<string, 'L' | 'R'> = { constructors: 'L', investors: 'R', households: 'R' };
    const sideOn = (id: string) => withEq(id) && view.agents.includes(id) && !!SIDE[id] && (SIDE[id] === 'L' || !bankOn);
    // ONE formula scale for every card on the canvas: it follows the label-size slider (1.3x = the size the cards were
    // drawn for; fixed in figure mode) and is lowered until the widest formula fits the narrowest place it is shown.
    // Boxes and side columns are sized from this scale; a strip above/below an opened circuit has the circuit's width.
    const CARD_PAD = 26;  // strip padding + card border, canvas units
    const stripCap = (id: string) => map.layouts[id].size[0] * SCALE.expanded - CARD_PAD;
    const eq = Math.floor(100 * Math.min(lab / 1.3,
      ...CPB_AGENTS.filter(id => withEq(id) && view.agents.includes(id) && !sideOn(id) && natW?.[id]).map(id => stripCap(id) / natW![id]))) / 100;
    const cardW = (id: string) => (natW?.[id] ?? 0) + CARD_PAD;  // the widest card of an agent at scale 1
    const AB = (id: string): Point => withEq(id) && FORMULA_BOX[id] ? [Math.max(AGENT_BOX[0], Math.max(FORMULA_BOX[id][0], cardW(id) + 28) * eq), Math.max(AGENT_BOX[1], FORMULA_BOX[id][1] * eq)] : figure ? FIG_BOX : AGENT_BOX;  // figure mode: closed agents compact, the opened one dominates
    // beside the circuit: a column that fits the widest card at the same scale
    const STRIP_W: Record<string, number> = { constructors: 470, investors: 500, households: 700 };
    const side = (id: string) => sideOn(id) ? Math.max(STRIP_W[id], cardW(id)) * eq : 0;
    const circL = (id: string) => SIDE[id] === 'L' ? side(id) : 0;  // x offset of the circuit inside the block
    const strip = (id: string) => withEq(id) && view.agents.includes(id) && !side(id) ? (STRIP_H[id] ?? 0) * eq : 0;
    // An opened agent without a formula strip on top gets a band for its header (it grows with the label size), so
    // the header never covers the top of the circuit. A top strip already leaves room for it.
    const band = (id: string) => view.agents.includes(id) && !(strip(id) && !STRIP_BOTTOM.has(id)) ? HEAD_FLOW * lab : 0;
    const extra = (id: string) => strip(id) + band(id);  // block height that is not circuit
    const stripTop = (id: string) => band(id) + (STRIP_BOTTOM.has(id) ? 0 : strip(id));  // offset of the circuit inside the block
    const lit = (flow: string) => !!hl?.flows.includes(flow);
    const shift = (dx: number, dy: number, ids: string[]) => ids.forEach(i => { R[i].x += dx; R[i].y += dy; });
    const sized = (id: string) => { const open = view.agents.includes(id), [w, h] = map.layouts[id].size; scale[id] = open ? SCALE.expanded : 0; R[id] = open ? { x: 0, y: 0, w: w * SCALE.expanded + side(id), h: Math.max(h * SCALE.expanded, side(id) ? (STRIP_H[id] ?? 0) * eq : 0) + extra(id) } : { x: 0, y: 0, w: AB(id)[0], h: AB(id)[1] }; };
    // The circuit area of an opened agent, in canvas units.
    const circ = (id: string): Rect => { const [w, h] = map.layouts[id].size, r = R[id]; if (!view.agents.includes(id)) return r; return { x: r.x + circL(id), y: r.y + stripTop(id), w: w * SCALE.expanded, h: h * SCALE.expanded }; };
    // Port of a flow on a block: agent (from its drawing), collapsed CPB box, or collapsed financial sector (drawn like Bank).
    const portOf = (node: string, flow: string): { p: Point; side: Side; ret: Point } => {
      const r = R[node];
      if (node === 'cpb') { const c = CPB_PORTS[flow]; const p: Point = [r.x + c.p[0], r.y + c.p[1]]; return { p, side: c.side, ret: c.side === 'R' ? [p[0], p[1] + 12] : [p[0] + 12, p[1]] }; }
      const l = map.layouts[node === 'finance' ? 'bank' : node], [w, h] = l.size, s = scale[node] ?? 0;
      if (!s) { const e = evenPort(l, flow, node === 'finance' ? FIN_BOX : AB(node)); return { p: [r.x + e.p[0], r.y + e.p[1]], side: e.side, ret: [r.x + e.ret[0], r.y + e.ret[1]] }; }
      const [x, y] = l.ports[flow], [rx, ry] = l.returns[flow], top = r.y + stripTop(node), left = r.x + circL(node);
      return { p: [left + x * s, top + y * s], side: x === 0 ? 'L' : x === w ? 'R' : y === 0 ? 'T' : 'B', ret: [left + rx * s, top + ry * s] };
    };
    let group: Rect = { x: GX, y: GY, w: 250, h: 150 }, cpbRegion: Rect | null = null, finRegion: Rect | null = null;
    const g12 = 340, rowGap = figure ? 260 : 340, g23 = 340, framePad = 34;  // figure mode: the two rows closer together (report)
    // Which disturbances are drawn: a shock whose scale is 0 is not (the bank's inputs are all zero with the bank off).
    const SCALE_OF: Record<string, keyof Scenario> = { d_income: 'income_scale', d_covid: 'covid_scale', d_crisis: 'crisis_scale', d_mortgages: 'mortgage_scale', d_interest: 'interest_scale' };
    const active = (d: { id: string; target?: string }) => (d.target !== 'bank' || bankOn) && !(SCALE_OF[d.id] && scenario[SCALE_OF[d.id]] === 0);
    if (view.system) {
      // ---- CPB model
      if (view.cpb) {
        CPB_AGENTS.forEach(sized);
        const rel = (a: string, f: string) => { const q = portOf(a, f).p; return [q[0] - R[a].x, q[1] - R[a].y]; };
        const A = R, col1 = Math.max(A.constructors.w, A.firms.w);
        A.investors.x = col1 + g12; A.investors.y = 0;
        A.households.x = A.investors.x; A.households.y = A.investors.h + rowGap;
        A.constructors.x = A.investors.x - g12 - A.constructors.w; A.constructors.y = rel('investors', 'construction_cost')[1] - rel('constructors', 'construction_cost')[1];
        A.firms.x = A.households.x - g12 - A.firms.w; A.firms.y = A.households.y + rel('households', 'consumption')[1] - rel('firms', 'consumption')[1];
        const x0 = Math.min(...CPB_AGENTS.map(i => A[i].x)), y0 = Math.min(...CPB_AGENTS.map(i => A[i].y));
        const x1 = Math.max(...CPB_AGENTS.map(i => A[i].x + A[i].w)), y1 = Math.max(...CPB_AGENTS.map(i => A[i].y + A[i].h));
        R.cpb = { x: x0 - framePad, y: y0 - framePad - 24, w: x1 - x0 + 2 * framePad, h: y1 - y0 + 2 * framePad + 24 };
      } else R.cpb = { x: 0, y: 0, w: CPB_BOX[0], h: CPB_BOX[1] };
      cpbRegion = R.cpb;
      // ---- Financial sector, aligned so the mortgage pair runs straight where possible
      const cpbMort = view.cpb ? portOf('investors', 'mortgages').p[1] : R.cpb.y + CPB_PORTS.mortgages.p[1];
      if (view.finance) {
        sized('bank');
        R.bank.x = R.cpb.x + R.cpb.w + g23 + framePad; R.bank.y = cpbMort - portOf('bank', 'mortgages').p[1];
        R.finance = { x: R.bank.x - framePad, y: R.bank.y - framePad - 24, w: R.bank.w + 2 * framePad, h: R.bank.h + 2 * framePad + 24 };
      } else {
        R.finance = { x: R.cpb.x + R.cpb.w + g23, y: cpbMort - evenPort(map.layouts.bank, 'mortgages', FIN_BOX).p[1], w: FIN_BOX[0], h: FIN_BOX[1] };
      }
      finRegion = R.finance;
      // ---- place the system frame
      // padT leaves room under the frame's header for the two measurement lanes x1, x2 (from Investors to CBS).
      const inside = Object.keys(R), padL = 130, padT = HEAD_FLOW * lab + 84, padR = 80, padB = 150;
      const minX = Math.min(...inside.map(i => R[i].x)), minY = Math.min(...inside.map(i => R[i].y));
      shift(GX + padL - minX, GY + padT - minY, inside);
      // Bank off: the financial sector is not drawn, so the frame closes around the CPB part only.
      const framed = bankOn ? inside : inside.filter(i => i !== 'finance' && i !== 'bank');
      const maxX = Math.max(...framed.map(i => R[i].x + R[i].w)), maxY = Math.max(...framed.map(i => R[i].y + R[i].h));
      group = { x: GX, y: GY, w: maxX + padR - GX, h: maxY + padB - GY };
      // ---- port pairs
      const ends = (f: Flow) => {
        const map1 = (a: string) => CPB_AGENTS.includes(a) ? (view.cpb ? a : 'cpb') : a === 'bank' ? (view.finance ? 'bank' : 'finance') : a;
        return [map1(f.source), map1(f.target)];
      };
      const shown = map.flows.filter(f => f.port && (CHANNEL[f.id] === 'c23' || CHANNEL[f.id] === 'bottom' || view.cpb));
      const inv = R.investors, hh = R.households, cpb = R.cpb, fin = R.finance;
      const channels: Record<string, [number, number]> = { c23: [cpb.x + cpb.w + 50, fin.x - 50], bottom: [maxY + 50, maxY + 105] };
      if (view.cpb) { channels.c12 = [inv.x - g12 + 55, inv.x - 55]; channels.row = figure ? [inv.y + inv.h + 45, hh.y - 70] : [inv.y + inv.h + 55, hh.y - 160]; }  // figure mode: rows closer, lanes keep their room
      const info: Record<string, { a: ReturnType<typeof portOf>; b: ReturnType<typeof portOf> }> = {};
      const wires: Wire[] = shown.map(f => { const [s1, t1] = ends(f), a = portOf(s1, f.id), b = portOf(t1, f.id); info[f.id] = { a, b }; return { id: f.id, P: a.p, sp: a.side, Q: b.p, channel: CHANNEL[f.id] }; });
      const paths = assignLanes(wires, channels), nth: Record<string, number> = {};
      shown.forEach(f => { railStart[f.id] = paths[f.id][0]; lines[f.id] = paths[f.id]; });
      shown.forEach(f => {
        const pts = paths[f.id], { a } = info[f.id], n0 = along([0, 0], [-(pts[1][1] - pts[0][1]), pts[1][0] - pts[0][0]], 1);
        const side = Math.sign(n0[0] * (a.ret[0] - a.p[0]) + n0[1] * (a.ret[1] - a.p[1])) || 1;
        nth[CHANNEL[f.id]] = (nth[CHANNEL[f.id]] ?? -1) + 1;
        edges.push({ id: f.id, source: 'anchor', target: 'anchor', type: 'rail', zIndex: 4, className: lit(f.id) ? 'lit' : undefined, data: { points: pts, side, color: COLOR[f.kind], name: f.short, value: value(f.signal), labelT: nth[CHANNEL[f.id]] % 2 ? .7 : .3, selected: on({ kind: 'flow', id: f.id }) || lit(f.id), pick: f.port && probes?.show ? (e?: React.MouseEvent) => e && probes.show!({ flow: f.id, q: 'f' }, e) : () => select({ kind: 'flow', id: f.id }), menu: (e: React.MouseEvent) => menu({ kind: 'flow', id: f.id }, e), probe: f.port && probes?.show ? (q: 'e' | 'f', e: React.MouseEvent) => probes.show!({ flow: f.id, q }, e) : undefined, probed: (['e', 'f'] as const).filter(q => on({ kind: 'probe', id: `${f.id}:${q}` }) || !!probes?.pins.some(p => p.flow === f.id && p.q === q) || !!probes?.sensed.some(p => p.flow === f.id && p.q === q)) } });
      });
    }
    const gc = group.y + group.h / 2;
    // ---- controller, its ports set the subsidy and error heights
    const cs = SCALE.controller * (view.ctrlScale ?? 1), ctrlSize: Point = view.controller ? [CONTROLLER_SIZE[0] * cs, CONTROLLER_SIZE[1] * cs] : [210 * lab, 150 * lab];
    const target = view.system ? (view.cpb ? null : R.cpb) : group;
    // Top layer: every block centred on one line through the system; the two subsidies leave symmetric about it.
    const loopOnly = !view.system && !view.controller;
    const u2y = loopOnly ? gc - 24 : target ? target.y + target.h / 2 - .17 * ctrlSize[1] : R.households.y - 140;
    const mainY = loopOnly ? gc : u2y;
    // Open controller: a band of HEAD_FLOW above the circuit for its header, so the header never covers the P box.
    const ctrlHead = view.controller ? HEAD_FLOW * lab : 0;
    const ctrl: Rect = { x: group.x - 250 * lab - ctrlSize[0], y: mainY - ctrlSize[1] / 2 - ctrlHead, w: ctrlSize[0], h: ctrlSize[1] + ctrlHead };
    const u1y = loopOnly ? gc + 24 : ctrl.y + ctrlHead + ctrlSize[1] * 5 / 6;
    const sum: Rect = { x: ctrl.x - (loopOnly ? 150 : 130) * lab, y: mainY - 22, w: 44, h: 44 }, parl: Rect = { x: sum.x - (loopOnly ? 170 : 80) * lab - 180 * lab, y: mainY - 60 * lab, w: 180 * lab, h: 120 * lab };
    const cbsS = 0.42, cbsHead = HEAD_FLOW * lab;
    // Bank: the open ALM Reporting holds the financial statements (BankStatements), so it is larger than CBS's circuit.
    const sensor: Rect = view.cbs && bv ? { x: group.x + group.w + 190 * lab, y: gc - cbsHead - 330, w: 1250, h: 660 + cbsHead }
      : view.cbs ? { x: group.x + group.w + 190 * lab, y: gc - cbsHead - CBS_Y.out * cbsS, w: CBS_SIZE[0] * cbsS, h: CBS_SIZE[1] * cbsS + cbsHead }
      : { x: group.x + group.w + 190 * lab, y: gc - 60 * lab, w: 180 * lab, h: 120 * lab };
    // Open CBS: the two measurements enter where its drawing expects them.
    const xIn = view.cbs && !bv ? { a: sensor.y + cbsHead + CBS_Y.x1 * cbsS - gc, b: sensor.y + cbsHead + CBS_Y.x2 * cbsS - gc } : { a: -26, b: 26 };
    block('anchor', { x: group.x, y: group.y, w: 1, h: 1 }, { tone: 'anchor' }, 0);
    // Parliament can be removed from the drawing (right-click); the summing junction then shows only the feedback.
    if (!view.noParliament) block('parliament', parl, { icon: <Landmark/>, label: bv ? 'ALCO' : 'Parliament', tone: scenario.feedback ? 'reference' : 'reference loop-off', selected: on({ kind: 'signal', id: 'y_reference' }) });
    block('sum', sum, { tone: scenario.feedback ? 'summing' : 'summing loop-off' });
    block('controller', ctrl, view.controller
      ? { label: bv ? 'ALM Desk · Controller' : 'Tax Authority · Controller', tone: 'controller', open: true, tab: 'above', headSpace: ctrlHead, toggle: () => toggle('controller'), scale: view.ctrlScale ?? 1, resize: (v: number) => toggle(`ctrl-scale:${v}`), children: bv ? bv.desk : <ControllerCircuit map={map} scenario={scenario} selection={selection} pick={select} step={step}/> }
      : { icon: <Coins/>, label: bv ? 'ALM Desk' : 'Tax Authority', tone: 'controller', toggle: () => toggle('controller'), selected: on({ kind: 'agent', id: 'controller' }) });
    block('sensor', sensor, view.cbs ? { label: bv ? 'ALM Reporting · Sensor' : 'CBS · how the index is made', tone: 'sensor-open', open: true, tab: 'above', headSpace: cbsHead, toggle: () => toggle('cbs'), children: bv ? bv.sensor : <CbsCircuit/> }
      : { icon: <BarChart3/>, label: bv ? 'ALM Reporting' : 'CBS', tone: 'sensor', selected: selection.kind === 'sensor', toggle: () => toggle('cbs') });
    if (!view.system) block('system', group, { icon: bv ? <Globe/> : <Home/>, label: bv ? 'Economy' : 'Housing Market', tone: 'system-closed', toggle: () => toggle('system') });
    else {
      block('system', group, { label: bv ? 'Economy' : 'Housing Market', tone: 'system-group', open: true, tab: 'tl', toggle: () => toggle('system') }, 0);
      block('cpb', R.cpb, view.cpb ? { label: 'CPB Four Quadrants', tone: 'sub-group', open: true, tab: 'tl', toggle: () => toggle('cpb') } : { label: 'CPB Four Quadrants', tone: 'sub-closed', toggle: () => toggle('cpb') }, view.cpb ? 1 : 2);
      block('finance', R.finance, view.finance ? { label: bankOn ? 'Financial sector' : 'Financial sector · off', tone: bankOn ? 'sub-group' : 'sub-group bank-off', open: true, tab: 'tl', toggle: () => toggle('finance') } : { label: bankOn ? 'Financial sector' : 'Financial sector · off', tone: bankOn ? 'sub-closed' : 'sub-closed bank-off', toggle: () => toggle('finance') }, view.finance ? 1 : 2);
      const agentBlock = (id: string) => {
        const open = view.agents.includes(id), a = map.agents[id];
        const circuit = <AgentCircuit map={map} agent={id} scenario={bv ? { ...scenario, feedback: false } : scenario} selection={selection} pick={select} menu={menu} inputs={map.disturbances.filter(d => d.target === id && active(d))} inputSide={id === 'bank' ? 'top' : 'left'} outside highlight={hl?.elements} litFlows={hl?.flows} trace={hl?.trace}/>;
        const cards = withEq(id) ? <FormulaCards agent={id} active={hl?.id ?? null} pick={setHl} eq={eq}/> : undefined;
        const sh = strip(id), bh = band(id), sw = side(id), pc = (v: number) => `${v / R[id].h * 100}%`, pw = (v: number) => `${v / R[id].w * 100}%`;
        const cw = map.layouts[id].size[0] * SCALE.expanded, chh = map.layouts[id].size[1] * SCALE.expanded;
        block(id, R[id], open ? { label: a.label, tone: 'agent', open, tab: TAB[id], toggle: () => toggle(id),
            children: sw ? <><div className="circuit-below" style={{ top: pc(bh), left: pw(circL(id)), width: pw(cw), height: pc(chh), right: 'auto', bottom: 'auto' }}>{circuit}</div>
              <div className={'formula-strip side ' + SIDE[id]} style={{ top: pc(bh), bottom: 0, height: 'auto', left: SIDE[id] === 'L' ? 0 : pw(cw), right: 'auto', width: pw(sw) }}>{cards}</div></>
            : sh ? (STRIP_BOTTOM.has(id)
              ? <><div className="circuit-below" style={{ top: pc(bh), bottom: pc(sh) }}>{circuit}</div><div className="formula-strip bottom" style={{ top: 'auto', bottom: 0, height: `${sh / R[id].h * 100}%` }}>{cards}</div></>
              : <><div className="formula-strip" style={{ height: `${sh / R[id].h * 100}%` }}>{cards}</div><div className="circuit-below" style={{ top: pc(sh) }}>{circuit}</div></>) : bh ? <div className="circuit-below" style={{ top: pc(bh) }}>{circuit}</div> : circuit }
          : { label: a.label, tone: withEq(id) ? 'agent with-formulas' : 'agent', toggle: () => toggle(id), selected: on({ kind: 'agent', id }), children: cards }, 3);
      };
      if (view.cpb) CPB_AGENTS.forEach(agentBlock);
      if (view.finance) agentBlock('bank');
    }
    // ---- loop signals (two goals when the rental share loop is on)
    const mimo = scenario.feedback && scenario.share_control;
    // bank mode (Menkveld Fig. 3-2): two channels drawn as two lines each; 1 = Tier 1 (solvency), 2 = NSFR (liquidity)
    const dch = sum.h * 0.22, D = 30 * lab;  // dch: where the two lines meet the summing junction; D: their spacing
    if (bv) {
      const fbOn = scenario.feedback, rc = fbOn ? '#2b6599' : '#b8c2bd', ec = fbOn ? '#1f2a26' : '#b8c2bd';
      const ch = [{ k: 1, dy: -D, dj: -dch, r: 'y_reference', e: 'y_error', rn: 'Tier 1 target', en: 'Tier 1 deviation', rv: 'Bank_target_t1', ev: 'Bank_dev_t1', side: 'above' as const },
                  { k: 2, dy: D, dj: dch, r: 'r_nsfr', e: 'e_nsfr', rn: 'NSFR target', en: 'NSFR deviation', rv: 'Bank_target_nsfr', ev: 'Bank_dev_nsfr', side: 'below' as const }];
      ch.forEach(c => {
        const y = mainY + c.dy, sub_ = (n: number) => n === 1 ? '₁' : '₂';
        const yj = mainY + c.dj, bend = 26 * lab;
        if (!view.noParliament) { lines[c.r] = [[parl.x + parl.w, y], [sum.x - bend, y], [sum.x + 2, yj]];
          sig(`r${c.k}`, lines[c.r], { color: rc, dashed: !fbOn, markDist: (sum.x - bend - parl.x - parl.w) / 2, letter: `r${sub_(c.k)}`, name: c.rn, value: value2(c.rv), labelSide: c.side, selected: on({ kind: 'signal', id: 'y_reference' }), pick: card(c.r) ?? (() => select({ kind: 'signal', id: 'y_reference' })) }); }
        lines[c.e] = [[sum.x + sum.w - 2, yj], [sum.x + sum.w + bend, y], [ctrl.x, y]];
        sig(`e${c.k}`, lines[c.e], { color: ec, letter: `e${sub_(c.k)}`, name: c.en, markAt: 1, markDist: (ctrl.x - sum.x - sum.w - bend) / 2, value: value2(c.ev), dashed: !fbOn, labelSide: c.side, selected: on({ kind: 'signal', id: 'y_error' }), pick: card(c.e) ?? (() => select({ kind: 'signal', id: 'y_error' })) });
      });
    }
    if (!bv && !view.noParliament) lines.y_reference = [[parl.x + parl.w, mainY], [sum.x, mainY]];
    if (!bv && !view.noParliament) sig('r', [[parl.x + parl.w, mainY], [sum.x, mainY]], { color: scenario.feedback ? '#2b6599' : '#b8c2bd', dashed: !scenario.feedback, markDist: (sum.x - parl.x - parl.w) / 2, letter: 'r', name: bv ? 'Financial targets' : mimo ? 'Targets' : 'Housing target', sub: probes?.stepAt === 'y_reference' ? 'Unit step +1 enters here' : bv ? 'Reference input r' : mimo ? 'Price & share r' : 'Reference signal r', value: bv ? two('Bank_target_t1', 'Bank_target_nsfr') : value('I(Reference)'), labelSide: 'above', selected: on({ kind: 'signal', id: 'y_reference' }), pick: card('y_reference') ?? (() => select({ kind: 'signal', id: 'y_reference' })) });
    if (!bv) sig('e', [[sum.x + sum.w, mainY], [ctrl.x, mainY]], { color: scenario.feedback ? '#1f2a26' : '#b8c2bd', letter: 'e', name: bv ? 'Target deviations' : mimo ? 'Gaps' : 'Gap', sub: bv ? 'Control error e' : mimo ? 'Errors e' : 'Error e', value: bv ? two('Bank_dev_t1', 'Bank_dev_nsfr') : scenario.feedback ? value('I(Error)') : undefined, dashed: !scenario.feedback, labelSide: 'above', selected: on({ kind: 'signal', id: 'y_error' }), pick: card('y_error') ?? (() => select({ kind: 'signal', id: 'y_error' })) });
    const subsidy = (id: string) => map.flows.find(f => f.id === id)!;
    ([['owner_subsidy', 'u2', u2y], ['rental_subsidy', 'u1', u1y]] as const).forEach(([id, letter, y], i) => {
      // switched off: no arrow, except in the CPB backbone view, where the subsidy equations point at both subsidies
      if (id === 'rental_subsidy' && !scenario.rental_subsidy && !view.formulas && !bv) return;
      const f = subsidy(id);
      let points: Point[] = [[ctrl.x + ctrl.w, y], [(target ?? group).x, y]];
      if (bv && view.system) {
        // Bank view: the desk's rates go over the Economy box into the financial sector, and on to their sources inside
        // the bank when it is open (the bank layout's signal paths, patched in Bank.tsx).
        const B = view.finance ? R.bank : R.finance, lay = map.layouts.bank, inner = lay.signals.find(sg => sg.flow === id)?.path;
        const open = view.agents.includes('bank') && !!inner, Bc = open ? circ('bank') : B, k = id === 'owner_subsidy' ? 0 : 1;
        const ex = open ? Bc.x + inner![0][0] / lay.size[0] * Bc.w : B.x + B.w * (0.14 + 0.12 * k), lane = group.y - 40 - 34 * k, bend = ctrl.x + ctrl.w + (60 + 34 * k) * lab;
        points = [[ctrl.x + ctrl.w, y], [bend, y], [bend, lane], [ex, lane], ...(open ? inner!.map(([px, py]) => [Bc.x + px / lay.size[0] * Bc.w, Bc.y + py / lay.size[1] * Bc.h] as Point) : [[ex, B.y] as Point])];
      }
      else if (view.system && view.cpb) {
        const lay = map.layouts.households, inner = lay.signals.find(s => s.flow === id)!.path, H = circ('households'), x = H.x + inner[0][0] / lay.size[0] * H.w;
        points = [[ctrl.x + ctrl.w, y], [x, y], [x, R.households.y]];
        // Households open: one arrow on to the subsidy source inside (the drawing's own path, in canvas units)
        if (view.agents.includes('households')) points.push(...inner.slice(1).map(([px, py]) => [H.x + px / lay.size[0] * H.w, H.y + py / lay.size[1] * H.h] as Point));
      }
      lines[id] = points;
      const L = bv ? (id === 'owner_subsidy' ? 'u1' : 'u2') : letter;
      sig(L, points, { color: COLOR.policy, letter: L, sub: probes?.stepAt === 'u_open' && id === 'owner_subsidy' ? 'Unit step +1 enters here (loop open)' : undefined, markDist: view.system ? 110 * lab : len(points[0], points[1]) / 2, name: f.label, value: value(f.signal), labelSide: i === 0 ? 'above' : 'below', selected: on({ kind: 'flow', id }) || !!probes?.pins.some(p => p.flow === id) || lit(id), pick: probes?.show ? (e?: React.MouseEvent) => e && probes.show!({ flow: id, q: 's' }, e) : () => select({ kind: 'flow', id }), target: { kind: 'flow', id } });
    });
    // Two measurements go into CBS (supervisor 3.4/5.1). Drawn only: the controller's price is still the construction payments.
    // Housing Market open: both lines start where they are measured (Investors, or the CPB box when it is closed),
    // run up into the lane under the frame header, along it, down the right margin and out to CBS. x1 starts left of
    // x2 and runs outside it, so the two never cross.
    let x1pts: Point[] = [[group.x + group.w, gc + xIn.a], [sensor.x, gc + xIn.a]], x2pts: Point[] = [[group.x + group.w, gc + xIn.b], [sensor.x, gc + xIn.b]];
    // CPB open: both lines start on the real flows (the construction-cost and houses rails between Constructors and
    // Investors), rise into the lane under the frame header, run along it and down the right margin to CBS.
    // x2 starts right of x1 and turns below it, so the two never cross (x2 crosses the construction-cost rail once).
    const onRail = (flow: string): Point | null => {
      const pts = lines[flow]; if (!pts || pts.length < 2) return null;
      let best: [Point, Point] | null = null, bl = 0;
      for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i]; if (Math.abs(a[1] - b[1]) < 1e-6 && Math.abs(b[0] - a[0]) > bl) { bl = Math.abs(b[0] - a[0]); best = [a, b]; } }
      return best ? [(best[0][0] + best[1][0]) / 2, best[0][1]] : null;
    };
    const r1 = !bv && view.system && view.cpb ? onRail('construction_cost') : null, r2 = !bv && view.system && view.cpb ? onRail('houses') : null;
    if (r1 && r2) {
      const b1 = group.y + HEAD_FLOW * lab + 26, b2 = b1 + 22, vx1 = group.x + group.w - 22, vx2 = vx1 - 22, sx1 = r1[0] - 18, sx2 = r1[0] + 18;
      x1pts = [[sx1, r1[1]], [sx1, b1], [vx1, b1], [vx1, gc + xIn.a], [sensor.x, gc + xIn.a]];
      x2pts = [[sx2, r2[1]], [sx2, b2], [vx2, b2], [vx2, gc + xIn.b], [sensor.x, gc + xIn.b]];
    } else if (view.system && !bankOn) {
      // No financial sector to the right: straight out of the right side of the CPB box.
      x1pts = [[R.cpb.x + R.cpb.w, gc + xIn.a], [sensor.x, gc + xIn.a]]; x2pts = [[R.cpb.x + R.cpb.w, gc + xIn.b], [sensor.x, gc + xIn.b]];
    } else if (view.system) {
      const src = bv ? (view.finance ? R.bank : R.finance) : view.cpb ? R.investors : R.cpb, b1 = group.y + HEAD_FLOW * lab + 26, b2 = b1 + 22, vx1 = group.x + group.w - 22, vx2 = vx1 - 22;
      const sx1 = src.x + src.w * .55, sx2 = src.x + src.w * .75;
      x1pts = [[sx1, src.y], [sx1, b1], [vx1, b1], [vx1, gc + xIn.a], [sensor.x, gc + xIn.a]];
      x2pts = [[sx2, src.y], [sx2, b2], [vx2, b2], [vx2, gc + xIn.b], [sensor.x, gc + xIn.b]];
    }
    const xMark = view.system && (bankOn || (r1 && r2)) ? { markAt: 4, markDist: 22 + 95 * lab } : view.system ? { markDist: (sensor.x - R.cpb.x - R.cpb.w) / 2 } : {};
    lines.x1 = x1pts; lines.x2 = x2pts;
    sig('x1', x1pts, { color: COLOR.money, letter: 'x₁', name: bv ? 'Assets' : 'Construction payments', value: bv ? <>mortgages, firm loans, home value</> : value('I(Construction_cost)'), markDist: 95 * lab, ...xMark, labelSide: 'above', selected: on({ kind: 'signal', id: 'y_price' }), pick: card('x1') ?? (() => select({ kind: 'signal', id: 'y_price' })), target: { kind: 'signal', id: 'y_price' } });
    sig('x2', x2pts, { color: COLOR.real, letter: 'x₂', name: bv ? 'Liabilities & equity' : 'New construction', value: bv ? <>deposits, other banks, equity</> : value('I(Construction)'), markDist: 95 * lab, ...xMark, labelSide: 'below', selected: on({ kind: 'flow', id: 'houses' }), pick: card('x2') ?? (() => select({ kind: 'flow', id: 'houses' })), target: { kind: 'flow', id: 'houses' } });
    // y always leaves the sensor; the feedback branch is grey and dashed with the loop switch open.
    if (bv) {
      const fbOn = scenario.feedback, fbY = Math.max(group.y + group.h, sensor.y + sensor.h) + 90, tap = sensor.x + sensor.w + 60;
      const ch = [{ k: 1, dy: -D, id: 'y_price', n: 'Tier 1 ratio', v: 'I(Bk_t1)', side: 'above' as const, sx: -dch },
                  { k: 2, dy: D, id: 'y_nsfr', n: 'NSFR', v: 'I(Bk_nsfr)', side: 'below' as const, sx: dch }];
      ch.forEach(c => {
        const y = gc + c.dy, yb = fbY + (c.k - 1) * 44 * lab, t = tap + (c.k - 1) * 30 * lab, sx = sum.x + sum.w / 2 + c.sx, l = c.k === 1 ? '₁' : '₂';
        lines[c.id] = [[sensor.x + sensor.w, y], [sensor.x + sensor.w + 170 * lab, y]];
        sig(`yout${c.k}`, lines[c.id], { color: LOOP, letter: `y${l}`, name: c.n, value: value2(c.v), markDist: 120, labelSide: c.side, selected: on({ kind: 'signal', id: 'y_price' }), pick: card(c.id) ?? (() => select({ kind: 'signal', id: 'y_price' })), target: { kind: 'signal', id: 'y_price' } });
        sig(`y${c.k}`, [[t, y], [t, yb], [sx, yb], [sx, sum.y + sum.h * (c.k === 1 ? 0.95 : 0.95)]], { color: fbOn ? LOOP : '#b8c2bd', dashed: !fbOn, switchAt: [t - (t - sx) / 4, yb], switchOpen: !fbOn, onSwitch: flip, letter: `y${l}`, markAt: 2, markDist: (t - sx) / 2, name: `${c.n}`, labelSide: c.k === 1 ? 'above' : 'below', pick: card(c.id) ?? (() => select({ kind: 'signal', id: 'y_price' })) });
      });
    }
    if (!bv) lines.y_price = [[sensor.x + sensor.w, gc], [sensor.x + sensor.w + 170 * lab, gc]];
    if (!bv) sig('yout', [[sensor.x + sensor.w, gc], [sensor.x + sensor.w + 170 * lab, gc]], { color: LOOP, letter: 'y', name: bv ? 'Financial reports' : mimo ? 'Price index & rental share' : 'House price index', sub: bv ? 'Measured output y' : mimo ? 'Outputs y' : 'Output y', value: bv ? two('I(Bk_t1)', 'I(Bk_nsfr)') : value('I(Construction_cost)'), markDist: 120, labelSide: 'above', selected: on({ kind: 'signal', id: 'y_price' }), pick: card('y_price') ?? (() => select({ kind: 'signal', id: 'y_price' })), target: { kind: 'signal', id: 'y_price' } });
    if (!bv) {
      const fbY = group.y + group.h + 90, tap = sensor.x + sensor.w + 60, fb = scenario.feedback;
      sig('y', [[tap, gc], [tap, fbY], [sum.x + sum.w / 2, fbY], [sum.x + sum.w / 2, sum.y + sum.h]], { color: fb ? LOOP : '#b8c2bd', dashed: !fb, switchAt: [tap - (tap - sum.x - sum.w / 2) / 4, fbY], switchOpen: !fb, onSwitch: flip, letter: 'y', markAt: 2, markDist: (tap - sum.x - sum.w / 2) / 2, name: bv ? 'Financial reports' : mimo ? 'Price index & rental share' : 'House price index', sub: bv ? 'Measured output y' : mimo ? 'Feedback signals' : 'Feedback signal', labelSide: 'above', pick: card('y_price') ?? (() => select({ kind: 'signal', id: 'y_price' })) });
    }
    // Invisible corners so 'Whole model' also fits the arrows outside the blocks.
    const fbBottom = group.y + group.h + 130;
    block('edgeL', { x: parl.x - 30 * lab, y: mainY, w: 1, h: 1 }, { tone: 'anchor' }, 0); block('edgeR', { x: sensor.x + sensor.w + 60 + 170 * lab, y: gc, w: 1, h: 1 }, { tone: 'anchor' }, 0);
    block('edgeT', { x: group.x, y: group.y - 270, w: 1, h: 1 }, { tone: 'anchor' }, 0); block('edgeB', { x: group.x, y: fbBottom, w: 1, h: 1 }, { tone: 'anchor' }, 0);
    // ---- disturbances
    // A shock whose scale is 0 is not drawn (the bank's inputs are all zero with the bank off).
    const top = group.y - 250, firmD = map.disturbances.filter(d => d.target === 'firms' && active(d)), bankD = map.disturbances.filter(d => d.target === 'bank' && active(d));
    const nActive = map.disturbances.filter(active).length;
    const place = (d: typeof firmD[number], side: 'left' | 'right', pts: Point[]) => (lines[d.id] = pts, sig(d.id, pts, { color: SHOCK, letter: 'd', name: d.label, sub: probes?.stepAt === d.id ? `Step ${probes.stepLabel ?? '+1'} enters here` : undefined, value: value(d.signal), markAt: 1, labelSide: side, selected: on({ kind: 'signal', id: d.id }) || !!probes?.pins.some(p => p.flow === d.id), pick: probes?.show ? (e?: React.MouseEvent) => e && probes.show!({ flow: d.id, q: 's' }, e) : () => select({ kind: 'signal', id: d.id }), target: { kind: 'signal', id: d.id } }));
    if (!view.system) {
      const x = group.x + group.w / 2;
      if (nActive) sig('shocks', [[x, top + 60], [x, group.y]], { color: SHOCK, letter: 'd', name: 'Disturbance d', sub: probes?.stepAt && probes.stepAt.startsWith('d_') ? `Step ${probes.stepLabel ?? '+1'} in ${map.disturbances.find(x => x.id === probes.stepAt)?.label ?? ''}` : bv ? `Disturbances (${nActive})` : `Exogenous shocks & paths (${nActive})`, markAt: 1, labelSide: 'right', selected: selection.kind === 'shocks', pick: probes?.show && probes.stepAt && probes.stepAt !== 'y_reference' && probes.stepAt !== 'u_open' ? (e?: React.MouseEvent) => { if (e) probes.show!({ flow: probes.stepAt!, q: 's' }, e); } : () => select({ kind: 'shocks', id: '' }) });
    } else {
      // An open agent: the shock arrow runs on to the element it acts on (the path the drawing used to draw dashed).
      const into = (agent: string, side: 'left' | 'top', d: { element?: string }, i: number, n: number): Point[] => {
        if (!view.agents.includes(agent)) return [];
        const lay = map.layouts[agent], e = d.element ? map.elements.find(x => x.name === d.element && x.agent === agent) : undefined, A = circ(agent);
        if (!e || !e.pins || e.pins.length < 2) return [];
        return inputPath(side, i, n, lay.size as [number, number], e.pins).slice(1).map(([px, py]) => [A.x + px / lay.size[0] * A.w, A.y + py / lay.size[1] * A.h] as Point);
      };
      if (view.cpb) { const F = R.firms, Fc = circ('firms'), Fy = Fc.y, Fh = Fc.h; firmD.forEach((d, i) => { const x = group.x + 26 + i * 30, y = Fy + Fh * (i + 1) / (firmD.length + 1); place(d, 'left', [[x, top + (firmD.length - 1 - i) * 70], [x, y], [F.x, y], ...into('firms', 'left', d, i, firmD.length)]); }); }
      else firmD.forEach((d, i) => { const x = cpbRegion!.x + 40 + i * 45; place(d, 'left', [[x, top + (firmD.length - 1 - i) * 70], [x, cpbRegion!.y]]); });
      if (bv) map.disturbances.filter(d => d.target === 'households' && active(d)).forEach((d, i) => {
        const Hb = view.cpb ? R.households : cpbRegion!, x = Hb.x + Hb.w * (0.35 + 0.3 * i);
        place(d, 'right', [[x, top + 140], [x, Hb.y], ...(view.cpb ? into('households', 'top', d, i, 1) : [])]);
      });
      const B = view.finance ? R.bank : finRegion!;
      bankD.forEach((d, i) => { const x = B.x + B.w * (i + 1) / (bankD.length + 1); place(d, 'right', [[x, top + i * 70], [x, B.y], ...(view.finance ? into('bank', 'top', d, i, bankD.length) : [])]); });
    }
    // ---- probes: pinned plots and lines to CBS
    if (probes) {
      probes.charts.forEach(c => { if (c.kind === 'sens') pinDefault[c.id] = { x: ctrl.x, y: ctrl.y + ctrl.h + 160 }; });
      const col = { x: sensor.x + sensor.w + 260, y: group.y };
      // Big cards (guided tour): one row under the loop, and an invisible corner so 'Whole model' fits them too.
      const big = probes.cardSize, rowY = group.y + group.h + 200;
      const nCbs = big ? probes.charts.filter(c => c.kind === 'cbs').length : 0;
      // the CBS year-on-year card above CBS (right of a shock card above the market, if there is one)
      if (big) probes.charts.forEach(c => { if (c.kind === 'cbs') { const shockRight = probes.pins.some(q => q.flow.startsWith('d_')) ? group.x + group.w / 2 + 60 + big.w + 40 : -Infinity;
        pinDefault[c.id] = { x: Math.max(sensor.x + sensor.w / 2 - big.w * 0.65, shockRight), y: sensor.y - big.h - 140 }; } });
      if (big && nCbs) { const p = pinDefault.cbs; if (p) { block('cbsTL', { x: p.x, y: p.y, w: 1, h: 1 }, { tone: 'anchor' }, 0); block('cbsBR', { x: p.x + big.w * 1.3, y: p.y + big.h, w: 1, h: 1 }, { tone: 'anchor' }, 0); } }
      probes.pins.forEach((p, i) => {
        const info = probeInfo(map, p), start = railStart[p.flow], W = big?.w ?? PIN_W, H = big?.h ?? PIN_H;
        // big cards: inputs and inner flows from the left under Parliament, the outputs (price, year-on-year) from the
        // right under CBS, so each plot sits near the line it shows
        const isOut = (q: Probe) => q.flow === 'y_price' || q.flow === 'y_yoy' || q.flow === 'y_share' || q.flow === 'y_rent_cost', outs = probes.pins.filter(isOut), ins = probes.pins.filter(q => !isOut(q));
        const right = sensor.x + sensor.w + 170 * lab;
        // near the line it shows: a shock above the market beside its arrow, a subsidy above the Tax Authority,
        // the outputs under CBS on the right, anything else in the row under the loop
        const shocks = probes.pins.filter(q => q.flow.startsWith('d_')), isShock = p.flow.startsWith('d_'), isSub = p.flow === 'owner_subsidy' || p.flow === 'rental_subsidy';
        const others = ins.filter(q => !q.flow.startsWith('d_') && q.flow !== 'owner_subsidy' && q.flow !== 'rental_subsidy');
        const slot = !big ? { x: col.x, y: col.y + i * 170 }
          : isOut(p) ? { x: right + 50, y: sensor.y + sensor.h / 2 - big.h / 2 + outs.indexOf(p) * (big.h + 40) }  // right of the output line, at CBS height (not below the open market)
          : isShock ? (shocks.length > 1 ? { x: group.x + (shocks.indexOf(p) % 3) * (big.w + 30), y: group.y - 140 - (Math.ceil(shocks.length / 3) - Math.floor(shocks.indexOf(p) / 3)) * (big.h + 30) } : { x: group.x + group.w / 2 + 60, y: group.y - big.h - 140 })
          : isSub ? { x: ctrl.x + (p.flow === 'rental_subsidy' ? big.w + 60 : 0), y: ctrl.y - big.h - 140 }
          : { x: parl.x + others.indexOf(p) * (big.w + 60), y: rowY };
        const pos = probes.pos[`pin-${probeKey(p)}`] ?? slot;
        if (big) { block(`cardTL-${probeKey(p)}`, { x: pos.x, y: pos.y, w: 1, h: 1 }, { tone: 'anchor' }, 0); block(`cardBR-${probeKey(p)}`, { x: pos.x + W, y: pos.y + H, w: 1, h: 1 }, { tone: 'anchor' }, 0); }
        pinDefault[`pin-${probeKey(p)}`] = pos;
      });
      probes.sensed.forEach((p, i) => {
        const info = probeInfo(map, p), start = railStart[p.flow] ?? [group.x + group.w, group.y + group.h - 20 - 12 * i];
        const lowY = group.y + group.h + 40 + 14 * i, sx = sensor.x + 30 + 16 * i;
        sig(`probe-${probeKey(p)}`, [start, [start[0], lowY], [sx, lowY], [sx, sensor.y + sensor.h]], { color: '#6b4fa0', letter: p.q, dashed: true, markAt: 2, markDist: 40, name: info.f.short, pick: () => select({ kind: 'probe', id: probeKey(p) }) });
      });
    }
    // Figure mode (report chapter on the CPB model): only the CPB Four Quadrants box with its agents and the flows between them
    if (figure && view.cpb) {
      const keep = new Set(['anchor', 'cpb', ...CPB_AGENTS]), inner = new Set(map.flows.filter(f => CPB_AGENTS.includes(f.source) && CPB_AGENTS.includes(f.target)).map(f => f.id));
      for (let i = nodes.length - 1; i >= 0; i--) if (!keep.has(nodes[i].id)) nodes.splice(i, 1);
      for (let i = edges.length - 1; i >= 0; i--) if (!inner.has(edges[i].id)) edges.splice(i, 1);
    }
    // Bank off (the original CPB model): leave the financial sector out of the drawing altogether.
    if (!bankOn) {
      const bankFlows = new Set(map.flows.filter(f => f.source === 'bank' || f.target === 'bank').map(f => f.id));
      const bankShocks = new Set(map.disturbances.filter(d => d.target === 'bank').map(d => d.id));
      for (let i = nodes.length - 1; i >= 0; i--) if (nodes[i].id === 'finance' || nodes[i].id === 'bank') nodes.splice(i, 1);
      for (let i = edges.length - 1; i >= 0; i--) if (bankFlows.has(edges[i].id) || bankShocks.has(edges[i].id)) edges.splice(i, 1);
    }
    // After a run, dots move along every connection in the direction of the flow (supervisor 2.5).
    if (result) edges.forEach(e => { (e.data as { animate?: boolean }).animate = true; });
    return { nodes, edges, pinDefault, lines };
  }, [map, view, scenario, result, selection, menu, flip, probes, step, lab, hl, bv, natW, figure]);
}

function Canvas({ hl, setHl, map, view, setView, scenario, result, at, selection, select, focus, menu, flip, probes, step, steps, lab = 1, chips, figure = false }: { figure?: boolean; chips?: ChipCtx; hl: Formula | null; setHl: (f: Formula | null) => void; lab?: number; map: MapData; view: View; setView: (v: View) => void; scenario: Scenario; result: Result | null; at: number; selection: Selection; select: (s: Selection) => void; focus: { id: string; n: number }; menu: (s: Selection, e: React.MouseEvent) => void; flip: () => void; probes: ProbeState; step: (k: GainKey, up: boolean) => void; steps?: StepData }) {
  const flow = useReactFlow();
  const bvc = useContext(BankCtx);
  const toggle = (k: string) => {
    if (k === 'system') setView({ system: !view.system, cpb: false, finance: false, controller: view.controller, agents: [], noParliament: view.noParliament, ctrlScale: view.ctrlScale });
    else if (k === 'controller') setView({ ...view, controller: !view.controller });
    else if (k.startsWith('ctrl-scale:')) setView({ ...view, ctrlScale: Number(k.slice(11)) });
    else if (k === 'cbs') setView({ ...view, cbs: !view.cbs });
    else if (k === 'cpb') setView({ ...view, cpb: !view.cpb, agents: view.agents.filter(a => !CPB_AGENTS.includes(a)) });
    else if (k === 'finance') setView({ ...view, finance: !view.finance, agents: view.agents.filter(a => a !== 'bank') });
    else setView({ ...view, agents: view.agents.includes(k) ? view.agents.filter(a => a !== k) : [...view.agents, k] });
  };
  const withShow = useMemo<ProbeState>(() => ({ ...probes, show: (p, e) => { const at = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY }); const c = probes.cardSize ?? { w: PIN_W, h: PIN_H }; probes.place(p, { x: at.x - c.w / 2, y: at.y - c.h - 14 }); } }), [probes, flow]);
  const natW = useFormulaWidths();
  const graph = useModelGraph(map, view, toggle, scenario, result, at, selection, select, menu, flip, withShow, step, lab, hl, setHl, natW, figure);
  const shown = graph.nodes;
  useEffect(() => {
    const id = focus.id;
    // A block that just opened may not be measured yet; fitView on it then does nothing (returns false), so retry.
    let t = 0, tries = 0, live = true;
    const go = async () => {
      // the opened controller: zoom in less, so the loop around it stays in view (Jesse, 11 Nov 2026)
      const ok = id ? await flow.fitView({ nodes: id === 'cbs-card' ? [{ id: 'cbsTL' }, { id: 'cbsBR' }] : id.startsWith('card:') ? [{ id: `cardTL-${id.slice(5)}` }, { id: `cardBR-${id.slice(5)}` }] : [{ id }], duration: 600, padding: id === 'controller' ? .9 : id === 'cbs-card' || id.startsWith('card:') ? .45 : .12 }) : await flow.fitView({ duration: 600, padding: .04 });
      if (live && !ok && ++tries < 12) t = window.setTimeout(go, 150);
    };
    t = window.setTimeout(go, 40);
    return () => { live = false; clearTimeout(t); };
  }, [focus.n]);
  return <AtContext.Provider value={{ result, at }}><ReactFlow className={hl ? 'hl-on' : undefined} nodes={shown} edges={graph.edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} zoomOnDoubleClick={false} fitView fitViewOptions={{ padding: .04 }} nodesConnectable={false} nodesDraggable={false} elementsSelectable={false} minZoom={.1} maxZoom={4} proOptions={{ hideAttribution: true }}
    onNodeContextMenu={(e, n) => { if (n.id === 'parliament' || n.id === 'sum') { e.preventDefault(); menu({ kind: 'agent', id: n.id }, e); } }}
    onNodeClick={(_, n) => {
      if (n.id === 'sensor' && view.cbs) return;
      if (n.id === 'sensor') { const at = flow.screenToFlowPosition({ x: _.clientX, y: _.clientY }); probes.addChart({ id: 'cbs', kind: 'cbs' }, probes.cardSize ? undefined : { x: at.x - 190, y: at.y - 230 }); }  // tours: the card's own place above CBS
      else if (n.id === 'parliament') select({ kind: 'signal', id: 'y_reference' });
      else if (n.id === 'sum') select({ kind: 'signal', id: 'y_error' });
      else if (n.id === 'controller') { select({ kind: 'agent', id: 'controller' }); if (!view.controller) toggle('controller'); }
      else if (['system', 'cpb', 'finance'].includes(n.id)) { const k = n.id as 'system' | 'cpb' | 'finance'; if (!view[k]) toggle(k); }
      else if (map.agents[n.id]) { select({ kind: 'agent', id: n.id }); if (!view.agents.includes(n.id)) toggle(n.id); }
    }}><Controls showInteractive={false}/><StickyHeaders nodes={graph.nodes as Node<BlockData>[]} lab={lab}/><PinLayer map={map} probes={withShow} result={result} at={at} fallback={graph.pinDefault} steps={steps} lines={graph.lines}/>{chips && !bvc && <CanvasChips nodes={graph.nodes} scenario={scenario} chips={chips} map={map}/>}</ReactFlow></AtContext.Provider>;
}

const TOUR_CARD = { w: 700, h: 400 };
const GUIDE_CARD = { w: 380, h: 220 };  // guided tour: smaller plot cards, so they cover less of the circuit (Jesse, 11 Nov 2026)  // plot cards in the guided tour, model units (readable at the whole-model zoom)
const CLOSED: View = { system: false, cpb: false, finance: false, controller: false, agents: [] };
type TfPicks = { input?: Pick; output?: Pick };
type MenuState = { x: number; y: number; target: Selection; label: string };
export function ModelMap({ scenario, result, pinned, zn, shockShow, busy, run, stale, setFeedback, update, design, setDesign, cbs, lag, left, cpb, tour, guideCmd, onSnap, forceChips }: { stale?: boolean; forceChips?: { ctrl?: boolean; market?: boolean }; guideCmd?: GuideCmd; onSnap?: (s: Snap) => void; tour?: { n: number; pins: Probe[]; ident?: boolean; tuning?: boolean; compare?: boolean; cbs?: boolean; expand?: boolean; formulas?: boolean; reject?: string; robust?: boolean; guide?: boolean; compareLabel?: string; rejectSize?: boolean; robustOnly?: boolean }; scenario: Scenario; result: Result | null; pinned: Result | null; zn?: Result | null; shockShow?: Result | null; busy: boolean; run: () => void; setFeedback: (on: boolean) => void; update: (patch: Partial<Scenario>) => void; design: Design; setDesign: (d: Design) => void; cbs?: CbsData; lag: number; left?: React.ReactNode; cpb?: { year: number[]; yoy: number[] } }) {
  const [leftOpen, setLeftOpen] = useState(false);  // side panels start closed (Jesse, 10 Nov 2026)
  const [map, setMap] = useState<MapData>();
  const [error, setError] = useState('');
  const [view, setViewState] = useState<View>(CLOSED);
  const [focus, setFocus] = useState({ id: '', n: 0 });
  const [selection, setSelection] = useState<Selection>(NONE);
  // A clicked CPB equation lights up the flows and elements it describes (on the blocks or in the side panel).
  const [hl, setHl] = useState<Formula | null>(null);
  useEffect(() => { if (!view.formulas) setHl(null); }, [view.formulas]);
  const [index, setIndex] = useState<number>(), [played, setPlayed] = useState(false), [showZn, setShowZn] = useState(false), [plays, setPlays] = useState(0), [stepSeen, setStepSeen] = useState('');
  const [tf, setTf] = useState<TfPicks>({});
  const [menuAt, setMenuAt] = useState<MenuState | null>(null);
  const [dock, setDock] = useState(false);
  // Label size: block headers, signal names and the closed Parliament / Tax Authority / CBS blocks (for screenshots).
  const [lab, setLab] = useState(() => { try { const v = Number(localStorage.getItem('hpl.labelSize')); return v >= 1 && v <= 2.5 ? v : 1.3; } catch { return 1.3; } });
  useEffect(() => { try { localStorage.setItem('hpl.labelSize', String(lab)); } catch { /* storage blocked */ } }, [lab]);
  const [shooting, setShooting] = useState(false);
  // Figure mode (?figure=1): a clean, white canvas for thesis figures; "keep highlight" keeps a clicked equation's flows lit
  const [figure, setFigure] = useState(() => { try { return new URLSearchParams(location.search).get('figure') === '1'; } catch { return false; } });
  // Labels: element names, formula symbols or both (normal view and figure mode); Hide faded: figure mode export
  const [labelMode, setLabelMode] = useState<LabelMode>('names'), [hideFaded, setHideFaded] = useState(false);  // off: the rest of the circuit stays faintly visible (Jesse)
  const labelState = useMemo<LabelState>(() => { const f = hl ? TERMS.find(t => t.id === hl.id) : undefined;
    return { mode: labelMode, symbols: labelMode === 'names' ? {} : symbolsFor(hl?.id ?? null), nodes: TERMS.flatMap(t => t.node && (t === f || labelMode !== 'names') ? [t.node] : []), figure }; }, [labelMode, hl, figure]);
  const download = (name: string, text: string, type: string) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); URL.revokeObjectURL(a.href); };
  const exportMapping = () => { download('figure_mapping.csv', mappingCsv(), 'text/csv'); download('figure_mapping.tex', mappingTex(), 'text/x-tex'); };
  const flipFigure = () => setFigure(f => { const n = !f; try { const u = new URL(location.href); if (n) u.searchParams.set('figure', '1'); else u.searchParams.delete('figure'); history.replaceState(null, '', u); } catch { /* ignore */ } return n; });
  const bodyRef = useRef<HTMLDivElement>(null);
  // Figure mode: crop to the drawn content (visible nodes and edges, or only the opened agents) plus a 24 px margin
  const contentBox = (canvas: HTMLElement, selectionOnly: boolean) => {
    const c = canvas.getBoundingClientRect(), vis = (el: globalThis.Element) => getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none';
    const sel = selectionOnly ? view.agents.map(a => `.react-flow__node[data-id="${a}"]`).join(',') : '.react-flow__node:not([data-id="anchor"]), .react-flow__edge';
    const rs = sel ? [...canvas.querySelectorAll(sel)].filter(vis).map(el => el.getBoundingClientRect()).filter(r => r.width > 2 && r.height > 2) : [];
    if (!rs.length) return undefined;
    const m = 24, x0 = Math.max(0, Math.min(...rs.map(r => r.left)) - c.left - m), y0 = Math.max(0, Math.min(...rs.map(r => r.top)) - c.top - m);
    const x1 = Math.min(c.width, Math.max(...rs.map(r => r.right)) - c.left + m), y1 = Math.min(c.height, Math.max(...rs.map(r => r.bottom)) - c.top + m);
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  };
  const shootSelection = async () => {
    const canvas = canvasRef.current; if (!canvas) return; setShooting(true);
    // first zoom to the opened agent(s), so they are fully on the canvas (no sticky headers, nothing clipped)
    setFocus(f => ({ id: view.agents.length === 1 ? view.agents[0] : '', n: f.n + 1 })); await new Promise(r => setTimeout(r, 900));
    try { await savePng(canvas, 'figure-' + (view.agents.join('-') || 'map') + '-selection', 4, contentBox(canvas, true)); }
    catch (e) { console.error(e); alert('Screenshot failed: ' + (e instanceof Error ? e.message : String(e))); } finally { setShooting(false); }
  };
  const shootCanvas = async () => {
    // The canvas, plus the side panels when they are open (collapsed handles are left out).
    const body = bodyRef.current, canvas = canvasRef.current; if (!body || !canvas) return;
    setShooting(true);
    try {
      if (figure) await savePng(canvas, 'figure-' + (view.agents.length ? view.agents.join('-') : 'map'), 4, contentBox(canvas, false));
      else await savePng(dock || (left && leftOpen) ? body : canvas, 'housing-model-canvas');
    }
    catch (e) { console.error(e); alert('Screenshot failed: ' + (e instanceof Error ? e.message : String(e))); }
    finally { setShooting(false); }
  };
  const [pins, setPins] = useState<Probe[]>([]);
  const [sensed, setSensed] = useState<Probe[]>([]);
  const [pinPos, setPinPos] = useState<Record<string, { x: number; y: number }>>({});
  const [charts, setCharts] = useState<ChartCard[]>([]);
  // Proposed model parameters from the identification panel: run them too, and draw that run as a blue dashed
  // line in the plot cards next to the current run (so a new adjustment time or cycle shows on the canvas).
  const [previewScale, setPreviewScale] = useState<Record<string, number> | null>(null);
  const [ghost, setGhost] = useState<Result | null>(null);
  useEffect(() => {
    if (!previewScale) { setGhost(null); return; }
    let live = true;
    api<Result>('/runs', { ...scenario, param_scale: previewScale }).then(r => { if (live) setGhost(r); }).catch(() => { if (live) setGhost(null); });
    return () => { live = false; };
  }, [JSON.stringify(previewScale), result]); // eslint-disable-line react-hooks/exhaustive-deps
  // Tour step: closed blocks, the whole model in view, and only this step's plot cards (they play with the new run).
  useEffect(() => {
    if (!tour) return;
    // Guided tour: each step starts with the blocks closed, its own plot cards (and the CBS card) and no selection.
    if (tour.guide) {
      setViewState(v => ({ ...CLOSED, noParliament: v.noParliament, ctrlScale: v.ctrlScale })); setSelection(NONE); setDock(false); setLeftOpen(false);
      setPins(tour.pins); setSensed([]); setPinPos({}); setCharts(tour.cbs ? [{ id: 'cbs', kind: 'cbs' }] : []); setShowZn(false); setStepInput('y_reference');
      setFocus(f => ({ id: '', n: f.n + 1 })); return;
    }
    // expand: the Housing Market fully open, every CPB agent showing its elements (the financial sector too when the bank is on).
    if (tour.reject) setStepInput(tour.reject);
    setViewState(v => ({ ...(tour.formulas ? { system: true, cpb: true, finance: false, controller: false, agents: [], formulas: true } : tour.reject ? { ...CLOSED, controller: true } : tour.expand ? { system: true, cpb: true, finance: scenario.bank, controller: false, agents: scenario.bank ? [...CPB_AGENTS, 'bank'] : [...CPB_AGENTS] } : tour.tuning ? { ...CLOSED, controller: true } : CLOSED), noParliament: v.noParliament, ctrlScale: v.ctrlScale })); setSelection(tour.ident ? { kind: 'ident', id: '' } : tour.tuning || tour.reject ? { kind: 'agent', id: 'controller' } : tour.robust ? { kind: 'robust', id: '' } : NONE); setCharts([]); setSensed([]); setPinPos({}); setPins([]);  // no plots open by themselves: the step sets up the analysis, the user opens it setFocus(f => ({ id: tour.expand || tour.formulas ? 'system' : '', n: f.n + 1 }));
  }, [tour?.n]);
  // Guided tour: one-off commands (open the CPB with its equations, pick the shock of a step response)
  useEffect(() => {
    if (!guideCmd?.n) return;
    if (guideCmd.view) setView({ ...view, ...guideCmd.view });
    if (guideCmd.stepInput) pickStep(guideCmd.stepInput);
    if (guideCmd.fit) setFocus(f => ({ id: '', n: f.n + 1 }));
    if (guideCmd.focus) { const id = guideCmd.focus; window.setTimeout(() => setFocus(f => ({ id, n: f.n + 1 })), 700); }
    if (guideCmd.dock !== undefined) setDock(guideCmd.dock);
  }, [guideCmd?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  // the disturbance arrow opens the side panel with every shock and input
  useEffect(() => {
    if (selection.kind !== 'shocks') return;
    if (tour?.guide && map) setPins(old => [...old, ...map.disturbances.filter(d => !old.some(p => p.flow === d.id)).map(d => ({ flow: d.id, q: 's' as const }))]);
    else setDock(true);
  }, [selection.kind]); // eslint-disable-line react-hooks/exhaustive-deps
  const [bodeFrom, setBodeFrom] = useState<Probe | null>(null);
  const ctx = useMemo<Ctx>(() => ({ K: [scenario.kp, scenario.ki, scenario.kd], filtered: scenario.derivative_filter, feedback: scenario.feedback, settling: design.settling, overshoot: design.overshoot }), [scenario.kp, scenario.ki, scenario.kd, scenario.derivative_filter, scenario.feedback, design.settling, design.overshoot]);
  const latest = useRef({ scenario, update }); latest.current = { scenario, update };
  const tuning = selection.kind === 'agent' && selection.id === 'controller';
  // System identification: pinned plots show the open-loop step response to u, as while tuning.
  // In the tour the identification dock sits next to time plots, so the cards stay time plots there.
  // Disturbance rejection step of the tour: the cards show step responses to a unit shock (closed loop, open loop grey)
  const tourReject = !!tour?.reject || !!tour?.rejectSize;
  // What the plot cards show: chosen with the toolbar switch, or (not chosen) step responses while the controller or the
  // identification is selected. The disturbance-rejection step starts on step responses, so a misclick keeps them.
  const [plotMode, setPlotMode] = useState<'time' | 'step' | null>(null);
  useEffect(() => { setPlotMode(tour?.reject ? 'step' : null); }, [tour?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  // Bank mode: no linear step responses (they belong to the housing PID), the cards always show the bank run
  const inBank = !!useContext(BankCtx);
  const ident = selection.kind === 'ident', stepping = !inBank && (plotMode ? plotMode === 'step' : (!tour && (tuning || ident)) || (tourReject && tuning));
  const [stepChoice, setStepInput] = useState('y_reference');
  // choosing the shock of a step response also plots that shock (its card replaces the previous shock's)
  const pickStep = (id: string) => { setStepInput(id); if (id.startsWith('d_')) setPins(old => [...old.filter(p => !p.flow.startsWith('d_')), { flow: id, q: 's' }]); };
  // Loop open: the target does nothing, so the default step is the controller output u.
  const stepInput = ident ? 'u_open' : !scenario.feedback && stepChoice === 'y_reference' ? 'u_open' : stepChoice;
  const [steps, setSteps] = useState<StepData>(null);
  // guided tour: a step response shows only once Play is pressed for this input and these gains
  const stepKey = `${stepInput}|${scenario.kp}|${scenario.ki}|${scenario.kd}|${scenario.derivative_filter}`;
  useEffect(() => {
    const wantYoy = pins.some(p => p.flow === 'y_yoy') || charts.some(c => c.kind === 'cbs');
    const outs0 = [...pins.map(p => probeInfo(map!, p).step).filter(Boolean), ...(wantYoy ? [{ kind: 'signal', id: 'y_price' } as const] : [])];
    const outs = outs0.filter((o, i) => outs0.findIndex(q => q!.kind === o!.kind && q!.id === o!.id) === i);
    if (!stepping || !map || !outs.length) { setSteps(null); return; }
    const timer = window.setTimeout(() => {
      const ask = (feedback: boolean) => api<NonNullable<StepData>>('/analysis/steps', { input: { kind: 'signal', id: stepInput }, outputs: outs, feedback, K: [scenario.kp, scenario.ki, scenario.kd], filtered: scenario.derivative_filter, scale: { ...(scenario.param_scale ?? {}), ...(scenario.bank ? {} : { NO_BANK: 0 }) } });
      const closed = scenario.feedback && stepInput !== 'u_open';
      // Disturbance rejection (tour and free use): the same shock without the controller, for comparison (grey dashed)
      // (only for a disturbance: a step in the target r has no open-loop response; a failed comparison is left out)
      Promise.all([ask(closed), closed && stepInput.startsWith('d_') ? ask(false).catch(() => null) : Promise.resolve(null)])
        .then(([c, o]) => setSteps({ ...c, inputId: stepInput, reject: tourReject, ...(o ? { open: o.responses } : {}) })).catch(e => setSteps({ input: '', responses: Object.fromEntries(outs.map(o => [`${o!.kind}:${o!.id}`, { error: (e as Error).message }])) }));
    }, 120);
    return () => clearTimeout(timer);
  }, [stepping, map, pins, stepInput, scenario.feedback, scenario.kp, scenario.ki, scenario.kd, scenario.derivative_filter, scenario.param_scale, scenario.bank, tourReject, charts]);
  const stepGain = useCallback((k: GainKey, up: boolean) => latest.current.update(stepPatch(latest.current.scenario, k, up)), []);
  const same = (a: Probe) => (b: Probe) => a.flow === b.flow && a.q === b.q;
  const toggleIn = (set: React.Dispatch<React.SetStateAction<Probe[]>>) => (p: Probe) => set(old => old.some(same(p)) ? old.filter(x => !same(p)(x)) : [...old, p]);
  const probeState = useMemo<ProbeState>(() => ({ compare: selection.kind === 'ident' && ghost ? { result: ghost, color: '#2F6FB5', label: 'proposed (blue, same start)', align: true } : tour?.compare && pinned ? { result: pinned, color: '#8a9692', label: tour.compareLabel ?? 'open loop (grey dashed)', align: false } : null, cardSize: tour?.guide ? GUIDE_CARD : tour ? TOUR_CARD : undefined, pins, sensed, unpin: p => setPins(old => old.filter(x => !same(p)(x))), dock: p => { setDock(true); setSelection(p.q === 's' && loopSig(map, p.flow) ? loopSig(map, p.flow)!.dock as Selection : { kind: 'probe', id: `${p.flow}:${p.q}` }); }, muted: !!result && !played, waiting: !!tour?.guide && !!stale, waitingStep: !!tour?.guide && stepping && stepSeen !== stepKey, shockShow, compare2: showZn && zn && tour?.compare ? { result: zn, color: '#7cc96a', label: 'Ziegler–Nichols PID (light green dotted)' } : null, stepAt: stepping ? stepInput : undefined, stepLabel: stepping ? (stepInput === 'd_interest' ? '+1 percentage point' : tourReject && SHOCK_STEP[stepInput] ? SHOCK_STEP[stepInput][1].split(' (')[0] : '+1') : undefined, charts, bodeFrom, setBodeFrom, ctx, removeChart: id => setCharts(old => old.filter(c => c.id !== id)), cbs, lag, cpb, openSensor: () => { setDock(true); setSelection({ kind: 'sensor', id: '' }); },
    addChart: (c, at) => { setCharts(old => old.some(x => x.id === c.id) ? old : [...old, c]); if (at) setPinPos(old => ({ ...old, [c.id]: at })); },
    addBode: (from, to, at) => { const id = `bode-${probeKey(from)}-${probeKey(to)}`; setCharts(old => old.some(c => c.id === id) ? old : [...old, { id, kind: 'bode', from, to }]); setPinPos(old => ({ ...old, [id]: at })); setBodeFrom(null); }, pos: pinPos, setPos: (id, q) => setPinPos(old => ({ ...old, [id]: q })), place: (p, at) => { setPins(old => old.some(same(p)) ? old : [...old, p]); setPinPos(old => ({ ...old, [`pin-${p.flow}:${p.q}`]: at })); }, sense: toggleIn(setSensed) }), [pins, sensed, pinPos, tuning, stepInput, charts, bodeFrom, ctx, cbs, lag, cpb, !!tour, ghost, selection.kind, tour?.compare, pinned, tourReject, stepping, result, played, zn, showZn, shockShow, stale, stepSeen, stepKey]);
  const actions: ProbeActions = { addSens: () => setCharts(old => old.some(c => c.kind === 'sens') ? old.filter(c => c.kind !== 'sens') : [...old, { id: 'sens', kind: 'sens' }]), hasSens: charts.some(c => c.kind === 'sens'), pinned: p => pins.some(same(p)), sensed: p => sensed.some(same(p)), pin: toggleIn(setPins), sense: toggleIn(setSensed), list: sensed, count: pins.length, stepInput, setStepInput };
  const canvasRef = useRef<HTMLDivElement>(null);
  const labelOf = (t: Selection) => !map ? t.id : t.kind === 'flow' ? map.flows.find(f => f.id === t.id)?.label ?? t.id : t.kind === 'signal' ? [...map.disturbances, ...map.outputs].find(o => o.id === t.id)?.label ?? t.id : t.kind === 'element' ? namePlain(t.id) : t.id;
  const openMenu = useCallback((target: Selection, e: React.MouseEvent) => {
    e.preventDefault(); const r = canvasRef.current!.getBoundingClientRect();
    setMenuAt({ x: e.clientX - r.left, y: e.clientY - r.top, target, label: '' });
  }, []);
  useEffect(() => { const close = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuAt(null); }; window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close); }, []);
  const choose = (role: 'input' | 'output') => {
    if (!menuAt) return; const t = menuAt.target as { kind: Pick['kind']; id: string };
    setTf(old => ({ ...old, [role]: { kind: t.kind, id: t.id, label: labelOf(t) } })); setSelection({ kind: 'tf', id: '' }); setMenuAt(null);
  };
  const bvMap = useContext(BankCtx);
  useEffect(() => { api<MapData>('/model/map').then(m => setMap(bvMap ? bvMap.patch(m) : m)).catch(e => setError(e.message)); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // The canvas fills the window below the bars above it, down to the action bar (bars come and go with the tours).
  useEffect(() => {
    const fit = () => { const c = canvasRef.current; if (!c) return; const top = c.getBoundingClientRect().top + window.scrollY, foot = (document.querySelector('.action-bar') as HTMLElement | null)?.offsetHeight ?? 0;
      document.documentElement.style.setProperty('--canvas-h', `${Math.max(420, window.innerHeight - top - foot - 14)}px`); };
    fit(); const ro = new ResizeObserver(fit); ro.observe(document.body); window.addEventListener('resize', fit);
    return () => { ro.disconnect(); window.removeEventListener('resize', fit); };
  }, [map]);
  const at = result ? Math.min(index ?? Math.floor(result.year.length / 2), result.year.length - 1) : 0;
  // Play: the year marker runs through the simulation (about 7 s), so the plots and values unfold in time.
  const [playing, setPlaying] = useState(false);
  // A new run shows the whole period at once (lines dark to the end); Play runs it through time on request.
  // Play with changed inputs (guided tour): run first, then play the new run from the start
  const playNext = useRef(false);
  useEffect(() => { if (!result) return; if (playNext.current) { playNext.current = false; setPlayed(true); setPlays(n => n + 1); setIndex(0); setPlaying(true); } else { setPlaying(false); setIndex(result.year.length - 1); } }, [result]);
  // Plots stay grey until Play is pressed once; a new tour step starts grey again (re-runs after a gain change do not).
  useEffect(() => { setPlayed(false); }, [tour?.n]);
  useEffect(() => {
    if (!playing || !result) return;
    const n = result.year.length, t = window.setInterval(() => setIndex(i => { const next = Math.min((i ?? 0) + 2, n - 1); if (next >= n - 1) setPlaying(false); return next; }), 50);
    return () => clearInterval(t);
  }, [playing, result]);
  const togglePlay = () => { if (stepping && !playing) setStepSeen(stepKey); if (tour?.guide && stale && !playing) { if (!busy) { playNext.current = true; run(); } return; } if (!result) return; setPlayed(true); if (!playing) setPlays(n => n + 1); if (!playing && at >= result.year.length - 1) setIndex(0); setPlaying(p => !p); };
  // The guided tour follows the visitor's clicks through this snapshot.
  useEffect(() => { onSnap?.({ n: tour?.n ?? 0, playing, finance: view.finance, agents: view.agents, system: view.system, cpb: view.cpb, controller: view.controller, formulas: !!view.formulas, hl: hl?.id ?? null, pins: pins.map(probeKey), charts: charts.map(c => c.kind), plays, stepping, sel: `${selection.kind}:${selection.id}`, stepInput, showZn }); },
    [view, hl, pins, charts, plays, playing, stepping, selection, stepInput, showZn, tour?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  const setView = (next: View) => {
    // resizing the controller only: keep the zoom (no refit), so the block grows under the mouse
    if (next.ctrlScale !== view.ctrlScale && JSON.stringify({ ...next, ctrlScale: 0 }) === JSON.stringify({ ...view, ctrlScale: 0 })) { setViewState(next); return; }
    const opened = next.agents.find(a => !view.agents.includes(a)) ?? (next.controller && !view.controller ? 'controller' : next.cbs && !view.cbs ? 'sensor' : next.cpb && !view.cpb ? 'cpb' : next.finance && !view.finance ? 'finance' : next.system && !view.system ? 'system' : '');
    const parent = (a: string) => CPB_AGENTS.includes(a) ? 'cpb' : a === 'bank' ? 'finance' : 'system';
    const closedAgent = view.agents.find(a => !next.agents.includes(a));
    const closed = closedAgent ? parent(closedAgent) : (view.cpb && !next.cpb) || (view.finance && !next.finance) ? 'system' : '';
    setViewState(next); setFocus(f => ({ id: opened || (next.system ? closed : ''), n: f.n + 1 }));
  };
  const enter = (id: string) => setView(id === 'controller' ? { ...view, controller: true } : { ...view, system: true, cpb: view.cpb || CPB_AGENTS.includes(id), finance: view.finance || id === 'bank', agents: view.agents.includes(id) ? view.agents : [...view.agents, id] });
  if (error) return <div role="alert" className="notice bad">{error}</div>;
  if (!map) return <section className="panel"><p className="muted">Loading the model map…</p></section>;
  return <section className="panel map-panel">
    <div className="map-head"><div className="row">
      <button className="ghost" onClick={() => setFocus(f => ({ id: '', n: f.n + 1 }))}><Maximize2 size={14}/> Whole model</button>
      <button className="ghost" disabled={!view.system && !view.controller} onClick={() => setView({ ...CLOSED, noParliament: view.noParliament, ctrlScale: view.ctrlScale })}><Minus size={14}/> Collapse all</button>
      {!bvMap && <><button data-guide="ident" className={ident ? 'secondary' : 'ghost'} title="Open loop: poles and step response from the subsidy to the house price, and change the model parameters" onClick={() => { if (ident) { setSelection({ kind: 'none', id: '' }); return; } setDock(true); setSelection({ kind: 'ident', id: '' }); setPins(old => old.some(p => p.flow === 'y_price' && p.q === 's') ? old : [...old, { flow: 'y_price', q: 's' }]); }}><Activity size={14}/> Identify system</button>
      <button data-guide="robust" className={selection.kind === 'robust' ? 'secondary' : 'ghost'} title="S, T and KS of the current controller against the limits, and random markets, in the side panel" onClick={() => { if (selection.kind === 'robust') { setSelection({ kind: 'none', id: '' }); return; } setDock(true); setSelection({ kind: 'robust', id: '' }); }}><ShieldCheck size={14}/> Robustness</button>
      <button className={view.formulas ? 'secondary' : 'ghost'} aria-pressed={!!view.formulas} title="Show the CPB equations on the agents (click one to light up its flows and elements)" onClick={() => { setView(view.formulas ? { ...view, formulas: false } : { ...view, system: true, cpb: true, formulas: true }); }}><Sigma size={14}/> CPB formulas</button></>}
      <button className="ghost" data-no-shot title="Save the canvas (and the open side panels) as a high-resolution PNG (3x)" disabled={shooting} onClick={shootCanvas}>{shooting ? <LoaderCircle className="spin" size={14}/> : <Camera size={14}/>} {figure ? 'Save figure' : 'Screenshot canvas'}</button>
      <button className={figure ? 'secondary' : 'ghost'} data-no-shot aria-pressed={figure} title="Figure mode: white background, no buttons or hints, fixed formula size; the screenshot is saved at 4x for the thesis" onClick={flipFigure}><ImageIcon size={14}/> Figure mode</button>
      <label className="keep-hl" data-no-shot title="Element labels on the circuits: their names, the symbols of the CPB equations, or both">Labels <select aria-label="Element labels" value={labelMode} onChange={e => setLabelMode(e.target.value as LabelMode)}><option value="names">names</option><option value="symbols">symbols</option><option value="both">both</option></select></label>
      {(figure || view.formulas) && <button className="ghost" data-no-shot title="Download the element → symbol → meaning → equation table (CSV and LaTeX booktabs) for under the figure" onClick={exportMapping}>Export mapping</button>}
      {figure && <><label className="keep-hl" data-no-shot title="Leave out everything drawn faded (outside the highlighted equation, or inactive in this run)"><input type="checkbox" checked={hideFaded} onChange={e => setHideFaded(e.target.checked)}/> hide faded</label>
        <button className="ghost" data-no-shot disabled={shooting || !view.agents.length} title="Save only the opened agent(s), cropped, at 4x" onClick={shootSelection}>Save selection</button></>}
      {figure && <label className="keep-hl" data-no-shot title="Light up the flows and elements of one CPB equation in the figure (the equation itself goes into the report)">Highlight <select aria-label="Highlight formula" value={hl?.id ?? ''} onChange={e => setHl(Object.values(FORMULAS).flat().find(f => f.id === e.target.value) ?? null)}>
        <option value="">none</option>{Object.values(FORMULAS).flat().map(f => <option key={f.id} value={f.id}>{f.title} ({f.no})</option>)}</select></label>}
      <label className="label-size" title="Size of block headers, signal names and the Parliament, Tax Authority and CBS blocks">Label size <output>{lab.toFixed(1)}×</output><input type="range" aria-label="Label size" min={1} max={2.5} step={0.1} value={lab} onChange={e => setLab(Number(e.target.value))}/></label>
    </div>
      {zn && tour?.compare && <button data-guide="zn-compare" className={showZn ? 'secondary' : 'ghost'} aria-pressed={showZn} title="Add the aggressive Ziegler–Nichols PID on the same inputs to the plot cards, dotted" onClick={() => setShowZn(v => !v)}>⋯ Ziegler–Nichols PID</button>}
      {!bvMap && <div className="segmented small" role="group" aria-label="Plots show" title="What the plot cards on the canvas show: the simulated path over time, or the response to a step (choose the step's input in the controller panel)"><button className={!stepping ? 'active' : ''} aria-pressed={!stepping} onClick={() => setPlotMode('time')}>Time path</button><button data-guide="plot-step" className={stepping ? 'active' : ''} aria-pressed={stepping} onClick={() => setPlotMode('step')}>Step response</button></div>}
      <div className="segmented small" role="group" aria-label="Feedback"><button className={!scenario.feedback ? 'active' : ''} aria-pressed={!scenario.feedback} onClick={() => setFeedback(false)}>{bvMap ? 'Desk off' : 'Open loop'}</button><button className={scenario.feedback ? 'active' : ''} aria-pressed={scenario.feedback} onClick={() => setFeedback(true)}>{bvMap ? 'Desk on' : 'Closed loop'}</button></div>
      {result ? <label className="year-slider"><button type="button" className="ghost play" data-no-shot aria-label={playing ? 'Pause' : 'Play through time'} title={playing ? 'Pause' : 'Play: run the plots through time'} onClick={e => { e.preventDefault(); togglePlay(); }}>{playing ? <Pause size={14}/> : <Play size={14}/>}</button>Values in <output>{result.year[at].toFixed(1)}</output><input type="range" aria-label="Year for the values on the map" min={0} max={result.year.length - 1} value={at} onChange={e => { setPlaying(false); setPlayed(true); setIndex(Number(e.target.value)); }}/></label> : <button className="primary" disabled={busy} onClick={run}>Run to show values</button>}</div>
    <div className="map-body" ref={bodyRef} style={{ gridTemplateColumns: `${left ? (leftOpen ? '290px ' : '34px ') : ''}minmax(0,1fr) ${!dock ? '34px' : selection.kind === 'ident' || selection.kind === 'robust' ? '520px' : selection.kind === 'agent' && selection.id === 'controller' ? '460px' : '340px'}` }}>
      {left && (leftOpen ? <aside className="inspector left-dock"><button className="dock-toggle" aria-label="Collapse scenario panel" title="Collapse" onClick={() => setLeftOpen(false)}><Minus size={14}/></button>{left}</aside>
        : <button className="dock-handle" data-no-shot aria-label="Open scenario panel" title="Open scenario panel" onClick={() => setLeftOpen(true)}><ChevronRight size={16}/><span>Scenario</span></button>)}
      <div className={'map-canvas' + (playing ? ' playing' : '') + (figure ? ' figure-mode' : '') + (figure && hideFaded ? ' hide-faded' : '')} ref={canvasRef} style={{ ['--lab' as string]: lab, ['--eq' as string]: lab / 1.3 }} onClick={() => setMenuAt(null)}><ReactFlowProvider><LabelCtx.Provider value={labelState}><Canvas hl={hl} setHl={setHl} map={map} view={view} setView={setView} scenario={scenario} result={result} at={at} selection={selection} select={setSelection} focus={focus} menu={openMenu} flip={() => setFeedback(!scenario.feedback)} probes={probeState} step={stepGain} steps={stepping ? steps : null} lab={lab} figure={figure} chips={{ update, stepping, stepInput, setStepInput: pickStep, showCtrl: view.controller || tuning || !!forceChips?.ctrl, showMarket: view.system || (selection.kind === 'agent' && selection.id === 'system') || !!forceChips?.market }}/></LabelCtx.Provider></ReactFlowProvider>
        {menuAt && <div className="ctx-menu" role="menu" style={{ left: menuAt.x, top: menuAt.y }} onClick={e => e.stopPropagation()}>
          {menuAt.target.kind === 'agent' && (menuAt.target.id === 'parliament' || menuAt.target.id === 'sum') ? <>
            <p>{menuAt.target.id === 'parliament' ? 'Parliament' : 'Summing junction'}</p>
            {menuAt.target.id === 'parliament' && <button role="menuitem" onClick={() => { setView({ ...view, noParliament: true }); setMenuAt(null); }}>Remove Parliament</button>}
            {menuAt.target.id === 'sum' && <button role="menuitem" disabled={!view.noParliament} onClick={() => { setView({ ...view, noParliament: false }); setMenuAt(null); }}>Show Parliament again</button>}
          </> : <>
          <p>{labelOf(menuAt.target)}</p>
          <button role="menuitem" disabled={menuAt.target.kind === 'element' && !/^(I|V)/.test(menuAt.target.id) || (menuAt.target.kind === 'signal' && !menuAt.target.id.startsWith('d_'))} onClick={() => choose('input')}>Use as input</button>
          <button role="menuitem" disabled={menuAt.target.kind === 'signal' && menuAt.target.id.startsWith('d_')} onClick={() => choose('output')}>Use as output</button>
          <button role="menuitem" onClick={() => { setSelection(menuAt.target); setMenuAt(null); }}>Plot over time</button>
          {!bvMap && menuAt.target.kind === 'flow' && map.flows.some(f => f.id === menuAt.target.id && (f.source === 'bank' || f.target === 'bank')) && <button role="menuitem" onClick={() => { update({ bank: !scenario.bank }); setMenuAt(null); }}>{scenario.bank ? 'Close the bank ports (original CPB model)' : 'Reopen the bank ports'}</button>}
          </>}
        </div>}
        {view.noParliament && <button className="ghost small show-parl" data-no-shot onClick={() => setView({ ...view, noParliament: false })}>Show Parliament</button>}
        <div className="map-key"><span className="k money">Money port pair</span><span className="k real">Goods port pair</span><span className="k shock">d: shock</span><span className="k policy">{bvMap ? 'u: client rate' : 'u: subsidy'}</span><span className="muted">f: flow, e: incentive. Click + or a block to open it in place. Right-click two flows for a transfer function.</span></div>
      </div>
      {dock ? <aside className="inspector" aria-live="polite"><button className="dock-toggle" aria-label="Collapse panel" title="Collapse panel" onClick={() => setDock(false)}><Minus size={14}/></button>{bvMap?.inspect(selection) ?? <Inspector map={map} selection={selection} pick={setSelection} result={result} pinned={pinned} scenario={scenario} enter={enter} layer="" tf={tf} setTf={setTf} update={update} probes={actions} design={design} setDesign={setDesign} onPreview={setPreviewScale} auto={!!tour} reject={tourReject} robustOnly={!!tour?.robustOnly}/>}</aside>
        : <button className="dock-handle" data-no-shot aria-label="Open panel" title="Open panel" onClick={() => setDock(true)}><ChevronLeft size={16}/><span>Panel</span></button>}
    </div>
  </section>;
}
