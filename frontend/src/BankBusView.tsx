// Bank controls, bus view (25 Nov 2026): the same model as the control-loop view (the same agents, the same
// breadboards drawn by AgentCircuit, the same block styles), arranged around buses with the bank in the middle
// (Jesse and his supervisor). Every bus branch ends on the real terminal of its flow: the port and the return point
// from the netlist layout when the agent is open, the matching side of the tile when it is closed (as in the
// control-loop view). Top level: names only. Bank level 1: Operations, Accounting, ALCO, ALM Desk; level 2:
// the bank's breadboard (process), its financial statements (sensor), or the desk's op-amp breadboard. Numbers only in the accounts (Jesse).
// Bus structure after Q. Emanuels' DynaBI bus canvas: one bus per kind of exchange, two rails each (flow f, incentive
// u); here the rails carry each flow's port and return terminal. Values come from the same ngspice run.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ReactFlow, ReactFlowProvider, Controls, useReactFlow, type Node, type NodeProps } from '@xyflow/react';
import { Minus, Pause, Play, Plus } from 'lucide-react';
import { createPortal } from 'react-dom';
import { api } from './api';
import { AtContext, readTrace } from './ModelMap';
import { AgentCircuit, inputPath } from './Schematic';
import { BankStatements, KEY_INPUTS, StmtPlot } from './BankStatements';
import type { MapData, Result, Scenario, Selection } from './types';

type R = { x: number; y: number; w: number; h: number };
type P = [number, number];
type Open = Record<string, boolean>;
type Side = 'L' | 'R' | 'T' | 'B';
const LANE = 12, HEAD = 34, S = 0.5, TILE: P = [240, 140];
const NONE: Selection = { kind: 'none', id: '' };
// the statement boxes inside Accounting: ledger group and opened size
const STMT: [string, string, string][] = [['inc', 'Income statement', 'income'], ['eq', 'Equity statement', 'equity'], ['bal', 'Balance sheet', 'balance'], ['key', 'Key figures', 'ratios']];
const STMT_OPEN: Record<string, P> = { inc: [380, HEAD + 330], eq: [380, HEAD + 190], bal: [500, HEAD + 360], key: [380, HEAD + 270] };
// One bus per conserved quantity (Jesse, 25 Nov 2026): a bus is a node, so it carries one good only and its flows sum
// to zero. A market with a good and a payment gets two buses side by side (k of n): brown = real goods, green = money.
type Bus = { id: string; label: string; color: string; a: string; b: string; flows: string[]; k?: number; n?: number };
const REAL = '#a8660c', MONEY = '#3f8f4f';  // as the control-loop view: goods brown, money green
const BUSES: Bus[] = [
  { id: 'houses', label: 'Houses bus (#)', color: REAL, a: 'constructors', b: 'investors', flows: ['houses'], k: 0, n: 2 },
  { id: 'construction', label: 'Construction-payments bus (€)', color: MONEY, a: 'constructors', b: 'investors', flows: ['construction_cost'], k: 1, n: 2 },
  { id: 'services', label: 'Housing-services bus (m²)', color: REAL, a: 'investors', b: 'households', flows: ['rental_services', 'owner_services'], k: 0, n: 2 },
  { id: 'rent', label: 'Rent bus (€)', color: MONEY, a: 'investors', b: 'households', flows: ['rent', 'imputed_rent'], k: 1, n: 2 },
  { id: 'goods', label: 'Goods bus (#)', color: REAL, a: 'firms', b: 'households', flows: ['goods'], k: 0, n: 2 },
  { id: 'income', label: 'Consumption-and-income bus (€)', color: MONEY, a: 'firms', b: 'households', flows: ['consumption', 'income'], k: 1, n: 2 },
  { id: 'mortgage', label: 'Mortgage bus (€)', color: MONEY, a: 'investors', b: 'bank', flows: ['mortgages', 'mortgage_interest'] },
  { id: 'deposit', label: 'Deposit bus (€)', color: MONEY, a: 'households', b: 'bank', flows: ['savings', 'savings_interest'] },
  { id: 'firm', label: 'Firm-credit bus (€)', color: MONEY, a: 'firms', b: 'bank', flows: ['loans', 'loan_interest'] },
];
const STRAIGHT = { on: false };  // set per render: Ports view (terminal() aligns the closed bank's left ports)
const CPB4 = ['constructors', 'investors', 'households', 'firms'];
const HM_PORTS: Record<'R' | 'B', string[]> = { R: ['mortgages', 'mortgage_interest', 'savings', 'savings_interest'], B: ['loans', 'loan_interest'] };
// the ALM Desk breadboard (BankBoards.DeskBoard): its viewBox and terminals, so e₁, e₂ end on the PI inputs and u₁, u₂
// leave from the rate outputs when the desk is open
const DESK_VB: P = [1100, 990], DESK_W = 880, DESK_T = { e2: [20, 260] as P, e1: [20, 680] as P, u1: [1080, 470] as P, u2: [1080, 600] as P };
type Pick = { kind: 'flow' | 'ret' | 'bus' | 'd'; id: string; at: P };

type Geo = ReturnType<typeof geometry>;
function geometry(o: Open, map: MapData, sizes: Record<string, P> = {}) {
  const size = (id: string) => map.layouts[id].size as P;
  const box = (id: string): P => o[id] ? [size(id)[0] * S, size(id)[1] * S + HEAD] : TILE;
  const [cw, ch] = box('constructors'), [fw, fh] = box('firms'), [iw, ih] = box('investors'), [hw, hh] = box('households');
  const c1 = 220, w1 = Math.max(cw, fw), c2 = c1 + w1 + 320, w2 = Math.max(iw, hw);
  const top = 120, row2 = top + Math.max(ch, ih) + 230;
  const R: Record<string, R> = {
    constructors: { x: c1 + w1 - cw, y: top, w: cw, h: ch }, investors: { x: c2, y: top, w: iw, h: ih },
    firms: { x: c1 + w1 - fw, y: row2, w: fw, h: fh }, households: { x: c2, y: row2, w: hw, h: hh },
  };
  // the Housing Market: closed, one tile with only its connections to the bank; open, a frame around the four agents
  // and the Government (as the Housing Market block in the control-loop view)
  R.hm = o.hm ? { x: Math.min(R.constructors.x, R.firms.x) - 50, y: top - 50 - HEAD, w: c2 + w2 + 50 - Math.min(R.constructors.x, R.firms.x) + 50, h: Math.max(R.firms.y + R.firms.h, R.households.y + R.households.h) + 50 - (top - 50 - HEAD) }
    : { x: c1, y: top, w: 300, h: 460 };
  // the bank: closed tile, or level 1/2 with Accounting (bank breadboard + statements), ALCO, Σ and ALM Desk
  const bx = R.hm.x + R.hm.w + 280, by = top;
  const [bw0, bh0] = size('bank'), cs = 0.9, circ: P = [bw0 * cs, bh0 * cs];
  let inner: null | { bs: R; acc: R; circ: R | null; sub: Record<string, R> | null; alco: R; sum: P; desk: R } = null;
  if (o.bank) {
    // Operations = the bank's breadboard (process; the banking book); Accounting = the financial statements (sensor)
    const bs: R = o.bs ? { x: bx + 140, y: by + 90, w: circ[0] + 20, h: HEAD + circ[1] + 20 } : { x: bx + 140, y: by + 90, w: 280, h: 420 };
    // Accounting holds one box per statement, each closed until its + is clicked
    let acc: R = { x: bs.x + bs.w + 150, y: by + 90, w: 230, h: 110 }, sub: Record<string, R> | null = null;
    if (o.acc) {
      // sizes: dragged by the corner grip (Jesse)
      const sz = (k: string): P => { if (!o[k]) return [210, 72]; const base = sizes[k] ?? STMT_OPEN[k], fit = sizes['fit:' + k]?.[1];  // fit: measured content height (grows with an opened line)
        return [base[0], fit ? Math.max(sizes[k] ? base[1] : 0, fit + HEAD + 16) : base[1]]; }, x0 = acc.x + 20, y0 = acc.y + HEAD + 70;
      const inc: R = { x: x0, y: y0, w: sz('inc')[0], h: sz('inc')[1] }, eq: R = { x: x0, y: inc.y + inc.h + 70, w: sz('eq')[0], h: sz('eq')[1] };
      const bal: R = { x: x0 + Math.max(inc.w, eq.w) + 120, y: y0, w: sz('bal')[0], h: sz('bal')[1] };
      const key: R = { x: bal.x + bal.w + 170, y: y0, w: sz('key')[0], h: sz('key')[1] };
      sub = { inc, eq, bal, key };
      acc = { ...acc, w: key.x + key.w + 30 - acc.x, h: Math.max(eq.y + eq.h, bal.y + bal.h, key.y + key.h) + 30 - acc.y };
    }
    const c = acc.x + acc.w + 200, alco: R = { x: c, y: by + 90, w: 230, h: 90 }, sum: P = [c + 115, alco.y + alco.h + 90];
    const desk: R = o.desk ? { x: c, y: sum[1] + 80, w: DESK_W, h: HEAD + 14 + (DESK_W - 16) * DESK_VB[1] / DESK_VB[0] } : { x: c, y: sum[1] + 80, w: 230, h: 110 };
    inner = { bs, acc, alco, sum, desk, circ: o.bs ? { x: bs.x + 10, y: bs.y + HEAD + 10, w: circ[0], h: circ[1] } : null, sub };
    R.bank = { x: bx, y: by, w: Math.max(acc.x + acc.w, desk.x + desk.w, alco.x + alco.w) + 70 - bx, h: Math.max(bs.y + bs.h, acc.y + acc.h, desk.y + desk.h) + 120 - by };
  } else R.bank = { x: bx, y: by, w: 260, h: Math.max(420, (o.hm ? R.households.y + R.households.h : R.hm.y + R.hm.h) + 30 - by) };  // tall enough for straight lines
  return { R, inner, c2, w2, circ, cs };
}

// The terminal (port p, return q) of a flow on an agent, in canvas units
function terminal(map: MapData, g: Geo, o: Open, agent: string, flow: string): { p: P; q: P; side: Side } {
  const l = map.layouts[agent], [w, h] = l.size as P, r = g.R[agent];
  const sideOf = ([x, y]: number[]): Side => x === 0 ? 'L' : x === w ? 'R' : y === 0 ? 'T' : 'B';
  const side = sideOf(l.ports[flow]);
  if (agent === 'bank') {
    // the bank's ports on the bank's own edge; aligned with its breadboard's terminals when the Bank circuit is open
    const c = g.inner?.circ;
    if (c) { const k = g.cs, P0 = l.ports[flow], Q0 = l.returns[flow];
      return side === 'L' ? { p: [r.x, c.y + P0[1] * k], q: [r.x, c.y + Q0[1] * k], side } : { p: [c.x + P0[0] * k, r.y + r.h], q: [c.x + Q0[0] * k, r.y + r.h], side }; }
    // Ports view, closed bank: a left port sits at the height of its counterpart's terminal, so the line runs straight
    // (only while the bank is closed: open, its ports land on the Bank circuit)
    if (side === 'L' && !g.inner && STRAIGHT.on) { const bus = BUSES.find(b => b.flows.includes(flow))!, t = terminal(map, g, o, bus.a, flow);
      if (t.p[1] > r.y + HEAD && t.q[1] < r.y + r.h - 10) return { p: [r.x, t.p[1]], q: [r.x, t.q[1]], side }; }
    const acc = g.inner?.bs, same = Object.keys(l.ports).filter(f => sideOf(l.ports[f]) === side).sort((a, b) => l.ports[a][side === 'L' ? 1 : 0] - l.ports[b][side === 'L' ? 1 : 0]), i = same.indexOf(flow);
    if (side === 'L') { const y0 = acc ? acc.y + 60 : r.y + 80, dy = acc ? (acc.h - 100) / same.length : (r.h - 120) / same.length, y = y0 + i * dy; return { p: [r.x, y], q: [r.x, y + LANE], side }; }
    const x0 = acc ? acc.x + 40 : r.x + 50, x = x0 + (STRAIGHT.on && !acc ? same.length - 1 - i : i) * 60;  // Ports view: mirrored, so the firm-credit pairs nest instead of cross
    return { p: [x, r.y + r.h], q: [x + LANE, r.y + r.h], side };
  }
  if (CPB4.includes(agent) && !o.hm) {
    // closed Housing Market: its bank-facing ports spread along the tile's right and bottom edges
    const r2 = g.R.hm, list = HM_PORTS[side === 'B' ? 'B' : 'R'], t = (list.indexOf(flow) + 1) / (list.length + 1);
    if (side === 'B') { const x = r2.x + r2.w * t; return { p: [x, r2.y + r2.h], q: [x + 10, r2.y + r2.h], side }; }
    const y = r2.y + HEAD + (r2.h - HEAD) * t; return { p: [r2.x + r2.w, y], q: [r2.x + r2.w, y + 10], side: 'R' };
  }
  if (o[agent]) {
    const P0 = l.ports[flow], Q0 = l.returns[flow], top = r.y + HEAD;
    return { p: [r.x + P0[0] * S, top + P0[1] * S], q: [r.x + Q0[0] * S, top + Q0[1] * S], side };
  }
  // closed tile: the ports spread evenly along the same side as in the drawing (as evenPort in the control-loop view)
  const vertical = side === 'L' || side === 'R', k = vertical ? 1 : 0;
  const same = Object.keys(l.ports).filter(f => sideOf(l.ports[f]) === side).sort((a, b) => l.ports[a][k] - l.ports[b][k]);
  const t = (same.indexOf(flow) + 1) / (same.length + 1), sign = Math.sign(l.returns[flow][k] - l.ports[flow][k]) || 1;
  const hy = r.y + HEAD + (r.h - HEAD) * t, wx = r.x + r.w * t;
  const p: P = side === 'L' ? [r.x, hy] : side === 'R' ? [r.x + r.w, hy] : side === 'T' ? [wx, r.y] : [wx, r.y + r.h];
  return { p, q: vertical ? [p[0], p[1] + 10 * sign] : [p[0] + 10 * sign, p[1]], side };
}

function Block({ r, label, tone, open, toggle, children, z }: { r: R; label: string; tone: string; open?: boolean; toggle?: () => void; children?: ReactNode; z?: number }) {
  return <div className={`map-node ${tone}${open ? ' open bus-open-block' : ''}`} style={{ position: 'absolute', left: r.x, top: r.y, width: r.w, height: r.h, zIndex: z ?? 2 }}>
    <div className="block-head"><strong>{label}</strong>{toggle && <button className="toggle nodrag" aria-label={`${open ? 'Collapse' : 'Expand'} ${label}`} onClick={e => { e.stopPropagation(); toggle(); }}>{open ? <Minus size={13}/> : <Plus size={13}/>}</button>}</div>
    {children}
  </div>;
}

// A statement box body that reports its content height, so the box grows or shrinks with opened lines (Jesse)
function FitBody({ k, onH, style, children }: { k: string; onH: (k: string, h: number) => void; style: React.CSSProperties; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current?.querySelector('.stmt-block') as HTMLElement | null; if (!el) return;  // the statement itself, not its stretched wrapper
    const report = () => onH(k, el.offsetHeight + 12); report();
    const ro = new ResizeObserver(report); ro.observe(el); return () => ro.disconnect();
  }, [k, onH]);
  return <div ref={ref} className="bus-stmt-body nowheel" style={style}>{children}</div>;
}

type DiagramData = { result: Result; at: number; o: Open; set: (k: string) => void; map: MapData; scenario: Scenario; desk: ReactNode; buses: boolean; sizes: Record<string, P>; resize: (k: string, s: P | null) => void };
function Diagram({ data }: NodeProps<Node<DiagramData>>) {
  const { result, at, o, set, map, scenario, desk, buses, sizes, resize } = data;
  const rf = useReactFlow();
  const fitH = useCallback((k: string, h: number) => { if (Math.abs((sizes['fit:' + k]?.[1] ?? 0) - h) > 2) resize('fit:' + k, [0, h]); }, [sizes, resize]);
  STRAIGHT.on = !buses;
  const g = geometry(o, map, sizes), { R } = g, B = R.bank;
  // click a flow, a bus or a shock: a card with its plot over the run (as the plot cards in the control-loop view)
  const [pick, setPick] = useState<Pick | null>(null);
  const hit = (pts: number[][], key: string, p: Pick, tip: string) => <polyline key={key + 'h'} points={pts.map(q => q.join(',')).join(' ')} fill="none" stroke="transparent" strokeWidth={14}
    style={{ pointerEvents: 'stroke', cursor: 'pointer' }} onClick={e => { e.stopPropagation(); setPick(p); }}><title>{tip}</title></polyline>;
  const flowOf = (id: string) => map.flows.find(f => f.id === id);
  // As in the control-loop view: at both ends of a port pair an effort meter e (across flow and return) and a flow
  // meter f (on the flow line), open terminals, the flow's name and its direction. e and f open the flow's plot card.
  const along = (a: P, b: P, d: number): P => { const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [a[0] + (b[0] - a[0]) * d / L, a[1] + (b[1] - a[1]) * d / L]; };
  const marks = (pf: P[], pq: P[], color: string, flow: string, key: string, reverse: boolean) => {
    const f = flowOf(flow), n = pf.length;
    let k = 1; for (let i = 2; i < n; i++) if (Math.hypot(pf[i][0] - pf[i - 1][0], pf[i][1] - pf[i - 1][1]) > Math.hypot(pf[k][0] - pf[k - 1][0], pf[k][1] - pf[k - 1][1])) k = i;
    const [a, b] = reverse ? [pf[k], pf[k - 1]] : [pf[k - 1], pf[k]], m: P = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], vert = Math.abs(a[0] - b[0]) < 0.5;
    const tri = along(a, b, Math.hypot(b[0] - a[0], b[1] - a[1]) * 0.7), ang = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
    const end = (A: P, B: P, RA: P, RB: P, j: number) => {
      const e1 = along(A, B, 11), e2 = along(RA, RB, 11), em: P = [(e1[0] + e2[0]) / 2, (e1[1] + e2[1]) / 2], fm = along(A, B, 27), t1 = along(A, B, 39), t2 = along(RA, RB, 39);
      const meter = (c: P, q: 'e' | 'f') => <g key={q} style={{ cursor: 'pointer', pointerEvents: 'all' }} onClick={ev => { ev.stopPropagation(); setPick({ kind: q === 'e' ? 'ret' : 'flow', id: flow, at: c }); }}>
        <title>{q === 'e' ? 'Effort e: click to plot' : 'Flow f: click to plot'}</title>
        <circle cx={c[0]} cy={c[1]} r={6.2} fill="#fff" stroke={color} strokeWidth={1.2}/><text x={c[0]} y={c[1] + 3} textAnchor="middle" className="bus-meter" fill={color}>{q}</text></g>;
      return <g key={j}><line x1={e1[0]} y1={e1[1]} x2={e2[0]} y2={e2[1]} stroke={color} strokeWidth={1.2}/>
        <circle cx={t1[0]} cy={t1[1]} r={2.6} fill="#fff" stroke={color}/><circle cx={t2[0]} cy={t2[1]} r={2.6} fill="#fff" stroke={color}/>{meter(em, 'e')}{meter(fm, 'f')}</g>;
    };
    return <g key={key + 'm'}>
      {end(pf[0], pf[1], pq[0], pq[1], 0)}{end(pf[n - 1], pf[n - 2], pq[n - 1], pq[n - 2], 1)}
      <path d="M-6 -5L5 0L-6 5Z" fill={color} transform={`translate(${tri[0]} ${tri[1]}) rotate(${ang})`}/>
      <text className="bus-flow-name" fill={color} transform={`translate(${vert ? m[0] - 7 : m[0]} ${vert ? m[1] : m[1] - 7}) rotate(${vert ? -90 : 0})`} textAnchor="middle">{f?.short ?? flow}</text>
    </g>;
  };
  const wires: ReactNode[] = [], over: ReactNode[] = [];  // over: drawn above the blocks (wires into an opened breadboard)
  const line = (pts: number[][], color: string, key: string, dash?: string, w = 2) =>
    <polyline key={key} points={pts.map(p => p.join(',')).join(' ')} fill="none" stroke={color} strokeWidth={w} strokeDasharray={dash}/>;
  const arrow = (pts: number[][], color: string, key: string, label?: string, at2 = 0.5) => {
    const a = pts[pts.length - 2], b = pts[pts.length - 1], ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const h = [[b[0] - 10 * Math.cos(ang - 0.4), b[1] - 10 * Math.sin(ang - 0.4)], b, [b[0] - 10 * Math.cos(ang + 0.4), b[1] - 10 * Math.sin(ang + 0.4)]];
    const i = Math.min(pts.length - 2, Math.floor(at2 * (pts.length - 1))), m = [(pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2], vert = pts[i][0] === pts[i + 1][0];
    return <g key={key}>{line(pts, color, key + 'l')}<polyline points={h.map(p => p.join(',')).join(' ')} fill="none" stroke={color} strokeWidth={2}/>
      {label && <text x={m[0] + (vert ? 10 : 0)} y={m[1] + (vert ? 4 : -7)} textAnchor={vert ? 'start' : 'middle'} className="bus-label" fill={color}>{label}</text>}</g>;
  };
  const dot = (p: P, c: string, k: string) => <circle key={k} cx={p[0]} cy={p[1]} r={4.5} fill={c} stroke="#fff" strokeWidth={1.2}/>;
  // ---- buses: each flow's port (f rail) and return (u rail) branch to the rails
  for (const bus of BUSES) {
    if (!o.hm && CPB4.includes(bus.a) && CPB4.includes(bus.b)) continue;  // inside the closed Housing Market
    const ends = bus.flows.flatMap(f => [terminal(map, g, o, bus.a, f), terminal(map, g, o, bus.b, f)]);
    const vertical = ends.every(e => e.side === 'L' || e.side === 'R');
    const A = R[bus.a], Bb = R[bus.b];
    // rail position: in the gap between the two agents (vertical buses) or between / below them (horizontal)
    const off = ((bus.k ?? 0) - ((bus.n ?? 1) - 1) / 2) * 50;  // two buses of one market side by side
    const gapBank = o.hm ? null : (R.hm.x + R.hm.w + R.bank.x) / 2;  // closed Housing Market: the gap between its tile and the bank
    const c = vertical ? (bus.id === 'mortgage' ? gapBank !== null ? gapBank - 45 : g.c2 + g.w2 + 90 : bus.id === 'deposit' ? gapBank !== null ? gapBank + 35 : g.c2 + g.w2 + 170 : (Math.min(A.x + A.w, Bb.x + Bb.w) + Math.max(A.x, Bb.x)) / 2 - LANE / 2 + off)
      : bus.id === 'firm' ? Math.max(R.firms.y + R.firms.h, R.households.y + R.households.h, Bb.y + Bb.h) + 70 : (A.y + A.h + Bb.y) / 2 - LANE / 2 + off;
    if (!buses) {
      // Ports view: the same port pairs, each flow wired straight from one agent's terminal to the other's (solid = flow
      // f, dashed = return), in its own lane through the gap where the bus would be
      // lanes: the flow that must turn first gets the lane nearest its start, and the return turns on the side that keeps
      // it clear of its own flow line (no crossings for pairs that run the same way)
      const ax = (t: { p: P }) => vertical ? t.p[0] : t.p[1], ay = (t: { p: P }) => vertical ? t.p[1] : t.p[0];
      const order = bus.flows.map((_, j) => j).sort((i, j) => { const [a1, b1] = ax(ends[2 * i]) < ax(ends[2 * i + 1]) ? [ends[2 * i], ends[2 * i + 1]] : [ends[2 * i + 1], ends[2 * i]];
        const [a2] = ax(ends[2 * j]) < ax(ends[2 * j + 1]) ? [ends[2 * j], ends[2 * j + 1]] : [ends[2 * j + 1], ends[2 * j]]; const down = ay(b1) >= ay(a1); return down ? ay(a2) - ay(a1) : ay(a1) - ay(a2); });
      bus.flows.forEach((flow, j) => {
        const f = flowOf(flow), lane = c + order.indexOf(j) * 22 - (bus.flows.length - 1) * 11, [ea, eb] = [ends[2 * j], ends[2 * j + 1]];
        const [lo, hi] = ax(ea) < ax(eb) ? [ea, eb] : [eb, ea], down = ay(hi) >= ay(lo), qs = Math.sign(ay({ p: lo.q }) - ay(lo)) || 1;
        const via = (a: P, b: P, x: number): number[][] => vertical ? [a, [x, a[1]], [x, b[1]], b] : [a, [a[0], x], [b[0], x], b];
        const pf = via(ea.p, eb.p, lane), pq = via(ea.q, eb.q, lane + (down === (qs > 0) ? -9 : 9));
        wires.push(line(pf, bus.color, `${bus.id}${j}p`)); wires.push(line(pq, bus.color, `${bus.id}${j}q`, '5 3'));
        wires.push(hit(pf, `${bus.id}${j}p`, { kind: 'flow', id: flow, at: pf[1] as P }, `${f?.label ?? flow}: click to plot`));
        wires.push(hit(pq, `${bus.id}${j}q`, { kind: 'ret', id: flow, at: pq[1] as P }, `${f?.label ?? flow} · incentive (return): click to plot`));
        over.push(marks(pf as P[], pq as P[], bus.color, flow, `${bus.id}${j}`, f?.source === bus.b));
      });
      continue;
    }
    const taps: P[] = [];
    const branch = (pt: P, k: number, key: string, flow: string, dash?: string) => {
      const end: P = vertical ? [c + k, pt[1]] : [pt[0], c + k]; taps.push(end);
      const f = flowOf(flow), ret = !!dash;
      wires.push(line([pt, end], bus.color, key, dash)); wires.push(dot(end, bus.color, key + 'd'));
      wires.push(hit([pt, end], key, { kind: ret ? 'ret' : 'flow', id: flow, at: end }, `${f?.label ?? flow}${ret ? ' · incentive (return)' : ''}: click to plot`));
    };
    ends.forEach((e, i) => { const f = bus.flows[Math.floor(i / 2)]; branch(e.p, 0, `${bus.id}${i}p`, f); branch(e.q, LANE, `${bus.id}${i}q`, f, '5 3'); });
    const along = taps.map(t => vertical ? t[1] : t[0]), lo = Math.min(...along) - 24, hi = Math.max(...along) + 24;
    wires.unshift(<g key={bus.id + 'rails'}>
      {[0, LANE].map(k => <line key={k} x1={vertical ? c + k : lo} x2={vertical ? c + k : hi} y1={vertical ? lo : c + k} y2={vertical ? hi : c + k} stroke={bus.color} strokeWidth={6} strokeLinecap="round" strokeOpacity={k ? 0.5 : 1}/>)}
      <text x={vertical ? c + LANE / 2 : hi + 14} y={vertical ? (bus.n ? Math.min(A.y, Bb.y) - 12 - 18 * (bus.n - 1 - (bus.k ?? 0)) : lo - 12) : c + LANE} textAnchor={vertical ? 'middle' : 'start'} className="bus-name" fill={bus.color}>{bus.label}</text>
      {hit(vertical ? [[c + LANE / 2, lo], [c + LANE / 2, hi]] : [[lo, c + LANE / 2], [hi, c + LANE / 2]], bus.id + 'rail', { kind: 'bus', id: bus.id, at: vertical ? [c + LANE, lo + 40] : [lo + 40, c + LANE] }, `${bus.label}: click to plot its flows`)}
    </g>);
  }
  // ---- the bank in the middle: the real economy on its left, the Financial sector (empty for now) on its right,
  // joined by the interbank bus (a money bus)
  const IB = MONEY, ibY = B.y + B.h - 60, fs: R = { x: B.x + B.w + 320, y: B.y + B.h / 2 - TILE[1] / 2, w: TILE[0], h: TILE[1] };
  { const rx = B.x + B.w + 150, fy = fs.y + fs.h / 2 - LANE / 2, lo = Math.min(ibY, fy) - 24, hi = Math.max(ibY, fy) + LANE + 24;
    if (!buses) {
      const pf = [[B.x + B.w, ibY], [rx, ibY], [rx, fy], [fs.x, fy]], pq = [[B.x + B.w, ibY + LANE], [rx + LANE, ibY + LANE], [rx + LANE, fy + LANE], [fs.x, fy + LANE]];
      wires.push(line(pf, IB, 'ibf')); wires.push(line(pq, IB, 'ibq', '5 3'));
    } else wires.push(<g key="ib">
      {[0, LANE].map(k => <line key={k} x1={rx + k} x2={rx + k} y1={lo} y2={hi} stroke={IB} strokeWidth={6} strokeLinecap="round" strokeOpacity={k ? 0.5 : 1}/>)}
      {line([[B.x + B.w, ibY], [rx, ibY]], IB, 'ib1')}{line([[B.x + B.w, ibY + LANE], [rx + LANE, ibY + LANE]], IB, 'ib2', '5 3')}
      {line([[rx, fy], [fs.x, fy]], IB, 'ib3')}{line([[rx + LANE, fy + LANE], [fs.x, fy + LANE]], IB, 'ib4', '5 3')}
      {[[rx, ibY], [rx + LANE, ibY + LANE], [rx, fy], [rx + LANE, fy + LANE]].map((q, i) => dot(q as P, IB, 'ibd' + i))}
      <text x={rx + LANE / 2} y={lo - 12} textAnchor="middle" className="bus-name" fill={IB}>Interbank bus (€)</text>
    </g>); }
  // ---- disturbances d: Covid (and the other active shocks) into the firms' breadboard, the subsidy into households
  const D = '#c0392b', SCALE: Record<string, keyof Scenario> = { d_income: 'income_scale', d_covid: 'covid_scale', d_crisis: 'crisis_scale' };
  const firmIns = map.disturbances.filter(d => d.target === 'firms' && !(SCALE[d.id] && scenario[SCALE[d.id]] === 0));
  if (!o.hm) firmIns.forEach((d, i) => {
    const r = R.hm, y = r.y + HEAD + (r.h - HEAD) * (i + 1) / (firmIns.length + 2);
    wires.push(arrow([[r.x - 120, y], [r.x, y]], D, 'df' + d.id, 'd · ' + d.label)); wires.push(hit([[r.x - 120, y], [r.x, y]], 'df' + d.id, { kind: 'd', id: d.id, at: [r.x - 60, y] }, d.label + ': click to plot'));
  });
  else firmIns.forEach((d, i) => {
    const r = R.firms, e = map.elements.find(x => x.name === (d as { element?: string }).element && x.agent === 'firms');
    const y = o.firms && e?.pins ? r.y + HEAD + inputPath('left', i, firmIns.length, map.layouts.firms.size as P, e.pins)[0][1] * S : r.y + HEAD + (r.h - HEAD) * (i + 1) / (firmIns.length + 1);
    wires.push(arrow([[r.x - 120, y], [r.x, y]], D, 'df' + d.id, 'd · ' + d.label)); wires.push(hit([[r.x - 120, y], [r.x, y]], 'df' + d.id, { kind: 'd', id: d.id, at: [r.x - 60, y] }, d.label + ': click to plot'));
  });
  // the Government in the middle of the four agents; its subsidy enters the households from the top-left
  const hh = R.households, gcx = (R.firms.x + R.firms.w + hh.x) / 2, gcy = (R.investors.y + R.investors.h + hh.y) / 2;
  const gov: R = { x: gcx - 100, y: gcy - 35, w: 200, h: 70 }, gx = hh.x + 26, gy = gcy;
  if (o.hm) {
    wires.push(arrow([[gov.x + gov.w, gy], [gx, gy], [gx, hh.y]], D, 'dgov')); wires.push(<text key="dgovt" x={gov.x + gov.w + 8} y={gy - 7} className="bus-label" fill={D}>d · subsidy</text>);
    wires.push(hit([[gov.x + gov.w, gy], [gx, gy], [gx, hh.y]], 'dgov', { kind: 'd', id: 'd_gov', at: [gx, gy] }, 'Government subsidy: click to plot'));
  } else { const r = R.hm, y = r.y + HEAD + (r.h - HEAD) * (firmIns.length + 1) / (firmIns.length + 2), pts = [[r.x - 120, y], [r.x, y]];
    wires.push(arrow(pts, D, 'dgov', 'd · subsidy')); wires.push(hit(pts, 'dgov', { kind: 'd', id: 'd_gov', at: [r.x - 60, y] }, 'Government subsidy: click to plot')); }
  // the other banks' shock (deposits withdrawn, firm credit cut) into the bank, from above
  // the financial crisis comes from the Financial sector (other banks withdraw deposits, cut credit)
  // the financial crisis (Jesse): from outside into the Financial sector; it reaches the bank through the interbank link
  { const fx = fs.x + fs.w / 2, pts = [[fx, fs.y - 110], [fx, fs.y]];
    wires.push(arrow(pts, D, 'dob', 'd · financial crisis', 0.4)); wires.push(hit(pts, 'dob', { kind: 'd', id: 'd_others', at: [fx, fs.y - 50] }, 'Financial crisis: deposits withdrawn, firm credit cut: click to plot')); }
  // ---- inside the bank
  let inside: ReactNode = null;
  if (g.inner) {
    const { bs, acc, alco, sum, desk: dk, circ, sub } = g.inner, G = '#3f9a1f', PU = '#6b4fa0', bankFlows = Object.keys(map.layouts.bank.ports);
    // the bank's ports into the Bank circuit (onto the breadboard's own terminals when it is open)
    for (const f of bankFlows) {
      const t = terminal(map, g, o, 'bank', f), col = BUSES.find(b => (b.flows as readonly string[]).includes(f))!.color;
      const into = (p: P): P => t.side === 'L' ? [circ ? circ.x : bs.x, p[1]] : [p[0], circ ? circ.y + circ.h : bs.y + bs.h];
      const W2 = circ ? over : wires; W2.push(line([t.p, into(t.p)], col, 'in' + f)); W2.push(line([t.q, into(t.q)], col, 'iq' + f, '5 3'));
    }
    // the interbank bus enters on the bank's right edge and runs underneath the other blocks to the Bank circuit
    { const t = terminal(map, g, o, 'bank', 'loan_interest'), x = t.p[0] + 120, bot = circ ? circ.y + circ.h : bs.y + bs.h;
      wires.push(line([[B.x + B.w, ibY], [x, ibY], [x, bot]], IB, 'in-ib')); wires.push(line([[B.x + B.w, ibY + LANE], [x - LANE, ibY + LANE], [x - LANE, bot]], IB, 'iq-ib', '5 3')); }
    // the breadboard's stocks and flows are read by Accounting; Accounting reports y to Σ
    { const ya = sub ? acc.y + HEAD + 30 : acc.y + 55;
      if (sub) {
        // what each statement is computed from (bank_ledger.py): stocks -> balance sheet, rates and flows -> income statement,
        // the home value (LTV, for the DNB mortgage risk weight) -> key figures
        over.push(arrow([[bs.x + bs.w, ya], [sub.bal.x + 40, ya], [sub.bal.x + 40, sub.bal.y]], G, 'x', 'stocks', 0));
        const yf = acc.y + HEAD + 44; over.push(arrow([[bs.x + bs.w, yf], [sub.inc.x + 40, yf], [sub.inc.x + 40, sub.inc.y]], G, 'xf', 'rates · flows', 0));
        const yl = acc.y + acc.h - 16, ys = Math.min(yl, bs.y + bs.h - 20), kx = sub.key.x + sub.key.w / 2;
        over.push(arrow([[bs.x + bs.w, ys], [acc.x + 12, ys], [acc.x + 12, yl], [kx, yl], [kx, sub.key.y + sub.key.h]], G, 'xl', 'home value (LTV)', 0.62));
      }
      else wires.push(arrow([[bs.x + bs.w, ya], [acc.x, ya]], G, 'x', 'stocks · flows', 0.5)); }
    { const k = sub?.key, yy = k ? k.y + Math.min(k.h / 2, 45) : acc.y + 55, xm = alco.x - 45;
      (k ? over : wires).push(arrow([[k ? k.x + k.w : acc.x + acc.w, yy], [xm, yy], [xm, sum[1]], [sum[0] - 17, sum[1]]], G, 'y', 'y₁ Tier 1 · y₂ NSFR', 0.15)); }
    // inside Accounting: retained profit into equity, equity onto the balance sheet, balance-sheet items and net profit into the key figures
    if (sub) {
      const { inc, eq, bal, key } = sub;
      over.push(arrow([[inc.x + 60, inc.y + inc.h], [inc.x + 60, eq.y]], G, 's-ret', 'retained profit'));
      { const ey = eq.y + 45, mx = bal.x - 50; over.push(arrow([[eq.x + eq.w, ey], [mx, ey], [mx, bal.y + 45], [bal.x, bal.y + 45]], G, 's-eq', 'equity', 0)); }
      const items = KEY_INPUTS.filter(([id]) => id !== 'net_profit');
      if (o.bal && o.key) items.forEach(([id, name], i) => { const y = bal.y + HEAD + 24 + i * 30; over.push(arrow([[bal.x + bal.w, y], [key.x, y]], G, 's-' + id, name)); });
      else over.push(arrow([[bal.x + bal.w, bal.y + HEAD + 10], [key.x, bal.y + HEAD + 10]], G, 's-items', 'balance-sheet items'));
      { const x1 = inc.x + inc.w - 40, ly = inc.y - 16, kx = key.x - 14, ky = key.y + key.h - 10;
        over.push(arrow([[x1, inc.y], [x1, ly], [kx, ly], [kx, ky], [key.x, ky]], G, 's-np', 'net profit', 0.3)); }
    }
    wires.push(arrow([[sum[0], alco.y + alco.h], [sum[0], sum[1] - 17]], '#2b6599', 'r', 'r₁, r₂'));
    // the desk's terminals in canvas units (open desk), from its breadboard coordinates
    const dt = (q: P): P => { const k = (dk.w - 16) / DESK_VB[0]; return [dk.x + 8 + q[0] * k, dk.y + HEAD + 6 + q[1] * k]; };
    if (o.desk) {
      const [e2, e1] = [dt(DESK_T.e2), dt(DESK_T.e1)], ly = dk.y - 28;
      over.push(arrow([[sum[0], sum[1] + 17], [sum[0], ly], [dk.x - 30, ly], [dk.x - 30, e2[1]], e2], '#1f2a26', 'e2', 'e₂ NSFR', 0.6));
      over.push(arrow([[dk.x - 30, e2[1]], [dk.x - 30, e1[1]], e1], '#1f2a26', 'e1', 'e₁ Tier 1', 0.5));
    } else wires.push(arrow([[sum[0], sum[1] + 17], [sum[0], dk.y]], '#1f2a26', 'e', 'e₁, e₂'));
    // u: the desk's rates into the bank's rate sources (B§Mortgage_rate_ALM and B2 on the breadboard)
    const el = (name: string): P | null => { const e = map.elements.find(x => x.agent === 'bank' && x.name === name); if (!circ || !e?.pins) return null;
      const cx = e.pins.reduce((s, p) => s + p[0], 0) / e.pins.length, cy = e.pins.reduce((s, p) => s + p[1], 0) / e.pins.length; return [circ.x + cx * g.cs, circ.y + cy * g.cs]; };
    const uT = [el('B§Mortgage_rate_ALM') ?? [bs.x + bs.w, bs.y + bs.h - 110] as P, el('B2') ?? [bs.x + bs.w, bs.y + bs.h - 60] as P];
    ['u₁ loan rate', 'u₂ savings rate'].forEach((name, i) => {  // labels on the top lane, clear of each other
      // over the top of Accounting, then down into the breadboard's rate source (or the closed box's right edge)
      const uy = dk.y + 45 + 30 * i, mx = acc.x + acc.w + 40 + 25 * i, t = uT[i], top = Math.min(bs.y, acc.y) - 20 - 18 * i, dx = bs.x + bs.w + 40 + 20 * i;
      // open desk: from its rate output on the right, round the desk and over the top lane
      const head: number[][] = o.desk ? (() => { const u = dt(i ? DESK_T.u2 : DESK_T.u1), rx = dk.x + dk.w + 30 + 22 * i; return [u, [rx, u[1]], [rx, top]]; })() : [[dk.x, uy], [mx, uy], [mx, top]];
      // Operations and Accounting closed: straight from the desk into Operations (Jesse)
      const straight = !circ && !sub && !o.desk && uy > bs.y + HEAD && uy < bs.y + bs.h;
      const pts = straight ? [[dk.x, uy], [bs.x + bs.w, uy]] : circ ? [...head, [t[0], top], [t[0], t[1] - 22]] : [...head, [dx, top], [dx, t[1]], [t[0], t[1]]];
      over.push(arrow(pts, PU, 'u' + i, name, 0.5));
    });
    inside = <>
      <Block r={bs} label="Operations" tone={o.bs ? 'sub-group' : 'sub-closed'} open={o.bs} toggle={() => set('bs')} z={1}>
        {o.bs && circ && <div className="bus-circuit" style={{ position: 'absolute', left: circ.x - bs.x, top: circ.y - bs.y, width: circ.w, height: circ.h }}><AgentCircuit map={map} agent="bank" scenario={scenario} selection={NONE} pick={() => {}} outside/></div>}
      </Block>
      <Block r={acc} label="Accounting" tone={o.acc ? 'sensor-open' : 'sensor'} open={o.acc} toggle={() => set('acc')} z={1}/>
      {sub && STMT.map(([k, label, gid]) => <Block key={k} r={sub[k]} label={label} tone={o[k] ? 'sensor-open bus-stmt' : 'sensor'} open={o[k]} toggle={() => set(k)} z={o[k] ? 5 : 3}>  {/* open: above the wires, so a dragged plot card stays on top */}
        {o[k] && <FitBody k={k} onH={fitH} style={{ position: 'absolute', left: 6, right: 6, top: HEAD + 4, bottom: 6 }}>
          <AtContext.Provider value={{ result, at }}><BankStatements only={gid}/></AtContext.Provider></FitBody>}
        {o[k] && <div className="bus-grip nodrag nopan" role="separator" aria-label={`Resize ${label}`} title="Drag to make the box bigger or smaller (double-click: original size)"
          onDoubleClick={e => { e.stopPropagation(); resize(k, null); }}
          onPointerDown={e => { e.stopPropagation(); e.preventDefault(); const el = e.currentTarget, z = rf.getZoom(), x0 = e.clientX, y0 = e.clientY, s0 = sub[k]; el.setPointerCapture(e.pointerId);
            const move = (ev: PointerEvent) => resize(k, [Math.max(240, s0.w + (ev.clientX - x0) / z), Math.max(HEAD + 120, s0.h + (ev.clientY - y0) / z)]);
            const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); };
            el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); }}/>}
      </Block>)}
      <Block r={alco} label="ALCO" tone="reference"/>
      <div className="map-node summing" style={{ position: 'absolute', left: sum[0] - 17, top: sum[1] - 17, width: 34, height: 34, zIndex: 2 }}/>
      <Block r={dk} label="ALM Desk" tone="controller" open={o.desk} toggle={() => set('desk')}>
        {o.desk && <div className="bus-breadboard" style={{ position: 'absolute', left: 8, right: 8, top: HEAD + 6, bottom: 8 }}><AtContext.Provider value={{ result, at }}>{desk}</AtContext.Provider></div>}
      </Block>
    </>;
  }
  const W = fs.x + fs.w + 120, H = Math.max(fs.y + fs.h, R.hm.y + R.hm.h, B.y + B.h) + 140;
  // the card of a clicked flow, return, bus or shock
  let card: ReactNode = null;
  if (pick) {
    const series = (signal: string) => readTrace(result, signal);
    const rows: { label: string; unit: string; y?: number[] }[] = [];
    let title = '', note = '';
    if (pick.kind === 'flow' || pick.kind === 'ret') {
      const f = flowOf(pick.id); title = f?.label ?? pick.id; note = f?.description ?? '';
      if (f) rows.push({ label: 'f · flow', unit: f.unit, y: series(f.signal) });
      if (f?.port) rows.push({ label: 'e · incentive at the port', unit: 'model units', y: series(`V(${f.port.node.toLowerCase()},${f.port.ret.toLowerCase()})`) });
    } else if (pick.kind === 'bus') {
      const b = BUSES.find(x => x.id === pick.id)!; title = b.label; note = 'One quantity on this bus: every flow below is in the same unit.';
      b.flows.forEach(id => { const f = flowOf(id); if (f) rows.push({ label: f.label, unit: f.unit, y: series(f.signal) }); });
    } else {
      const d = map.disturbances.find(x => x.id === pick.id); title = d?.label ?? pick.id;
      if (d) rows.push({ label: 'd · shock', unit: d.unit, y: series(d.signal) });
    }
    card = <div className="bus-pick nodrag nowheel" style={{ left: pick.at[0] + 14, top: pick.at[1] + 14 }} onClick={e => e.stopPropagation()}>
      <div className="bus-pick-head"><b>{title}</b><button className="ghost small" aria-label="Close" onClick={() => setPick(null)}>×</button></div>
      {note && <small>{note}</small>}
      {rows.map(r => <div key={r.label}><div className="bus-pick-row">{r.label}</div>{r.y ? <StmtPlot y={r.y} at={at} years={result.year} unit={r.unit} label={r.label}/> : <small className="muted">Not in this run.</small>}</div>)}
    </div>;
  }
  const agent = (id: string) => <Block key={id} r={R[id]} label={map.agents[id]?.label ?? id} tone="agent" open={o[id]} toggle={() => set(id)}>
    {o[id] && <div className="bus-circuit" style={{ position: 'absolute', left: 0, top: HEAD, width: R[id].w, height: R[id].h - HEAD }}>
      <AgentCircuit map={map} agent={id} scenario={scenario} selection={NONE} pick={() => {}} outside={id !== 'firms'} inputs={id === 'firms' ? firmIns : []}/></div>}
  </Block>;
  return <div className="bus-diagram nodrag" style={{ width: W, height: H }} onClick={() => setPick(null)}>
    <svg width={W} height={H} className="bus-wires">{wires}</svg>
    <Block r={R.hm} label="Housing Market" tone={o.hm ? 'system-group' : 'system-closed'} open={o.hm} toggle={() => set('hm')} z={0}/>
    {o.hm && CPB4.map(agent)}
    {o.hm && <Block r={gov} label="Government" tone="reference bus-gov-block"/>}
    <Block r={fs} label="Financial sector" tone="sub-closed"/>
    <Block r={B} label="Bank" tone={o.bank ? 'sub-group' : 'sub-closed'} open={o.bank} toggle={() => set('bank')} z={0}/>
    {inside}
    <svg width={W} height={H} className="bus-wires bus-over">{over}</svg>
    {card}
  </div>;
}

const nodeTypes = { diagram: Diagram };

function Inner({ result, desk, patch, toolsSlot }: { result: Result; desk: ReactNode; patch: (m: MapData) => MapData; toolsSlot?: HTMLElement | null }) {
  const n = result.year.length;
  const [buses, setBuses] = useState(false);
  const [sizes, setSizes] = useState<Record<string, P>>({});
  const resize = useCallback((k: string, s: P | null) => setSizes(old => { const n = { ...old }; if (s) n[k] = s; else delete n[k]; return n; }), []);  // Ports (default): the port pairs wired directly; Buses: one bus per conserved quantity
  const [at, setAt] = useState(n - 1), [playing, setPlaying] = useState(false), [o, setO] = useState<Open>({});
  const [map, setMap] = useState<MapData | null>(null);
  const rf = useReactFlow();
  useEffect(() => { api<MapData>('/model/map').then(m => setMap(patch(m))).catch(() => setMap(null)); }, [patch]);
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => setAt(a => { if (a >= n - 1) { setPlaying(false); return a; } return a + 1; }), 60);
    return () => window.clearInterval(id);
  }, [playing, n]);
  const scenario = useMemo(() => ({ ...result.scenario, feedback: false }) as Scenario, [result]);
  // Open or close a block and zoom to it (closing zooms back out to the level above)
  const set = useCallback((k: string) => setO(old => {
    const next: Open = { ...old, [k]: !old[k] };
    const subs = STMT.map(x => x[0]);
    if (k === 'bank' && !next.bank) for (const x of ['bs', 'acc', 'desk', ...subs]) next[x] = false;
    if (k === 'hm' && !next.hm) for (const x of CPB4) next[x] = false;
    if (k === 'acc' && !next.acc) for (const x of subs) next[x] = false;
    if (!map) return next;
    const g = geometry(next, map, sizes), byId: Record<string, R | undefined> = { ...g.R, ...g.inner?.sub, bs: g.inner?.bs, acc: g.inner?.acc, desk: g.inner?.desk };
    const target = next[k] ? byId[k] : subs.includes(k) ? byId.acc : (k === 'bs' || k === 'acc' || k === 'desk') ? g.R.bank : undefined;
    if (k === 'acc' || subs.includes(k)) return next;  // Accounting and its statements open in place, no zoom (Jesse)
    window.setTimeout(() => { if (target) rf.fitBounds({ x: target.x - 40, y: target.y - 40, width: target.w + 80, height: target.h + 80 }, { duration: 450 }); else rf.fitView({ duration: 450, padding: 0.04 }); }, 40);
    return next;
  }), [rf, map, sizes]);
  const nodes = useMemo<Node[]>(() => map ? [{ id: 'd', type: 'diagram', position: { x: 0, y: 0 }, draggable: false, selectable: false, focusable: false, style: { pointerEvents: 'all' },
    data: { result, at: Math.min(at, n - 1), o, set, map, scenario, desk, buses, sizes, resize } }] : [], [result, at, n, o, set, map, scenario, desk, buses, sizes, resize]);
  const tools = <div className="bus-time">
      <button className="ghost" aria-label={playing ? 'Pause' : 'Play through time'} onClick={() => { if (at >= n - 1) setAt(0); setPlaying(p => !p); }}>{playing ? <Pause size={14}/> : <Play size={14}/>}</button>
      <span>{result.year[Math.min(at, n - 1)].toFixed(1)}</span>
      <input type="range" min={0} max={n - 1} value={Math.min(at, n - 1)} onChange={e => { setPlaying(false); setAt(+e.target.value); }}/>
      <div className="segmented small" role="group" aria-label="Connections"><button className={!buses ? 'active' : ''} aria-pressed={!buses} onClick={() => setBuses(false)}>Ports</button><button className={buses ? 'active' : ''} aria-pressed={buses} onClick={() => setBuses(true)}>Buses</button></div>
      <button className="ghost small" onClick={() => { setO({}); window.setTimeout(() => rf.fitView({ duration: 450, padding: 0.04 }), 40); }}>Close all</button>
    </div>;
  return <>
    {toolsSlot ? createPortal(tools, toolsSlot) : tools}
    <div className="bus-canvas">{map ? <ReactFlow nodes={nodes} edges={[]} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.04 }} minZoom={0.05} maxZoom={4} proOptions={{ hideAttribution: true }} nodesDraggable={false}><Controls showInteractive={false}/></ReactFlow> : <p className="muted">Loading the model…</p>}</div>
  </>;
}

export function BankBusView({ result, desk, patch, toolsSlot }: { result: Result; desk: ReactNode; patch: (m: MapData) => MapData; toolsSlot?: HTMLElement | null }) {
  return <section className="panel bus-view"><ReactFlowProvider><Inner result={result} desk={desk} patch={patch} toolsSlot={toolsSlot}/></ReactFlowProvider></section>;
}
