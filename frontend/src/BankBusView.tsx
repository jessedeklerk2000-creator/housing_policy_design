// Bank controls, bus view (25 Nov 2026): the same model as the control-loop view (the same agents, the same
// breadboards drawn by AgentCircuit, the same block styles), arranged around buses with the bank in the middle
// (Jesse and his supervisor). Every bus branch ends on the real terminal of its flow: the port and the return point
// from the netlist layout when the agent is open, the matching side of the tile when it is closed (as in the
// control-loop view). Top level: names only. Bank level 1: Operations, Accounting, ALCO, ALM Desk; level 2:
// the bank's breadboard (process), its financial statements (sensor), or the desk's op-amp breadboard. Numbers only in the accounts (Jesse).
// Bus structure after Q. Emanuels' DynaBI bus canvas: one bus per kind of exchange, two rails each (flow f, incentive
// u); here the rails carry each flow's port and return terminal. Values come from the same ngspice run.
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
// (no equity statement since 26 Nov 2026, Jesse: retained profit goes straight into equity on the balance sheet)
const STMT: [string, string, string][] = [['inc', 'Income statement', 'income'], ['bal', 'Balance sheet', 'balance'], ['cf', 'Cash flow statement', 'cashflow'], ['key', 'Metrics', 'ratios']];
const STMT_OPEN: Record<string, P> = { cf: [380, HEAD + 330], inc: [380, HEAD + 330], bal: [620, HEAD + 300], key: [380, HEAD + 270] };
// One bus per conserved quantity (Jesse, 25 Nov 2026): a bus is a node, so it carries one good only and its flows sum
// to zero. A market with a good and a payment gets two buses side by side (k of n): brown = real goods, green = money.
type Bus = { id: string; label: string; color: string; a: string; b: string; flows: string[]; k?: number; n?: number };
// Feedback round 2 (A6, M. Mendel): no green or light blue in the bank view. Money a dark neutral (the moving dots show
// what flows), real goods brown, every signal one accent violet.
const REAL = '#a8660c', MONEY = '#3b3b46', SIG = '#5b3f8f';
// Every bus its own colour (Jesse, 26 Nov 2026), Okabe-Ito based (distinct under colour-vision deficiency), darker for lines
const BUSES: Bus[] = [
  { id: 'houses', label: 'Houses bus (#)', color: '#a8660c', a: 'constructors', b: 'investors', flows: ['houses'], k: 0, n: 2 },
  { id: 'construction', label: 'Construction-payments bus (€)', color: '#7a5a3a', a: 'constructors', b: 'investors', flows: ['construction_cost'], k: 1, n: 2 },
  { id: 'services', label: 'Housing-services bus (m²)', color: '#d55e00', a: 'investors', b: 'households', flows: ['rental_services', 'owner_services'], k: 0, n: 2 },
  { id: 'rent', label: 'Rent bus (€)', color: '#9b4f96', a: 'investors', b: 'households', flows: ['rent', 'imputed_rent'], k: 1, n: 2 },
  { id: 'goods', label: 'Goods bus (#)', color: '#6b7f1a', a: 'firms', b: 'households', flows: ['goods'], k: 0, n: 2 },
  { id: 'income', label: 'Consumption-and-income bus (€)', color: '#3a8fc4', a: 'firms', b: 'households', flows: ['consumption', 'income'], k: 1, n: 2 },
  { id: 'mortgage', label: 'Mortgage bus (€)', color: '#0072b2', a: 'investors', b: 'bank', flows: ['mortgages', 'mortgage_interest'] },
  { id: 'deposit', label: 'Deposit bus (€)', color: '#009e73', a: 'households', b: 'bank', flows: ['savings', 'savings_interest'] },
  { id: 'firm', label: 'Firm-credit bus (€)', color: '#c98500', a: 'firms', b: 'bank', flows: ['loans', 'loan_interest'] },
];
const STRAIGHT = { on: false };  // set per render: Ports view (terminal() aligns the closed bank's left ports)
const CPB4 = ['constructors', 'investors', 'households', 'firms'];
const HM_PORTS: Record<'R' | 'B', string[]> = { R: ['mortgages', 'mortgage_interest', 'savings', 'savings_interest'], B: ['loans', 'loan_interest'] };
// the ALM Desk breadboard (BankBoards.DeskBoard): its viewBox and terminals, so e₁, e₂ end on the PI inputs and u₁, u₂
// leave from the rate outputs when the desk is open
const DESK_VB: P = [1100, 990], DESK_W = 880, DESK_T = { e2: [20, 260] as P, e1: [20, 680] as P, u1: [1080, 470] as P, u2: [1080, 600] as P, u3: [1080, 730] as P };
type Pick = { kind: 'flow' | 'ret' | 'bus' | 'd' | 'comp' | 'shock' | 'ibf' | 'ibe'; id: string; at: P };

type Geo = ReturnType<typeof geometry>;
type Inner = { bs: R; ops: R; tre: R; opsOpen: boolean; treOpen: boolean; circ: R | null;
  t: null | { acc: R; sub: Record<string, R> | null; alco: R; sum: P; desk: R; accF: R; almF: R } };
function geometry(o: Open, map: MapData, sizes: Record<string, P> = {}) {
  const size = (id: string) => map.layouts[id].size as P;
  const box = (id: string): P => o[id] ? [size(id)[0] * S, size(id)[1] * S + HEAD] : TILE;
  const [cw, ch] = box('constructors'), [fw, fh] = box('firms'), [iw, ih] = box('investors'), [hw, hh] = box('households');
  const c1 = 220, w1 = Math.max(cw, fw), c2 = c1 + w1 + 320, w2 = Math.max(iw, hw);
  const top = 300, row2 = top + Math.max(ch, ih) + 230;
  const R: Record<string, R> = {
    constructors: { x: c1 + w1 - cw, y: top, w: cw, h: ch }, investors: { x: c2, y: top, w: iw, h: ih },
    firms: { x: c1 + w1 - fw, y: row2, w: fw, h: fh }, households: { x: c2, y: row2, w: hw, h: hh },
  };
  // the Housing Market: closed, one tile with only its connections to the bank; open, a frame around the four agents
  // and the Government (as the Housing Market block in the control-loop view)
  R.hm = o.hm ? { x: Math.min(R.constructors.x, R.firms.x) - 50, y: top - 50 - HEAD, w: c2 + w2 + 50 - Math.min(R.constructors.x, R.firms.x) + 50, h: Math.max(R.firms.y + R.firms.h, R.households.y + R.households.h) + 50 - (top - 50 - HEAD) }
    : { x: c1, y: top, w: 240, h: 260 };
  // the Government (M. Mendel, 26 Nov 2026): a top-level player above the Housing Market, outside its frame
  R.gov = { x: R.hm.x, y: R.hm.y - 170, w: 220, h: 80 };
  // the bank: closed tile, or level 1/2 with Accounting (bank breadboard + statements), ALCO, Σ and ALM Desk
  const bx = R.hm.x + R.hm.w + 420, by = top;  // room for the mortgage and deposit buses with their meters (Jesse: less overlap)
  const IN = 170;  // top of the bank's content: room for the CEO header and the division boxes
  const [bw0, bh0] = size('bank'), cs = 0.9, circ: P = [bw0 * cs, bh0 * cs];
  let inner: null | Inner = null;
  if (o.bank) {
    // Two divisions under the CEO (M. Mendel; Jesse 26 Nov 2026: both are boxes one level down): Banking Operations (COO)
    // opens into Operations (the bank's breadboard); Treasury (treasurer) opens into Accounting, ALCO, Σ and the ALM Desk.
    const L1 = by + 90, opsOpen = !!o.bops, treOpen = !!o.tre;
    let bs: R, ops: R;
    if (opsOpen) {
      bs = o.bs ? { x: bx + 60, y: by + IN, w: circ[0] + 20, h: HEAD + circ[1] + 20 } : { x: bx + 60, y: by + IN, w: 240, h: 240 };
      ops = { x: bx + 20, y: L1, w: bs.w + 80, h: bs.y + bs.h + 60 - L1 };
    } else { ops = { x: bx + 20, y: L1, w: 260, h: 240 }; bs = ops; }
    const tx = ops.x + ops.w + 160;
    let tre: R, t: Inner['t'] = null;
    if (treOpen) {
      // Accounting holds one box per statement, each closed until its + is clicked
      let acc: R = { x: tx + 44, y: by + IN, w: 230, h: 110 }, sub: Record<string, R> | null = null;
      if (o.acc) {
        // sizes: dragged by the corner grip (Jesse)
        const sz = (k: string): P => { if (!o[k]) return [210, 72]; const base = sizes[k] ?? STMT_OPEN[k], fit = sizes['fit:' + k]?.[1];  // fit: measured content height (grows with an opened line)
          return [base[0], fit ? Math.max(sizes[k] ? base[1] : 0, fit + HEAD + 16) : base[1]]; }, x0 = acc.x + 44, y0 = acc.y + HEAD + 70;  // left margin: the net-profit line into the cash flow statement runs there
        const inc: R = { x: x0, y: y0, w: sz('inc')[0], h: sz('inc')[1] };
        const bal: R = { x: x0 + Math.max(inc.w, sz('cf')[0]) + 120,  /* clear of the widest box in the left column */ y: y0, w: sz('bal')[0], h: sz('bal')[1] };
        const key: R = { x: bal.x + bal.w + 170, y: y0, w: sz('key')[0], h: sz('key')[1] };
        const cf: R = { x: x0, y: inc.y + inc.h + 70, w: sz('cf')[0], h: sz('cf')[1] };  // cash flow statement under the income statement
        sub = { inc, cf, bal, key };
        acc = { ...acc, w: key.x + key.w + 30 - acc.x, h: Math.max(cf.y + cf.h, bal.y + bal.h, key.y + key.h) + 30 - acc.y };
      }
      const c = acc.x + acc.w + 200, alco: R = { x: c, y: by + IN, w: 230, h: 90 }, sum: P = [c + 115, alco.y + alco.h + 90];
      const desk: R = o.desk ? { x: c, y: sum[1] + 80, w: DESK_W, h: HEAD + 14 + (DESK_W - 16) * DESK_VB[1] / DESK_VB[0] } : { x: c, y: sum[1] + 80, w: 230, h: 110 };
      const accF: R = { x: acc.x - 20, y: acc.y - 36, w: acc.w + 40, h: acc.h + 56 };
      const dr = Math.max(alco.x + alco.w, desk.x + desk.w), almF: R = { x: alco.x - 34, y: alco.y - 36, w: dr + 34 - (alco.x - 34), h: desk.y + desk.h + 24 - (alco.y - 36) };
      tre = { x: tx, y: L1, w: almF.x + almF.w + 24 - tx, h: Math.max(accF.y + accF.h, almF.y + almF.h) + 30 - L1 };
      t = { acc, sub, alco, sum, desk, accF, almF };
    } else tre = { x: tx, y: L1, w: 260, h: 240 };
    // a closed Banking Operations reaches below Accounting, so Operations' lines into Treasury and the rates u back run straight
    if (!opsOpen && t) ops.h = Math.max(240, t.accF.y + t.accF.h + 100 - L1);
    inner = { bs, ops, tre, opsOpen, treOpen, t, circ: opsOpen && o.bs ? { x: bs.x + 10, y: bs.y + HEAD + 10, w: circ[0], h: circ[1] } : null };
    R.bank = { x: bx, y: by, w: tre.x + tre.w + 40 - bx, h: Math.max(ops.y + ops.h, tre.y + tre.h) + (treOpen ? 110 : 40) - by };
  } else R.bank = { x: bx, y: by, w: 240, h: o.hm ? Math.max(260, R.households.y + R.households.h + 30 - by) : R.hm.h };  // as tall as the closed Housing Market: straight lines
  // the competitor bank (Jesse, 26 Nov 2026): My Bank's twin, under it and above the firm-credit bus
  // (shifted right of My Bank's firm-credit ports, so those lines pass beside it)
  // open (Jesse: 'I still want the accounting in the competitor bank'): its income statement and metrics on the left,
  // its balance sheet on the right
  R.comp = o.comp ? { x: R.bank.x + 150, y: R.bank.y + R.bank.h + 70, w: 1030, h: HEAD + 20 + HEAD + 330 + 20 + HEAD + 300 + 20 }
    : { x: R.bank.x + 150, y: R.bank.y + R.bank.h + 70, w: 200, h: 260 };
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

// (info: a content line under the title; not drawn since 26 Nov 2026, Jesse: no text in the boxes)
function Block({ r, label, tone, open, toggle, children, z, info }: { r: R; label: string; tone: string; open?: boolean; toggle?: () => void; children?: ReactNode; z?: number; info?: ReactNode }) {
  return <div className={`map-node ${tone}${open ? ' open bus-open-block' : ''}`} style={{ position: 'absolute', left: r.x, top: r.y, width: r.w, height: r.h, zIndex: z ?? 2 }}>
    <div className="block-head"><strong>{label}</strong>{toggle && <button className="toggle nodrag" aria-label={`${open ? 'Collapse' : 'Expand'} ${label}`} onClick={e => { e.stopPropagation(); toggle(); }}>{open ? <Minus size={13}/> : <Plus size={13}/>}</button>}</div>
    {children}
  </div>;
}

// A statement box body that reports its content height, so the box grows or shrinks with opened lines (Jesse)
// Feedback round 2 (A1): the height follows opened and closed lines only, never a value. Value cells have a fixed width
// (style.css), and while Play runs the measured height is frozen (Inner drops 'fit:' updates).
function FitBody({ k, onH, style, children }: { k: string; onH: (k: string, h: number) => void; style: React.CSSProperties; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current?.querySelector('.stmt-block') as HTMLElement | null; if (!el) return;  // the statement itself, not its stretched wrapper
    const report = () => onH(k, el.offsetHeight + 12); report();
    const ro = new ResizeObserver(report); ro.observe(el); return () => ro.disconnect();
  }, [k, onH]);
  return <div ref={ref} className="bus-stmt-body nowheel" style={style}>{children}</div>;
}

// A3 (M. Mendel, as in DynaBI): dots run along every wire. Speed proportional to |flow| at the cursor (each flow scaled
// by its largest value over the run), direction by its sign, none at zero. One requestAnimationFrame loop moves SVG
// circles through refs: no React state, so the dots never change the layout (A1).
// The time cursor reaches the diagram through this context, not through the node's data: a new node object on every
// Play tick made React Flow hide the node until it was measured again, so the mouse cursor flickered between the
// arrow and the canvas's hand (Jesse, 26 Nov 2026).
const Tick = createContext<{ at: number; playing: boolean }>({ at: 0, playing: false });
type DotPath = { key: string; pts: number[][]; v: number; color: string };
const DOT_GAP = 34, DOT_SPEED = 70;  // px between dots, px per second at the largest flow of the run
function DotLayer({ W, H, paths, playing }: { W: number; H: number; paths: DotPath[]; playing: boolean }) {
  const run = useRef(playing); run.current = playing;
  const ref = useRef<SVGGElement>(null), live = useRef<{ p: DotPath; cum: number[]; n: number }[]>([]), phase = useRef(new Map<string, number>());
  live.current = paths.map(p => { const cum = [0]; for (let i = 1; i < p.pts.length; i++) cum.push(cum[i - 1] + Math.hypot(p.pts[i][0] - p.pts[i - 1][0], p.pts[i][1] - p.pts[i - 1][1]));
    return { p, cum, n: Math.max(1, Math.floor(cum[cum.length - 1] / DOT_GAP)) }; });
  useEffect(() => {
    let raf = 0, last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      const cs = ref.current?.children; let ci = 0;
      if (cs) for (const { p, cum, n } of live.current) {
        const L = cum[cum.length - 1] || 1, ph = ((phase.current.get(p.key) ?? 0) + p.v * DOT_SPEED * dt) % DOT_GAP; phase.current.set(p.key, ph);
        const off = !run.current || Math.abs(p.v) < 0.01;  // dots only while Play runs (Jesse)
        for (let j = 0; j < n; j++, ci++) {
          const c = cs[ci] as SVGCircleElement | undefined; if (!c) continue;
          if (off) { c.setAttribute('opacity', '0'); continue; }
          let d = (j * DOT_GAP + ph) % L; if (d < 0) d += L;
          let k = 1; while (k < cum.length - 1 && cum[k] < d) k++;
          const a = p.pts[k - 1], b = p.pts[k], t = (d - cum[k - 1]) / ((cum[k] - cum[k - 1]) || 1);
          c.setAttribute('cx', String(a[0] + (b[0] - a[0]) * t)); c.setAttribute('cy', String(a[1] + (b[1] - a[1]) * t)); c.setAttribute('opacity', '1');
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf);
  }, []);
  return <svg width={W} height={H} className="bus-wires bus-dots" aria-hidden="true"><g ref={ref}>
    {live.current.flatMap(({ p, n }) => Array.from({ length: n }, (_, j) => <circle key={p.key + ':' + j} r={2.8} fill={p.color} stroke="#fff" strokeWidth={0.8} opacity={0}/>))}
  </g></svg>;
}

// ---- Supervisory Outlier Test (26 Nov 2026): six regulatory rate shocks on My Bank's balance sheet (backend housing/sot.py)
type SotRow = { sizes: string; scenario: string; name: string; d_eve_pct_t1: number; eve_outlier: boolean; d_nii_pct_t1?: number; nii_outlier?: boolean };
type SotPaths = { price: number[]; cpr: number[]; deposits: number[]; client_rate: number[]; mortgage_rate: number[] };
type SotTime = { nii_cum: number[]; nii_q: number[]; below5: number; worst_q: number; worst_when: number; driver: string };
export type SotReport = { margins: string; rows: SotRow[]; t_quarters: number[]; time: Record<string, SotTime>; maturities: number[]; curves: Record<string, number[]>; t_years: number[]; paths: Record<string, SotPaths>; rules: string };
const SOT_SC = ['parallel_up', 'parallel_down', 'steepener', 'flattener', 'short_up', 'short_down'];
const SOT_EU = 'EU RTS 2024/856', SOT_RED = '#c0392b';
const SOT_COL: Record<string, string> = { parallel_up: '#0072B2', parallel_down: '#D55E00', steepener: '#009E73', flattener: '#CC79A7', short_up: '#56B4E9', short_down: '#E69F00' };  // Okabe-Ito, as the thesis figures
function SotCard({ r, rep, sel, pick }: { r: R; rep: SotReport; sel: string; pick: (s: string) => void }) {
  const eu = (sc: string) => rep.rows.find(x => x.sizes === SOT_EU && x.scenario === sc)!, bc = (sc: string) => rep.rows.find(x => x.sizes !== SOT_EU && x.scenario === sc)!;
  const vals = rep.rows.map(x => x.d_eve_pct_t1), lo = Math.min(-20, ...vals) - 3, hi = Math.max(5, ...vals) + 3;
  const W = r.w - 20, H = 170, L = 34, sy = (v: number) => 8 + (hi - v) / (hi - lo) * (H - 40), gw = (W - L) / 6;
  const mini = (k: keyof SotPaths, label: string) => { const b = rep.paths.base[k], s2 = rep.paths[sel]?.[k] ?? b, all = [...b, ...s2], mn = Math.min(...all), mx = Math.max(...all), pad = (mx - mn) * 0.1 || 1;
    const w = (W - 10) / 2, h = 64, px = (i: number) => 4 + i / (b.length - 1) * (w - 8), py = (v: number) => 4 + (mx + pad - v) / (mx - mn + 2 * pad) * (h - 18);
    const pl = (a: number[]) => a.map((v, i) => `${px(i)},${py(v)}`).join(' ');
    return <div key={k} className="sot-mini"><small>{label}</small><svg width={w} height={h}><polyline points={pl(b)} fill="none" stroke="#8a94a6" strokeWidth={1.5}/><polyline points={pl(s2)} fill="none" stroke={SOT_RED} strokeWidth={1.8}/>
      <text x={w - 4} y={h - 3} textAnchor="end" className="mini-tick">15 yr</text><text x={4} y={h - 3} className="mini-tick">0</text></svg></div>; };
  const s = eu(sel);
  return <div className="sot-card nodrag nowheel" style={{ left: r.x, top: r.y, width: r.w }} onClick={e => e.stopPropagation()}>
    <div className="sot-head"><b>Supervisory Outlier Test · My Bank</b><small>EU 2024/856 · margins {rep.margins} · ALM desk off</small></div>
    <svg width={W} height={H} role="img" aria-label="Change in economic value of equity per scenario">
      {[-15, 0].map(v => <g key={v}><line x1={L} x2={W} y1={sy(v)} y2={sy(v)} stroke={v ? SOT_RED : '#8a94a6'} strokeDasharray={v ? '4 3' : undefined}/>{v ? <text x={W} y={sy(v) - 3} textAnchor="end" className="mini-tick" fill={SOT_RED}>outlier: −15% of Tier 1</text> : null}</g>)}
      {[lo, hi].map(v => <text key={v} x={L - 4} y={sy(v) + 3} textAnchor="end" className="mini-tick">{v.toFixed(0)}%</text>)}
      {SOT_SC.map((sc, i) => { const a = eu(sc).d_eve_pct_t1, b = bc(sc).d_eve_pct_t1, x = L + i * gw + gw * 0.15, bw = gw * 0.32, on = sc === sel;
        const bar = (v: number, xx: number, op: number) => <rect x={xx} y={Math.min(sy(0), sy(v))} width={bw} height={Math.abs(sy(v) - sy(0)) || 1} fill={v < -15 ? SOT_RED : '#4f7cac'} opacity={op}/>;
        return <g key={sc} style={{ cursor: 'pointer' }} onClick={() => pick(sc)}><title>{`${eu(sc).name}: ΔEVE ${a.toFixed(1)}% (EU sizes), ${b.toFixed(1)}% (BCBS 2024 sizes) of Tier 1`}</title>
          <rect x={L + i * gw} y={0} width={gw} height={H - 26} fill={on ? '#eef3f9' : 'transparent'}/>
          {bar(a, x, on ? 1 : 0.75)}{bar(b, x + bw + 2, on ? 0.55 : 0.35)}
          <text x={L + i * gw + gw / 2} y={H - 12} textAnchor="middle" className="mini-tick" fontWeight={on ? 700 : 400}>{eu(sc).name.replace('Parallel ', 'Par. ')}</text></g>; })}
    </svg>
    <div className="sot-legend"><i style={{ background: '#4f7cac' }}/>EU sizes (200/250/100 bp) <i style={{ background: '#4f7cac', opacity: 0.45 }}/>BCBS 2024 sizes (225/350/200 bp) <i style={{ background: SOT_RED }}/>outlier</div>
    <div className="sot-sel"><b>{s.name}</b>: ΔEVE <b className={s.eve_outlier ? 'bad' : ''}>{s.d_eve_pct_t1.toFixed(1)}%</b> of Tier 1
      {s.d_nii_pct_t1 !== undefined && <> · ΔNII (1 yr) <b className={s.nii_outlier ? 'bad' : ''}>{s.d_nii_pct_t1.toFixed(1)}%</b> (outlier below −5%)</>}</div>
    {/* over time (supplementary): the cumulative change in net interest income, six scenarios, -5% line */}
    {(() => { const tq = rep.t_quarters, all = SOT_SC.flatMap(sc => rep.time[sc].nii_cum), lo2 = Math.min(-8, ...all) - 1, hi2 = Math.max(5, ...all) + 1, H2 = 130;
      const px = (t: number) => L + t / 5 * (W - L - 6), py = (v: number) => 6 + (hi2 - v) / (hi2 - lo2) * (H2 - 24);
      const tsel = rep.time[sel];
      return <div className="sot-time"><small>Over time (supplementary): cumulative ΔNII, % of Tier 1, constant balance sheet</small>
        <svg width={W} height={H2} role="img" aria-label="Cumulative change in net interest income over five years">
          <line x1={L} x2={W} y1={py(0)} y2={py(0)} stroke="#8a94a6"/><line x1={L} x2={W} y1={py(-5)} y2={py(-5)} stroke={SOT_RED} strokeDasharray="4 3"/>
          <text x={W} y={py(-5) - 3} textAnchor="end" className="mini-tick" fill={SOT_RED}>−5%</text>
          {[lo2, hi2].map(v => <text key={v} x={L - 4} y={py(v) + 3} textAnchor="end" className="mini-tick">{v.toFixed(0)}%</text>)}
          {[0, 1, 2, 3, 4, 5].map(t => <text key={t} x={px(t)} y={H2 - 4} textAnchor="middle" className="mini-tick">{t} yr</text>)}
          {SOT_SC.map(sc => <polyline key={sc} points={[[0, 0], ...tq.map((t, i) => [t, rep.time[sc].nii_cum[i]])].map(([t, v]) => `${px(t)},${py(v)}`).join(' ')}
            fill="none" stroke={SOT_COL[sc]} strokeWidth={sc === sel ? 2.6 : 1.2} opacity={sc === sel ? 1 : 0.55} style={{ cursor: 'pointer' }} onClick={() => pick(sc)}><title>{eu(sc).name}</title></polyline>)}
        </svg>
        <small>{s.name}: worst quarter {tsel.worst_q.toFixed(1)}% of Tier 1 in year {tsel.worst_when.toFixed(2)} (driver: {tsel.driver.replace('_', ' ')}){tsel.below5 > 0 ? `; cumulative below −5% for ${tsel.below5.toFixed(1)} of 5 years` : ''}.</small></div>; })()}
    <div className="sot-minis">{mini('price', 'House price index')}{mini('cpr', 'Prepayment rate (% a year)')}{mini('deposits', 'Savings deposits')}{mini('client_rate', 'Savings rate (%)')}</div>
    <small className="sot-note">Grey: no shock; red: {s.name}. Behaviour from the multiport model: prepayment (movers, refinancing, house prices), savings rate and volume. {rep.rules}</small>
  </div>;
}

// B2: the market's yield curve at the cursor (rate against maturity), with the bank's own rates: savings at the short
// end, mortgages against the 10-year point (static curve: a parallel shift with r_mkt; term premia from the ECB AAA curve)
function YieldCurve({ r, result, at, shock }: { r: R; result: Result; at: number; shock?: { m: number[]; dz: number[]; name: string; after: boolean } }) {
  const MAT = [0, 2, 5, 10, 20, 30], v = (k: string) => readTrace(result, k)?.[at] ?? null, pts = MAT.map(T => [T, v('Yield:' + T)] as [number, number | null]);
  // SOT shock: the regulatory shift dz(maturity) on top of the market curve (0-10 years shown)
  // the curve itself carries the shock once the cursor is past the shock year (a full netlist run); dashed: without it
  const dzAt = (T: number) => { if (!shock) return 0; const m = shock.m; let k = 1; while (k < m.length - 1 && m[k] < T) k++; return shock.dz[k - 1] + (shock.dz[k] - shock.dz[k - 1]) * (T - m[k - 1]) / (m[k] - m[k - 1]); };
  const sh = shock?.after ? pts.filter(p => p[1] != null).map(p => [p[0], p[1]! - dzAt(Math.max(p[0], 0.25))] as [number, number]) : [];
  const rm = v('I(Bk_rm)'), rs = v('I(Bk_rs)'), ys = [...pts.map(p => p[1]), rm, rs, ...sh.map(p => p[1])].filter((x): x is number => x != null);
  if (!ys.length) return null;
  // a fixed axis (Jesse): shifts, shocks and the bank's rates show against the same scale
  const lo = Math.min(-2, Math.floor(Math.min(...ys))), hi = Math.max(6, Math.ceil(Math.max(...ys))), W = r.w - 16, H = r.h - 76, L = 34, Bm = 22;
  const sx = (T: number) => L + T / 30 * (W - L - 14), sy = (y: number) => 6 + (hi - y) / (hi - lo) * (H - 6 - Bm);
  const curve = pts.filter(p => p[1] != null).map(p => `${sx(p[0])},${sy(p[1]!)}`).join(' ');
  return <div className="bus-yield" style={{ left: r.x, top: r.y, width: r.w, height: r.h }}>
    <b>Yield curve</b> <small>at {result.year[at].toFixed(1)}</small>
    <svg width={W} height={H} role="img" aria-label="Yield curve at the cursor">
      {[lo, (lo + hi) / 2, hi].map(y => <g key={y}><line x1={L} x2={W - 8} y1={sy(y)} y2={sy(y)} stroke="#e4e2ea"/><text x={L - 4} y={sy(y) + 3} textAnchor="end" className="mini-tick">{y.toFixed(1)}%</text></g>)}
      {[0, 5, 10, 20, 30].map(T => <text key={T} x={sx(T)} y={H - 6} textAnchor="middle" className="mini-tick">{T === 0 ? 'short' : T + ' yr'}</text>)}
      <polyline points={curve} fill="none" stroke="#7a7396" strokeWidth={2}/>
      {sh.length > 0 && <polyline points={sh.map(p => `${sx(p[0])},${sy(p[1])}`).join(' ')} fill="none" stroke="#9aa3b2" strokeWidth={1.5} strokeDasharray="5 3"/>}
      {shock && <text x={W - 10} y={14} textAnchor="end" className="mini-tick" fill={SOT_RED}>{shock.after ? shock.name + ' (dashed: no shock)' : shock.name + ': from ' + (result.year[0] + 3).toFixed(0)}</text>}
      {pts.map(p => p[1] != null && <circle key={p[0]} cx={sx(p[0])} cy={sy(p[1])} r={3.5} fill="#7a7396"/>)}
    </svg>
    <small>Market: r<sub>mkt</sub> + term premium, ECB euro-area AAA curve, 2004–2026 average (2 yr +0.08, 5 yr +0.44, 10 yr +1.02, 20 yr +1.46, 30 yr +1.51 pp).</small>
  </div>;
}

// My Bank's own yield curve (Jesse, 26 Nov 2026): its three controlled rates by maturity, u2 savings (overnight), u3 firm
// loans (10 years), u1 mortgages (30 years), against the market curve (faint) on the same fixed axis; after a rate shock
// the bank's curve just before the shock is dashed.
function BankCurve({ r, result, at, shockIdx }: { r: R; result: Result; at: number; shockIdx: number | null }) {
  const v = (k: string, i = at) => readTrace(result, k)?.[i] ?? null;
  const bank = (i: number) => [[0, v('I(Bk_rs)', i)], [10, v('I(Bk_rf)', i)], [30, v('I(Bk_rm)', i)]] as [number, number | null][];
  const mkt = [0, 2, 5, 10, 20, 30].map(T => [T, v('Yield:' + T)] as [number, number | null]);
  const W = r.w - 16, H = r.h - 44, L = 34, lo = -2, hi = 6, sx = (T: number) => L + T / 30 * (W - L - 14), sy = (y: number) => 6 + (hi - y) / (hi - lo) * (H - 28);
  const pl = (p: [number, number | null][]) => p.filter(q => q[1] != null).map(q => `${sx(q[0])},${sy(q[1]!)}`).join(' ');
  const now = bank(at), before = shockIdx != null && at > shockIdx ? bank(shockIdx) : null, name = ['savings', 'firm loans', 'mortgages'];
  return <div className="bus-yield bank-curve" style={{ left: r.x, top: r.y, width: r.w, height: r.h }}>
    <b>My Bank's rates</b> <small>at {result.year[at].toFixed(1)} · u₂ savings · u₃ firm loans · u₁ mortgages</small>
    <svg width={W} height={H} role="img" aria-label="My Bank's rates by maturity">
      {[lo, 0, 2, 4, hi].map(y => <g key={y}><line x1={L} x2={W - 8} y1={sy(y)} y2={sy(y)} stroke="#e4e2ea"/><text x={L - 4} y={sy(y) + 3} textAnchor="end" className="mini-tick">{y}%</text></g>)}
      {[0, 10, 20, 30].map(T => <text key={T} x={sx(T)} y={H - 6} textAnchor="middle" className="mini-tick">{T === 0 ? 'overnight' : T + ' yr'}</text>)}
      <polyline points={pl(mkt)} fill="none" stroke="#b9b5c9" strokeWidth={1.5}/>
      {before && <polyline points={pl(before)} fill="none" stroke="#4f7cac" strokeWidth={1.5} strokeDasharray="5 3"/>}
      <polyline points={pl(now)} fill="none" stroke="#2e5d8f" strokeWidth={2.2}/>
      {now.map(([T, y], i) => y != null && <g key={T}><circle cx={sx(T)} cy={sy(y)} r={4} fill="#2e5d8f"/>
        <text x={sx(T) + (i === 2 ? -6 : 6)} y={sy(y) - 7} textAnchor={i === 2 ? 'end' : 'start'} className="mini-tick" fill="#2e4a6b">{name[i]} {y.toFixed(2)}%</text></g>)}
    </svg>
    <small>Blue: My Bank (dashed: just before the rate shock). Grey: the market curve.</small>
  </div>;
}

type DiagramData = { result: Result; o: Open; set: (k: string) => void; map: MapData; scenario: Scenario; desk: ReactNode; buses: boolean; sizes: Record<string, P>; resize: (k: string, s: P | null) => void; crisisOn: boolean; sot: string; sotRep: SotReport | null; setSot: (s: string) => void };
function Diagram({ data }: NodeProps<Node<DiagramData>>) {
  const { result, o, set, map, scenario, desk, buses, sizes, resize, crisisOn, sot, sotRep, setSot } = data;
  const { at, playing } = useContext(Tick);
  const rf = useReactFlow();
  const fitH = useCallback((k: string, h: number) => { if (Math.abs((sizes['fit:' + k]?.[1] ?? 0) - h) > 2) resize('fit:' + k, [0, h]); }, [sizes, resize]);
  STRAIGHT.on = !buses;
  const g = geometry(o, map, sizes), { R } = g, B = R.bank;
  // click a flow, a bus or a shock: a card with its plot over the run (as the plot cards in the control-loop view)
  const [pick, setPick] = useState<Pick | null>(null);
  const hit = (pts: number[][], key: string, p: Pick, tip: string) => <polyline key={key + 'h'} points={pts.map(q => q.join(',')).join(' ')} fill="none" stroke="transparent" strokeWidth={14}
    style={{ pointerEvents: 'stroke', cursor: 'pointer' }} onClick={e => { e.stopPropagation(); setPick(p); }}><title>{tip}</title></polyline>;
  const flowOf = (id: string) => map.flows.find(f => f.id === id);
  // A3: values at the cursor. norm: the value over its largest |value| of the run (dot speed); raw: for the meters
  const raw = (signal: string) => readTrace(result, signal)?.[at] ?? null;
  const norm = (signal: string) => { const s = readTrace(result, signal); if (!s) return 0; const m = Math.max(1e-9, ...s.map(x => Math.abs(x ?? 0))); return (s[at] ?? 0) / m; };
  const flowSig = (flow: string) => flowOf(flow)?.signal ?? '', effSig = (flow: string) => { const pt = flowOf(flow)?.port; return pt ? `V(${pt.node.toLowerCase()},${pt.ret.toLowerCase()})` : ''; };
  const fmt = (x: number | null) => x == null ? '–' : Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) >= 10 ? x.toFixed(1) : x.toFixed(2);
  const dots: DotPath[] = [];
  const compOn = (readTrace(result, 'I(Bk_mc)') ?? []).some(x => Math.abs(x ?? 0) > 1e-6), comp = R.comp;
  // the competitor's ports: the same banking book as My Bank (closed tile), so the same terminals on its own tile
  const compTerm = (flow: string): { p: P; q: P } => { const l = map.layouts.bank, w = (l.size as P)[0];
    const sideOf = ([x, y]: number[]) => x === 0 ? 'L' : x === w ? 'R' : y === 0 ? 'T' : 'B', side = sideOf(l.ports[flow]);
    const same = Object.keys(l.ports).filter(f => sideOf(l.ports[f]) === side).sort((a, b) => l.ports[a][side === 'L' ? 1 : 0] - l.ports[b][side === 'L' ? 1 : 0]), i = same.indexOf(flow);
    if (side === 'L') { const y = comp.y + 80 + i * (comp.h - 120) / same.length; return { p: [comp.x, y], q: [comp.x, y + LANE] }; }
    const x = comp.x + 50 + i * 60; return { p: [x, comp.y + comp.h], q: [x + LANE, comp.y + comp.h] }; };
  // a flow's dots on a wire drawn from the agent `from`: positive flow runs from its source to its target
  const flowDots = (pts: number[][], flow: string, from: string, color: string, key: string, ret = false) => {
    const f = flowOf(flow); if (!f) return; const sgn = (f.source === from ? 1 : -1) * (ret ? -1 : 1); dots.push({ key, pts, v: sgn * norm(f.signal), color }); };
  // an e or f meter with its live value beside it (A3)
  // pos: where the value sits (right of the circle, or above / below it on a horizontal pair, clear of its partner)
  const meterAt = (c: P, q: string, value: number | null, color: string, key: string, onPick?: () => void, pos: 'r' | 'a' | 'b' = 'r') => <g key={key} style={{ cursor: onPick ? 'pointer' : undefined, pointerEvents: onPick ? 'all' : 'none' }} onClick={onPick ? ev => { ev.stopPropagation(); onPick(); } : undefined}>
    <title>{q === 'e' ? 'Effort e at the cursor: click to plot' : q === 'f' ? 'Flow f at the cursor: click to plot' : 'Value at the cursor: click to plot'}</title>
    <circle cx={c[0]} cy={c[1]} r={6.2} fill="#fff" stroke={color} strokeWidth={1.2}/><text x={c[0]} y={c[1] + 3} textAnchor="middle" className="bus-meter" fill={color}>{q}</text>
    {/* no value beside the circle (Jesse, 26 Nov 2026); the title and the click card give it */}<title>{fmt(value)}</title></g>;
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
      const horiz = Math.abs(A[1] - B[1]) < 0.5, below = RA[1] > A[1];  // horizontal pair: f value on the flow's side, e value on the return's side
      const meter = (c: P, q: 'e' | 'f') => meterAt(c, q, raw(q === 'e' ? effSig(flow) : flowSig(flow)), color, q, () => setPick({ kind: q === 'e' ? 'ret' : 'flow', id: flow, at: c }),
        !horiz ? 'r' : (q === 'f') === below ? 'a' : 'b');
      return <g key={j}><line x1={e1[0]} y1={e1[1]} x2={e2[0]} y2={e2[1]} stroke={color} strokeWidth={1.2}/>
        <circle cx={t1[0]} cy={t1[1]} r={2.6} fill="#fff" stroke={color}/><circle cx={t2[0]} cy={t2[1]} r={2.6} fill="#fff" stroke={color}/>{meter(em, 'e')}{meter(fm, 'f')}</g>;
    };
    return <g key={key + 'm'}>
      {end(pf[0], pf[1], pq[0], pq[1], 0)}{end(pf[n - 1], pf[n - 2], pq[n - 1], pq[n - 2], 1)}
      <path d="M-6 -5L5 0L-6 5Z" fill={color} transform={`translate(${tri[0]} ${tri[1]}) rotate(${ang})`}/>
      <text className="bus-flow-name" fill={color} transform={`translate(${vert ? m[0] - 7 : m[0]} ${vert ? m[1] : m[1] - 7}) rotate(${vert ? -90 : 0})`} textAnchor="middle">{f?.short ?? flow}</text>
    </g>;
  };
  // a closed statement box shows its headline line at the cursor (A7)
  const HEADLINE: Record<string, [string, string]> = { inc: ['net_profit', 'net profit'], bal: ['assets', 'total assets'], cf: ['cf_net', 'net change in cash'], key: ['tier1', 'Tier 1'] };
  const tileValue = (k: string) => { const [id, name] = HEADLINE[k], x = readTrace(result, 'Ledger:' + id)?.[at], u = result.ledger?.accounts[id]?.unit ?? '';
    return <>{name} <b>{x == null ? '–' : u.startsWith('%') ? x.toFixed(1) + '%' : x.toFixed(1)}</b></>; };
  const wires: ReactNode[] = [], over: ReactNode[] = [], rails: Record<string, { c: number; vertical: boolean; hi: number }> = {};  // over: drawn above the blocks (wires into an opened breadboard)
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
    const c = vertical ? (bus.id === 'mortgage' ? gapBank !== null ? gapBank - 80 : g.c2 + g.w2 + 110 : bus.id === 'deposit' ? gapBank !== null ? gapBank + 60 : g.c2 + g.w2 + 250 : (Math.min(A.x + A.w, Bb.x + Bb.w) + Math.max(A.x, Bb.x)) / 2 - LANE / 2 + off)
      : bus.id === 'firm' ? Math.max(R.firms.y + R.firms.h, R.households.y + R.households.h, Bb.y + Bb.h, R.comp.y + R.comp.h) + 70 : (A.y + A.h + Bb.y) / 2 - LANE / 2 + off;
    if (!buses || (CPB4.includes(bus.a) && CPB4.includes(bus.b))) {  // inside the Housing Market: always port to port (M. Mendel)
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
        wires.push(line(pf, bus.color, `${bus.id}${j}p`)); wires.push(line(pq, bus.color, `${bus.id}${j}q`));
        flowDots(pf, flow, bus.a, bus.color, `${bus.id}${j}p`); flowDots(pq, flow, bus.a, bus.color, `${bus.id}${j}q`, true);
        wires.push(hit(pf, `${bus.id}${j}p`, { kind: 'flow', id: flow, at: pf[1] as P }, `${f?.label ?? flow}: click to plot`));
        wires.push(hit(pq, `${bus.id}${j}q`, { kind: 'ret', id: flow, at: pq[1] as P }, `${f?.label ?? flow} · incentive (return): click to plot`));
        over.push(marks(pf as P[], pq as P[], bus.color, flow, `${bus.id}${j}`, f?.source === bus.b));
      });
      continue;
    }
    const taps: P[] = [];
    const branch = (pt: P, k: number, key: string, flow: string, ret = false, dash?: string) => {  // ret: the return (e) line
      const end: P = vertical ? [c + k, pt[1]] : [pt[0], c + k]; taps.push(end);
      const f = flowOf(flow);
      wires.push(line([pt, end], bus.color, key, dash)); wires.push(dot(end, bus.color, key + 'd'));
      if (!ret) { const mx = (pt[0] + end[0]) / 2, my = (pt[1] + end[1]) / 2, vert = Math.abs(pt[0] - end[0]) < 0.5;  // the flow's name on its line
        wires.push(<text key={key + 'n'} className="bus-branch-name" fill={bus.color} textAnchor="middle" transform={`translate(${vert ? mx - 5 : mx} ${vert ? my : my - 4}) rotate(${vert ? -90 : 0})`}>{f?.short ?? flow}</text>); }
      wires.push(hit([pt, end], key, { kind: ret ? 'ret' : 'flow', id: flow, at: end }, `${f?.label ?? flow}${ret ? ' · incentive (return)' : ''}: click to plot`));
    };
    // the competitor on the same bus as My Bank (dotted while it is switched off)
    if (bus.b === 'bank') bus.flows.forEach((f, j) => { const t = compTerm(f); ([[t.p, 0, 'p'], [t.q, LANE, 'q']] as const).forEach(([pt, k, s2]) => {
      const end: P = vertical ? [c + k, pt[1]] : [pt[0], c + k]; taps.push(end); wires.push(line([pt, end], bus.color, `${bus.id}c${j}${s2}`, compOn ? undefined : '2 4')); wires.push(dot(end, bus.color, `${bus.id}c${j}${s2}d`)); }); });
    ends.forEach((e, i) => { const f = bus.flows[Math.floor(i / 2)], who = i % 2 ? bus.b : bus.a; branch(e.p, 0, `${bus.id}${i}p`, f); branch(e.q, LANE, `${bus.id}${i}q`, f, true);
      flowDots([e.p, taps[taps.length - 2]], f, who, bus.color, `${bus.id}${i}p`); flowDots([e.q, taps[taps.length - 1]], f, who, bus.color, `${bus.id}${i}q`, true);
      // A3: e and f meters at the boundary port, on the branch just outside the block
      const t = taps[taps.length - 2], dl = Math.hypot(t[0] - e.p[0], t[1] - e.p[1]) || 1, u: P = [(t[0] - e.p[0]) / dl, (t[1] - e.p[1]) / dl], dd = Math.min(30, dl / 2.5);
      const fm: P = [e.p[0] + u[0] * dd, e.p[1] + u[1] * dd], em: P = [(e.p[0] + e.q[0]) / 2 + u[0] * (dd + 18), (e.p[1] + e.q[1]) / 2 + u[1] * (dd + 18)];
      over.push(meterAt(fm, 'f', raw(flowSig(f)), bus.color, `${bus.id}${i}mf`, () => setPick({ kind: 'flow', id: f, at: fm }), vertical ? 'a' : 'r'));
      over.push(meterAt(em, 'e', raw(effSig(f)), bus.color, `${bus.id}${i}me`, () => setPick({ kind: 'ret', id: f, at: em }), vertical ? 'b' : 'r')); });
    const along = taps.map(t => vertical ? t[1] : t[0]), lo = Math.min(...along) - 24, hi = Math.max(...along) + 24; rails[bus.id] = { c, vertical, hi };
    wires.unshift(<g key={bus.id + 'rails'}>
      {[0, LANE].map(k => <line key={k} x1={vertical ? c + k : lo} x2={vertical ? c + k : hi} y1={vertical ? lo : c + k} y2={vertical ? hi : c + k} stroke={bus.color} strokeWidth={6} strokeLinecap="round"/>)}
      <text x={vertical ? c + LANE / 2 : hi + 14} y={vertical ? (bus.n ? Math.min(A.y, Bb.y) - 12 - 18 * (bus.n - 1 - (bus.k ?? 0)) : bus.id === 'deposit' ? hi + 22 : lo - 12) : c + LANE} textAnchor={vertical ? 'middle' : 'start'} className="bus-name" fill={bus.color}>{bus.label}</text>
      {hit(vertical ? [[c + LANE / 2, lo], [c + LANE / 2, hi]] : [[lo, c + LANE / 2], [hi, c + LANE / 2]], bus.id + 'rail', { kind: 'bus', id: bus.id, at: vertical ? [c + LANE, lo + 40] : [lo + 40, c + LANE] }, `${bus.label}: click to plot its flows`)}
    </g>);
  }
  // ---- the bank in the middle: the real economy on its left, the Financial sector (empty for now) on its right,
  // joined by the interbank bus (a money bus)
  const IB = '#b4609a', ibY = B.y + B.h - 60;  // interbank bus: reddish purple
  // the Financial sector (M. Mendel, 26 Nov 2026: scaffolding only): open, the two counterparties the model already has
  // open: shrunk to its content plus a fixed margin (A7); the central bank is DNB, also the supervisor (B1)
  const RX = Math.max(B.x + B.w + 150, comp.x + comp.w + 60);  // the interbank rail: right of My Bank and of the competitor
  const fs: R = o.fs ? { x: RX + 170, y: B.y + 40, w: 340, h: HEAD + 30 + 90 + 60 + 100 + 64 + 290 } : { x: RX + 170, y: B.y + B.h / 2 - TILE[1] / 2, w: TILE[0], h: TILE[1] };
  const ob: R = { x: fs.x + 40, y: fs.y + HEAD + 30, w: 260, h: 90 }, cbk: R = { x: fs.x + 40, y: ob.y + ob.h + 60, w: 260, h: 100 };
  // the interbank bus (Jesse, 27 Nov 2026): two port pairs like the other buses, interbank loans (net borrowing from the
  // financial sector) and interbank interest; the efforts are the rates the financial sector sets, the risk-free curve
  const IBP = 30, ibY2 = ibY + IBP;  // the interest pair runs 30 px below the loans pair
  { const rx = RX, ends: [number, number, string][] = o.fs ? [[ob.x, ob.y + ob.h / 2 - LANE / 2 - IBP / 2, 'other banks'], [cbk.x, cbk.y + cbk.h / 2 - LANE / 2 - IBP / 2, 'central bank']] : [[fs.x, fs.y + fs.h / 2 - LANE / 2 - IBP / 2, '']];
    const cY = comp.y + comp.h - 60, ys = [ibY, ibY2, cY, cY + IBP, ...ends.flatMap(e => [e[1], e[1] + IBP])], lo = Math.min(...ys) - 24, hi = Math.max(...ys) + LANE + 24;
    const g2: ReactNode[] = [];
    const pair = (x0: number, y: number, k: string, dash?: string, toY?: number, dx = 0) => {  // one port pair from x0 at y to the rails (bus view) or to toY (ports view)
      if (buses) g2.push(line([[x0, y], [rx, y]], IB, k + 'p', dash), line([[x0, y + LANE], [rx + LANE, y + LANE]], IB, k + 'q', dash));
      else g2.push(line([[x0, y], [rx + dx, y], [rx + dx, toY!]], IB, k + 'p', dash), line([[x0, y + LANE], [rx + dx + LANE, y + LANE], [rx + dx + LANE, toY! + LANE]], IB, k + 'q', dash)); };
    pair(B.x + B.w, ibY, 'ibl', undefined, ibY); pair(B.x + B.w, ibY2, 'ibi', undefined, ibY2, IBP);
    // the competitor's port pairs on the same bus (dotted while it is switched off)
    pair(comp.x + comp.w, cY, 'ibcl', compOn ? undefined : '2 4', ibY); pair(comp.x + comp.w, cY + IBP, 'ibci', compOn ? undefined : '2 4', ibY2, IBP);
    ends.forEach(([ex, ey, nm], k) => {
      [0, 1].forEach(j => { const y = ey + j * IBP, x1 = rx + j * IBP;
        if (buses) { g2.push(line([[rx, y], [ex, y]], IB, `ib3${k}${j}`)); g2.push(line([[rx + LANE, y + LANE], [ex, y + LANE]], IB, `ib4${k}${j}`)); }
        else { const y0 = j ? ibY2 : ibY; g2.push(line([[x1, y0], [x1, y], [ex, y]], IB, `ib3${k}${j}`)); g2.push(line([[x1 + LANE, y0 + LANE], [x1 + LANE, y + LANE], [ex, y + LANE]], IB, `ib4${k}${j}`)); } });
      if (nm) g2.push(<text key={'ibn' + k} x={(rx + IBP + LANE + ex) / 2} y={ey - 8} textAnchor="middle" className="bus-label" fill={IB}>{nm}</text>);
    });
    if (buses) { g2.unshift(...[0, LANE].map(k => <line key={'ibr' + k} x1={rx + k} x2={rx + k} y1={lo} y2={hi} stroke={IB} strokeWidth={6} strokeLinecap="round"/>));
      g2.push(<text key="ibname" x={rx + LANE / 2} y={lo - 12} textAnchor="middle" className="bus-name" fill={IB}>Interbank bus (€)</text>); }
    // flow names on My Bank's two pairs
    g2.push(<text key="ibln" x={B.x + B.w + 95} y={ibY - 4} textAnchor="middle" className="bus-branch-name" fill={IB}>interbank loans</text>,
      <text key="ibin" x={B.x + B.w + 95} y={ibY2 - 4} textAnchor="middle" className="bus-branch-name" fill={IB}>interbank interest</text>);
    wires.push(<g key="ib">{g2}</g>);
    // f and e at My Bank's port: loans (f = net borrowing per year, e = the rate of other banks); interest (f = net
    // interest paid, e = the risk-free rate; its card shows the curve at 3 months, 10 and 30 years)
    const L = (id: string) => raw('Ledger:' + id);
    ([['loans', ibY, 'cf_ib_loans', 'ib_loan_rate'], ['interest', ibY2, 'ib_interest', 'rfr_short']] as const).forEach(([id, y, fk, ek]) => {
      const v = -norm('Ledger:' + fk);  // positive = into My Bank, right to left
      dots.push({ key: 'ibf' + id, pts: [[B.x + B.w, y], [rx, y]], v, color: IB }, { key: 'ibq' + id, pts: [[B.x + B.w, y + LANE], [rx + LANE, y + LANE]], v: -v, color: IB });
      const fm: P = [B.x + B.w + 30, y], em: P = [B.x + B.w + 52, y + LANE / 2];
      over.push(meterAt(fm, 'f', L(fk), IB, 'ibmf' + id, () => setPick({ kind: 'ibf', id, at: fm }), 'a'));
      over.push(meterAt(em, 'e', L(ek), IB, 'ibme' + id, () => setPick({ kind: 'ibe', id, at: em }), 'b')); }); }
  // ---- disturbances d: Covid (and the other active shocks) into the firms' breadboard, the subsidy into households
  const dMeter = (pts: number[][], id: string, key: string) => { const d = map.disturbances.find(x => x.id === id); const sig = id === 'd_others' ? 'I(Bk_shape)' /* crisis intensity 0..1: zero outside the crisis */ : d?.signal ?? '';
    const a = pts[pts.length - 2], b = pts[pts.length - 1], c: P = [a[0] + (b[0] - a[0]) * 0.6, a[1] + (b[1] - a[1]) * 0.6];
    over.push(meterAt(c, 'd', raw(sig), '#c0392b', 'dm' + key, () => setPick({ kind: 'd', id, at: c }), Math.abs(a[1] - b[1]) < 0.5 ? 'b' : 'r')); };
  const D = '#c0392b', SCALE: Record<string, keyof Scenario> = { d_income: 'income_scale', d_covid: 'covid_scale', d_crisis: 'crisis_scale' };
  const firmIns = map.disturbances.filter(d => d.target === 'firms' && !(SCALE[d.id] && scenario[SCALE[d.id]] === 0));
  if (!o.hm) firmIns.forEach((d, i) => {
    const r = R.hm, y = r.y + HEAD + (r.h - HEAD) * (i + 1) / (firmIns.length + 2);
    wires.push(arrow([[r.x - 120, y], [r.x, y]], D, 'df' + d.id, 'd · ' + d.label)); wires.push(hit([[r.x - 120, y], [r.x, y]], 'df' + d.id, { kind: 'd', id: d.id, at: [r.x - 60, y] }, d.label + ': click to plot'));
    dMeter([[r.x - 120, y], [r.x, y]], d.id, 'df' + d.id);
  });
  else firmIns.forEach((d, i) => {
    const r = R.firms, e = map.elements.find(x => x.name === (d as { element?: string }).element && x.agent === 'firms');
    const y = o.firms && e?.pins ? r.y + HEAD + inputPath('left', i, firmIns.length, map.layouts.firms.size as P, e.pins)[0][1] * S : r.y + HEAD + (r.h - HEAD) * (i + 1) / (firmIns.length + 1);
    wires.push(arrow([[r.x - 120, y], [r.x, y]], D, 'df' + d.id, 'd · ' + d.label)); wires.push(hit([[r.x - 120, y], [r.x, y]], 'df' + d.id, { kind: 'd', id: d.id, at: [r.x - 60, y] }, d.label + ': click to plot'));
    dMeter([[r.x - 120, y], [r.x, y]], d.id, 'df' + d.id);
  });
  // the Government (M. Mendel): a top-level player outside the Housing Market. Its subsidy is an input to the model (a
  // current source inside the households, no port pair and no government agent in the netlist), so it is drawn as a
  // disturbance arrow d, not as a bus (Jesse, 26 Nov 2026). A fiscal bus fits once taxes and subsidies form a port pair.
  const gov = R.gov, gx = gov.x + gov.w / 2, laneY = R.hm.y - 72, hh = R.households, gapX = hh.x - 60;
  const govPts: number[][] = o.hm ? [[gx, gov.y + gov.h], [gx, laneY], [gapX, laneY], [gapX, (R.investors.y + R.investors.h + hh.y) / 2], [hh.x + 26, (R.investors.y + R.investors.h + hh.y) / 2], [hh.x + 26, hh.y]]
    : [[gx, gov.y + gov.h], [gx, R.hm.y]];
  wires.push(arrow(govPts, D, 'dgov', 'd · subsidy', o.hm ? 0.3 : 0.5));
  wires.push(hit(govPts, 'dgov', { kind: 'd', id: 'd_gov', at: [gx, laneY] }, 'Government subsidy: click to plot')); dMeter(govPts, 'd_gov', 'gov');
  // the other banks' shock (deposits withdrawn, premium up) into the bank, from above
  // the financial crisis comes from the Financial sector (other banks withdraw deposits, cut credit)
  // the financial crisis (Jesse): from outside into the Financial sector; it reaches the bank through the interbank link
  if (crisisOn) { const tgt = o.fs ? ob : fs, fx = tgt.x + tgt.w / 2, pts = [[fx, fs.y - 110], [fx, tgt.y]];  // open: into Other banks (only while the crisis is on)
    wires.push(arrow(pts, D, 'dob', 'd · financial crisis', 0.4)); wires.push(hit(pts, 'dob', { kind: 'd', id: 'd_others', at: [fx, fs.y - 50] }, 'Financial crisis at other banks: deposits withdrawn, premium up: click to plot')); dMeter(pts, 'd_others', 'ob'); }
  // ---- SOT: the regulatory rate shock enters the Financial sector (the market rate is set outside the model)
  const sotName = sot && sotRep ? sotRep.rows.find(x => x.scenario === sot)?.name ?? sot : '';
  const yc: R = { x: fs.x + 20, y: cbk.y + cbk.h + 84, w: fs.w - 40, h: 250 };
  if (sotName) {
    // the shock moves the market rates (the yield curve, set outside the model); from there it reaches My Bank over the
    // interbank bus (its effort e is the interbank rate) and through My Bank's own rates (Jesse: no separate line)
    const xr = fs.x + fs.w + 80, ty = o.fs ? yc.y + 50 : fs.y + fs.h / 2, tx = o.fs ? yc.x + yc.w : fs.x + fs.w, pts = [[xr, fs.y - 150], [xr, fs.y - 50], [xr, ty], [tx, ty]];
    wires.push(arrow(pts, D, 'dsot', 'd · rate shock: ' + sotName, 0));
    wires.push(hit(pts, 'dsot', { kind: 'shock', id: sot, at: [xr, fs.y - 40] }, 'Rate shock: click for its pattern over the maturities'));
  }
  // no regulatory-thresholds line to the ALCO (Jesse, 27 Nov 2026: removed); the thresholds stay in the Metrics statement
  // ---- inside the bank
  let inside: ReactNode = null;
  if (g.inner) {
    const { bs, ops, tre, opsOpen, treOpen, circ, t: T } = g.inner, G = SIG, PU = SIG, bankFlows = Object.keys(map.layouts.bank.ports);
    // the bank's ports into Operations (onto the breadboard's own terminals when it is open; the division's edge when closed)
    for (const f of bankFlows) {
      const t = terminal(map, g, o, 'bank', f), col = BUSES.find(b => (b.flows as readonly string[]).includes(f))!.color;
      const into = (p: P): P => t.side === 'L' ? [circ ? circ.x : bs.x, p[1]] : [p[0], circ ? circ.y + circ.h : bs.y + bs.h];
      const W2 = circ ? over : wires; W2.push(line([t.p, into(t.p)], col, 'in' + f)); W2.push(line([t.q, into(t.q)], col, 'iq' + f));
      const fl = flowOf(f), cp = fl ? (fl.source === 'bank' ? fl.target : fl.source) : ''; flowDots([t.p, into(t.p)], f, cp, col, 'in' + f); flowDots([t.q, into(t.q)], f, cp, col, 'iq' + f, true);
    }
    // the interbank bus enters on the bank's right edge and runs underneath the other blocks into Operations
    { const t = terminal(map, g, o, 'bank', 'loan_interest'), x = t.p[0] + 120, bot = circ ? circ.y + circ.h : bs.y + bs.h;
      const v = -norm('Ledger:cf_ib_loans'), p1 = [[B.x + B.w, ibY], [x, ibY], [x, bot]], p2 = [[B.x + B.w, ibY + LANE], [x - LANE, ibY + LANE], [x - LANE, bot]];
      wires.push(line(p1, IB, 'in-ib')); wires.push(line(p2, IB, 'iq-ib'));
      dots.push({ key: 'in-ib', pts: p1, v, color: IB }, { key: 'iq-ib', pts: p2, v: -v, color: IB });
      // the interest pair into Treasury: Treasury reads the risk-free curve there and builds its funding cost (FTP) per
      // maturity; with Treasury open the curve goes on to the ALM desk as a signal
      const T2 = g.inner.t, xi = T2 ? T2.desk.x + T2.desk.w - 40 : tre.x + tre.w - 60, tb = tre.y + tre.h, vi = -norm('Ledger:ib_interest');
      const q1 = [[B.x + B.w, ibY2], [xi, ibY2], [xi, tb]], q2 = [[B.x + B.w, ibY2 + LANE], [xi - LANE, ibY2 + LANE], [xi - LANE, tb]];
      wires.push(line(q1, IB, 'in-ibi')); wires.push(line(q2, IB, 'iq-ibi'));
      dots.push({ key: 'in-ibi', pts: q1, v: vi, color: IB }, { key: 'iq-ibi', pts: q2, v: -vi, color: IB });
      if (T2) over.push(arrow([[xi - LANE / 2, tb], [xi - LANE / 2, T2.desk.y + T2.desk.h]], SIG, 'sig-rfr', 'risk-free curve → FTP per maturity', 0.5)); }
    const ceo: P = [B.x + B.w / 2, B.y + HEAD + 18], tv = (k: string) => readTrace(result, k)?.[at];
    const appetite = `risk appetite: Tier 1 ${tv('Bank_target_t1')?.toFixed(1) ?? '–'}% · NSFR ${tv('Bank_target_nsfr')?.toFixed(0) ?? '–'}%`;
    // CEO -> Banking Operations: a lending-volume target, not in the model yet, so 0 (named, to be connected later)
    { const ox = bs.x + bs.w - 70, yS = ceo[1] + 26;
      over.push(arrow([[ceo[0] - 40, ceo[1]], [ceo[0] - 60, ceo[1]], [ceo[0] - 60, yS], [ox, yS], [ox, bs.y]], SIG, 'sig-ceo-ops', 'lending volume target · 0 (not modelled)', 0.5)); }
    let parts: ReactNode = null;
    if (!T) {
      // Treasury closed: its signals at the division's edge (CEO in, Operations' stocks and flows in, the rates u out)
      over.push(arrow([[ceo[0] + 40, ceo[1]], [tre.x + tre.w / 2, ceo[1]], [tre.x + tre.w / 2, tre.y]], SIG, 'sig-ceo-alco', appetite, 0.5));
      const yx = tre.y + 60; wires.push(arrow([[bs.x + bs.w, yx], [tre.x, yx]], G, 'x', 'stocks · flows', 0.5));
      ['u₁ mortgage rate', 'u₂ savings rate', 'u₃ firm-loan rate'].forEach((name, i) => { const y = tre.y + 120 + 40 * i; over.push(arrow([[tre.x, y], [circ ? circ.x + circ.w : bs.x + bs.w, y]], PU, 'u' + i, name, 0.5)); });
    } else {
      const { acc, alco, sum, desk: dk, sub, accF, almF } = T;
      over.push(arrow([[ceo[0] + 40, ceo[1]], [alco.x + alco.w / 2, ceo[1]], [alco.x + alco.w / 2, alco.y]], SIG, 'sig-ceo-alco', appetite, 0.5));
      // the breadboard's stocks and flows are read by Accounting; Accounting reports y to Σ
      { const ya = sub ? acc.y + HEAD + 30 : acc.y + 55;
        if (sub) {
          // stocks -> balance sheet, rates and flows -> income statement, the home value (LTV, DNB mortgage risk weight) -> metrics
          over.push(arrow([[bs.x + bs.w, ya], [sub.bal.x + 40, ya], [sub.bal.x + 40, sub.bal.y]], G, 'x', 'stocks', 0));
          const yf = acc.y + HEAD + 44; over.push(arrow([[bs.x + bs.w, yf], [sub.inc.x + 40, yf], [sub.inc.x + 40, sub.inc.y]], G, 'xf', 'rates · flows', 0));
          const yl = acc.y + acc.h + 26, ys = bs.y + bs.h - 20, kx = sub.key.x + sub.key.w / 2, xg = acc.x - 40;
          over.push(arrow([[bs.x + bs.w, ys], [xg, ys], [xg, yl], [kx, yl], [kx, sub.key.y + sub.key.h]], G, 'xl', 'home value (LTV)', 0.62));
        }
        else wires.push(arrow([[bs.x + bs.w, ya], [acc.x, ya]], G, 'x', 'stocks · flows', 0.5)); }
      { const k = sub?.key, yy = k ? k.y + Math.min(k.h / 2, 45) : acc.y + 55, xm = alco.x - 45;
        (k ? over : wires).push(arrow([[k ? k.x + k.w : acc.x + acc.w, yy], [xm, yy], [xm, sum[1]], [sum[0] - 17, sum[1]]], G, 'y', 'y₁ Tier 1 · y₂ NSFR', 0.15)); }
      // inside Accounting: retained profit into equity on the balance sheet, balance-sheet items and net profit into the metrics
      if (sub) {
        const { inc, cf, bal, key } = sub;
        { const yi = inc.y + inc.h - 16, xl = inc.x - 22, yc = cf.y + 30, ym = (yi + yc) / 2;
          over.push(arrow([[inc.x, yi], [xl, yi], [xl, yc], [cf.x, yc]], G, 's-cfnp'));
          over.push(<text key="s-cfnp-t" className="bus-label" fill={G} textAnchor="middle" transform={`translate(${xl - 6} ${ym}) rotate(-90)`}>net profit</text>); }
        { const xb = bal.x + 40, yc = cf.y + 46; over.push(arrow([[xb, bal.y + bal.h], [xb, yc], [cf.x + cf.w, yc]], G, 's-cfst', 'changes in stocks', 0.5)); }
        { const ey = inc.y + 60, mx = bal.x - 50; over.push(arrow([[inc.x + inc.w, ey], [mx, ey], [mx, bal.y + 60], [bal.x, bal.y + 60]], G, 's-ret', 'retained profit → equity', 0)); }
        const items = KEY_INPUTS.filter(([id]) => id !== 'net_profit');
        if (o.bal && o.key) items.forEach(([id, name], i) => { const y = bal.y + HEAD + 24 + i * 30; over.push(arrow([[bal.x + bal.w, y], [key.x, y]], G, 's-' + id, name)); });
        else over.push(arrow([[bal.x + bal.w, bal.y + HEAD + 10], [key.x, bal.y + HEAD + 10]], G, 's-items', 'balance-sheet items'));
        { const x1 = inc.x + inc.w - 40, ly = inc.y - 16, kx = key.x - 14, ky = key.y + key.h - 10;
          over.push(arrow([[x1, inc.y], [x1, ly], [kx, ly], [kx, ky], [key.x, ky]], G, 's-np', 'net profit', 0.3)); }
      }
      wires.push(arrow([[sum[0], alco.y + alco.h], [sum[0], sum[1] - 17]], SIG, 'r', 'r₁, r₂'));
      const dt = (q: P): P => { const k = (dk.w - 16) / DESK_VB[0]; return [dk.x + 8 + q[0] * k, dk.y + HEAD + 6 + q[1] * k]; };
      if (o.desk) {
        const [e2, e1] = [dt(DESK_T.e2), dt(DESK_T.e1)], ly = dk.y - 28;
        over.push(arrow([[sum[0], sum[1] + 17], [sum[0], ly], [dk.x - 30, ly], [dk.x - 30, e2[1]], e2], SIG, 'e2', 'e₂ NSFR', 0.6));
        over.push(arrow([[dk.x - 30, e2[1]], [dk.x - 30, e1[1]], e1], SIG, 'e1', 'e₁ Tier 1', 0.5));
      } else wires.push(arrow([[sum[0], sum[1] + 17], [sum[0], dk.y]], SIG, 'e', 'e₁, e₂'));
      // u: the desk's rates into the bank's rate sources (B§Mortgage_rate_ALM and B2 on the breadboard)
      const el = (name: string): P | null => { const e = map.elements.find(x => x.agent === 'bank' && x.name === name); if (!circ || !e?.pins) return null;
        const cx = e.pins.reduce((s, p) => s + p[0], 0) / e.pins.length, cy = e.pins.reduce((s, p) => s + p[1], 0) / e.pins.length; return [circ.x + cx * g.cs, circ.y + cy * g.cs]; };
      // three rates by maturity (Jesse): u1 mortgages (30-year point), u2 savings (overnight), u3 firm loans (10-year point, into B5)
      const uT = [el('B§Mortgage_rate_ALM') ?? [bs.x + bs.w, bs.y + bs.h - 110] as P, el('B2') ?? [bs.x + bs.w, bs.y + bs.h - 60] as P, el('B5') ?? [bs.x + bs.w, bs.y + bs.h - 15] as P];
      ['u₁ mortgage rate', 'u₂ savings rate', 'u₃ firm-loan rate'].forEach((name, i) => {
        const uy = dk.y + 45 + 30 * i, mx = acc.x + acc.w + 40 + 25 * i, t = uT[i], top = Math.min(bs.y, acc.y) - 20 - 18 * i, dx = bs.x + bs.w + 40 + 20 * i;
        const head: number[][] = o.desk ? (() => { const u = dt(i === 2 ? DESK_T.u3 : i ? DESK_T.u2 : DESK_T.u1), rx = dk.x + dk.w + 30 + 22 * i; return [u, [rx, u[1]], [rx, top]]; })() : [[dk.x, uy], [mx, uy], [mx, top]];
        const straight = !circ && !sub && !o.desk && uy > bs.y + HEAD && uy < bs.y + bs.h;
        const yt = accF.y + accF.h + 30 + 25 * i, mx2 = acc.x + acc.w + 60 + 25 * i;
        // both divisions open (Jesse, 26 Nov 2026): below Accounting and the desk, across to the gap between the divisions,
        // then up into the rate source (no lines over the Treasury header or the Accounting label)
        const yb = Math.max(accF.y + accF.h, dk.y + dk.h) + 30 + 22 * i, colX = ops.x + ops.w + 55 + 26 * i, tgt: P = circ ? t : [bs.x + bs.w, bs.y + bs.h - 110 + 50 * i];
        const out = o.desk ? [head[0], head[1], [head[1][0], yb]] : [[dk.x, uy], [dk.x - 30 - 22 * i, uy], [dk.x - 30 - 22 * i, yb]];
        const yc2 = circ ? circ.y - 4 - 12 * i : 0;  // just above the circuit, inside Operations
        const both = circ ? [...out, [colX, yb], [colX, yc2], [tgt[0], yc2], [tgt[0], tgt[1] - 22]] : [...out, [colX, yb], [colX, tgt[1]], tgt];
        const pts = !opsOpen ? (o.desk ? [head[0], head[1], [head[1][0], yt], [ops.x + ops.w, yt]] : [[dk.x, uy], [mx2, uy], [mx2, yt], [ops.x + ops.w, yt]]) : both;
        over.push(arrow(pts, PU, 'u' + i, name, 0.5));
      });
      const frame = (r: R, label: string) => <div key={label} className="bus-org-frame unit" style={{ left: r.x, top: r.y, width: r.w, height: r.h }}><span>{label}</span></div>;
      parts = <>
        {frame(accF, 'Accounting & Reporting')}{frame(almF, 'ALM')}
        <Block r={acc} label="Accounting" tone="bank-l2" open={o.acc} toggle={() => set('acc')} z={1} info="3 statements · metrics"/>
        {sub && STMT.map(([k, label, gid]) => <Block key={k} r={sub[k]} label={label} tone="bank-l3 bus-stmt" open={o[k]} toggle={() => set(k)} z={o[k] ? 5 : 3} info={tileValue(k)}>  {/* open: above the wires, so a dragged plot card stays on top */}
          {o[k] && <FitBody k={k} onH={fitH} style={{ position: 'absolute', left: 6, right: 6, top: HEAD + 4, bottom: 6 }}>
            <AtContext.Provider value={{ result, at }}><BankStatements only={gid}/></AtContext.Provider></FitBody>}
          {o[k] && <div className="bus-grip nodrag nopan" role="separator" aria-label={`Resize ${label}`} title="Drag to make the box bigger or smaller (double-click: original size)"
            onDoubleClick={e => { e.stopPropagation(); resize(k, null); }}
            onPointerDown={e => { e.stopPropagation(); e.preventDefault(); const el = e.currentTarget, z = rf.getZoom(), x0 = e.clientX, y0 = e.clientY, s0 = sub[k]; el.setPointerCapture(e.pointerId);
              const move = (ev: PointerEvent) => resize(k, [Math.max(240, s0.w + (ev.clientX - x0) / z), Math.max(HEAD + 120, s0.h + (ev.clientY - y0) / z)]);
              const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); };
              el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); }}/>}
        </Block>)}
        <Block r={alco} label="ALCO" tone="bank-l2" info="targets: Tier 1 · NSFR"/>
        <div className="map-node summing" style={{ position: 'absolute', left: sum[0] - 17, top: sum[1] - 17, width: 34, height: 34, zIndex: 2 }}/>
        <Block r={dk} label="ALM Desk" tone="bank-l2" open={o.desk} toggle={() => set('desk')} info="PI on FTP · PI on spread">
          {o.desk && <div className="bus-breadboard" style={{ position: 'absolute', left: 8, right: 8, top: HEAD + 6, bottom: 8 }}><AtContext.Provider value={{ result, at }}>{desk}</AtContext.Provider></div>}
        </Block>
      </>;
    }
    // the sub-units of Banking Operations tag their ports (classic back-office units: loans, deposits, payments)
    // Banking Operations' sub-units (classic back-office units; the full org chart is still to be decided with M. Mendel)
    if (opsOpen) over.push(<text key="tg" x={ops.x + 16} y={ops.y + HEAD + 22} className="bus-unit-tag">loan operations · deposit operations · payments & settlement</text>);
    inside = <>
      <div className="bus-ceo" style={{ left: ceo[0] - 40, top: ceo[1] - 12, width: 80 }}>CEO</div>
      <Block r={ops} label="Banking Operations" tone="bank-l1" open={opsOpen} toggle={() => set('bops')} z={opsOpen ? 0 : 1} info="loan · deposit · payment operations"/>
      {opsOpen && <Block r={bs} label="Operations" tone="bank-l2" open={o.bs} toggle={() => set('bs')} z={1} info="mortgages · firm loans · savings">
        {o.bs && circ && <div className="bus-circuit" style={{ position: 'absolute', left: circ.x - bs.x, top: circ.y - bs.y, width: circ.w, height: circ.h }}><AgentCircuit map={map} agent="bank" scenario={scenario} selection={NONE} pick={() => {}} outside/></div>}
      </Block>}
      <Block r={tre} label="Treasury" tone="bank-l1" open={treOpen} toggle={() => set('tre')} z={treOpen ? 0 : 1} info="Accounting & Reporting · ALCO · ALM Desk"/>
      {parts}
    </>;
  }
  const sotR: R = { x: fs.x + fs.w + 130, y: fs.y, w: 460, h: 800 };  // the SOT card right of the Financial sector
  const W = (sot ? sotR.x + sotR.w : fs.x + fs.w) + 120, H = Math.max(fs.y + fs.h, R.hm.y + R.hm.h, B.y + B.h, comp.y + comp.h, sot ? sotR.y + sotR.h : 0) + 140;  // (y from 0: the Government sits above the Housing Market)
  // the card of a clicked flow, return, bus or shock
  let card: ReactNode = null;
  if (pick) {
    const series = (signal: string) => readTrace(result, signal);
    const rows: { label: string; unit: string; y?: number[]; min?: number }[] = [];
    let title = '', note = '';
    if (pick.kind === 'flow' || pick.kind === 'ret') {
      const f = flowOf(pick.id); title = f?.label ?? pick.id; note = f?.description ?? '';
      // f (the flow line, or the f circle) shows the flow; e (the return line, or the e circle) the effort (Jesse)
      if (f && pick.kind === 'flow') rows.push({ label: 'f · flow', unit: f.unit, y: series(f.signal) });
      if (f?.port && pick.kind === 'ret') rows.push({ label: 'e · incentive at the port', unit: 'model units', y: series(`V(${f.port.node.toLowerCase()},${f.port.ret.toLowerCase()})`) });
    } else if (pick.kind === 'bus') {
      const b = BUSES.find(x => x.id === pick.id)!; title = b.label; note = 'One quantity on this bus: every flow below is in the same unit.';
      b.flows.forEach(id => { const f = flowOf(id); if (f) rows.push({ label: f.label, unit: f.unit, y: series(f.signal) }); });
    } else if (pick.kind === 'ibf' || pick.kind === 'ibe') {
      const A = result.ledger?.accounts ?? {}, row = (id: string) => { if (A[id]) rows.push({ label: A[id].label, unit: A[id].unit, y: series('Ledger:' + id) }); };
      if (pick.id === 'loans') { title = 'Interbank loans'; note = 'Net borrowing from the financial sector: deposits of other banks + central-bank borrowing − reserves.'; row(pick.kind === 'ibf' ? 'cf_ib_loans' : 'ib_loan_rate'); }
      else { title = 'Interbank interest'; note = pick.kind === 'ibf' ? 'Net interest paid to the financial sector.' : 'The risk-free curve the financial sector sets: Treasury reads it here and prices each product at its maturity.';
        if (pick.kind === 'ibf') row('ib_interest'); else ['rfr_short', 'rfr_10', 'rfr_30'].forEach(row); }
    } else if (pick.kind === 'shock' && sotRep) {
      title = 'Rate shock: ' + sotName; note = `Change of the zero rate per maturity (EU RTS 2024/856 sizes), a step in ${(result.year[0] + 3).toFixed(0)}. It moves the risk-free curve of the Financial sector; My Bank sees it only through the interbank port, where Treasury prices savings at the short end, firm loans at 10 years and mortgages at 30 years.`;
    } else if (pick.kind === 'comp') {
      title = 'Competitor bank'; note = 'Sharper mortgage rates, funded more by other banks, a thinner buffer (M. Mendel; values not calibrated).';
      ([['Tier 1 capital ratio', 'I(Bk_t1c)'], ['Market share of mortgages', 'I(Bk_sharec)'], ['NSFR', 'I(Bk_nsfrc)'], ['Mortgage rate', 'I(Bk_rmc)']] as const).forEach(([l, k]) => rows.push({ label: l, unit: '%', y: series(k), min: k === 'I(Bk_t1c)' ? 6 : undefined }));
    } else {
      const d = map.disturbances.find(x => x.id === pick.id); title = d?.label ?? pick.id;
      if (d) rows.push({ label: 'd · shock', unit: d.unit, y: series(d.signal) });
    }
    card = <div className="bus-pick nodrag nowheel" style={{ left: pick.at[0] + 14, top: pick.at[1] + 14 }} onClick={e => e.stopPropagation()}>
      <div className="bus-pick-head"><b>{title}</b><button className="ghost small" aria-label="Close" onClick={() => setPick(null)}>×</button></div>
      {note && <small>{note}</small>}
      {pick.kind === 'shock' && sotRep && (() => { const dz = sotRep.curves[pick.id].map((z, i) => z - sotRep.curves.base[i]), m = sotRep.maturities, W2 = 330, H2 = 120, lo = Math.min(-3.5, ...dz), hi = Math.max(3.5, ...dz);
        const sx = (T: number) => 30 + T / 30 * (W2 - 40), sy = (v: number) => 8 + (hi - v) / (hi - lo) * (H2 - 30);
        return <svg width={W2} height={H2} role="img" aria-label="Rate shock per maturity"><line x1={30} x2={W2 - 10} y1={sy(0)} y2={sy(0)} stroke="#c9cfd8"/>
          <polyline points={m.map((T, i) => `${sx(T)},${sy(dz[i])}`).join(' ')} fill="none" stroke={SOT_RED} strokeWidth={2}/>
          {[lo, 0, hi].map(v => <text key={v} x={26} y={sy(v) + 3} textAnchor="end" className="mini-tick">{v > 0 ? '+' : ''}{v.toFixed(1)} pp</text>)}
          {[0, 10, 20, 30].map(T => <text key={T} x={sx(T)} y={H2 - 6} textAnchor="middle" className="mini-tick">{T} yr</text>)}</svg>; })()}
      {rows.map(r => <div key={r.label}><div className="bus-pick-row">{r.label}</div>{r.y ? <StmtPlot y={r.y} at={at} years={result.year} unit={r.unit} label={r.label} min={r.min}/> : <small className="muted">Not in this run.</small>}</div>)}
    </div>;
  }
  const agent = (id: string) => <Block key={id} r={R[id]} label={map.agents[id]?.label ?? id} tone="agent" open={o[id]} toggle={() => set(id)} info={`${Object.keys(map.layouts[id]?.ports ?? {}).length} port pairs`}>
    {o[id] && <div className="bus-circuit" style={{ position: 'absolute', left: 0, top: HEAD, width: R[id].w, height: R[id].h - HEAD }}>
      <AgentCircuit map={map} agent={id} scenario={scenario} selection={NONE} pick={() => {}} outside={id !== 'firms'} inputs={id === 'firms' ? firmIns : []}/></div>}
  </Block>;
  return <div className="bus-diagram nodrag" style={{ width: W, height: H }} onClick={() => setPick(null)}>
    <svg width={W} height={H} className="bus-wires">{wires}</svg>
    <Block r={R.hm} label="Housing Market" tone={o.hm ? 'system-group' : 'system-closed'} open={o.hm} toggle={() => set('hm')} z={0} info="4 agents · 6 buses"/>
    {o.hm && CPB4.map(agent)}
    <Block r={R.gov} label="Government" tone="reference" info="owner-occupier subsidy (d)"/>
    <Block r={fs} label="Financial sector" tone={o.fs ? 'fin-group' : 'fin-closed'} open={o.fs} toggle={() => set('fs')} z={0} info="Other banks · Central bank"/>
    {o.fs && <><Block r={ob} label="Other banks" tone="fin-closed" info="deposits with the bank · premium"/><Block r={cbk} label="Central bank" tone="fin-closed" info="reserves · lending at rate + 1 pp"/>
      <div className="bus-fs-note" style={{ left: fs.x + 20, top: cbk.y + cbk.h + 18, width: fs.w - 40 }}>risk-free curve: set outside the model (ECB AAA); it reaches the banks on the interbank bus</div>
      <YieldCurve r={yc} result={result} at={at}
        shock={sotName && sotRep ? { m: sotRep.maturities, dz: sotRep.curves[sot].map((z, i) => z - sotRep.curves.base[i]), name: sotName, after: result.year[at] >= result.year[0] + 3 } : undefined}/></>}
    {sotName && sotRep && <SotCard r={sotR} rep={sotRep} sel={sot} pick={setSot}/>}
    {/* the competitor: a bank like My Bank; open (+) it shows its own statements (Jesse) */}
    <Block r={comp} label="Competitor bank" tone={'bank-closed bus-comp' + (compOn ? '' : ' off') + (o.comp ? ' open' : '')} z={2} open={o.comp} toggle={compOn ? () => set('comp') : undefined}>
      {o.comp && compOn && result.ledger_comp && (() => { const box = (gid: string, label: string, x: number, y: number, w: number, h: number) =>
        <div key={gid} className="map-node bank-l3 bus-stmt open comp-stmt" style={{ position: 'absolute', left: x, top: y, width: w, height: h }}>
          <div className="block-head"><strong>{label}</strong></div>
          <div className="bus-stmt-body nowheel" style={{ position: 'absolute', left: 6, right: 6, top: HEAD + 4, bottom: 6, overflow: 'auto' }}>
            <AtContext.Provider value={{ result, at }}><BankStatements only={gid} comp/></AtContext.Provider></div></div>;
        return <>{box('income', 'Income statement', 20, HEAD + 20, 380, HEAD + 330)}{box('ratios', 'Metrics', 20, HEAD + 20 + HEAD + 330 + 20, 380, HEAD + 300)}{box('balance', 'Balance sheet', 430, HEAD + 20, 580, HEAD + 330)}</>; })()}
    </Block>
    <BankCurve r={{ x: B.x - 20, y: B.y - 330, w: 300, h: 210 }} result={result} at={at}
      shockIdx={sot ? Math.max(0, result.year.findIndex(y => y >= result.year[0] + 3) - 1) : null}/>
    <Block r={B} label="My Bank" tone={o.bank ? 'bank-group' : 'bank-closed'} open={o.bank} toggle={() => set('bank')} z={0} info="Treasury · Operations"/>
    {inside}
    <DotLayer W={W} H={H} paths={dots} playing={playing}/>
    <svg width={W} height={H} className="bus-wires bus-over">{over}</svg>
    {card}
  </div>;
}

const nodeTypes = { diagram: Diagram };

type ShockProps = { crisisOn: boolean; shock: number; setShock: (k: number) => void; alm: boolean; setAlm: (v: boolean) => void; story: number; setStory: (k: number) => void };
const STORY = ['', 'Covid (2020) and the 2008 financial crisis hit the economy. Press Play: My Bank\'s ALM desk keeps its Tier 1 and NSFR on target.',
  'The same shocks with a competitor: 0.3 pp sharper on mortgages and steering to a thin 8% Tier 1 with its own desk. It wins market share, and in the crisis it passes the cost on to its borrowers.',
  'Supervisory Outlier Test, without Covid or the crisis: a regulatory rate shock enters the market rates. Compare My Bank\'s rates with the market curve, and the change in value (ΔEVE) and income (ΔNII) per scenario.'];
function Inner({ result, desk, patch, toolsSlot, crisisOn, shock, setShock, alm, setAlm, story, setStory }: { result: Result; desk: ReactNode; patch: (m: MapData) => MapData; toolsSlot?: HTMLElement | null } & ShockProps) {
  const n = result.year.length;
  const [buses, setBuses] = useState(true);
  // Supervisory Outlier Test: '' = no rate shock; a scenario id shows it on the canvas (report fetched once)
  // the rate shock is a scenario input (Bank.tsx: shock_scen): choosing one runs the whole bank netlist with it
  const sot = shock > 0 ? SOT_SC[shock - 1] : '', [sotRep, setSotRep] = useState<SotReport | null>(null);
  const setSot = useCallback((s: string) => { setShock(s ? SOT_SC.indexOf(s) + 1 : 0); if (s) setO(old => old.fs ? old : { ...old, fs: true }); }, [setShock]);
  useEffect(() => { if (sot && !sotRep) api<SotReport>('/bank/sot').then(setSotRep).catch(() => {}); }, [sot, sotRep]);  // buses on by default (M. Mendel, 26 Nov 2026)
  const [sizes, setSizes] = useState<Record<string, P>>({}), playRef = useRef(false);
  // A1: no layout change while Play runs (a measured height is a 'fit:' size; dragged sizes come from the user)
  const resize = useCallback((k: string, s: P | null) => { if (playRef.current && k.startsWith('fit:')) return; setSizes(old => { const n = { ...old }; if (s) n[k] = s; else delete n[k]; return n; }); }, []);  // Ports (default): the port pairs wired directly; Buses: one bus per conserved quantity
  const [at, setAt] = useState(n - 1), [playing, setPlaying] = useState(false), [o, setO] = useState<Open>({});
  playRef.current = playing;
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
    if (k === 'bank' && !next.bank) for (const x of ['bops', 'tre', 'bs', 'acc', 'desk', ...subs]) next[x] = false;
    if (k === 'bops' && !next.bops) next.bs = false;
    if (k === 'tre' && !next.tre) for (const x of ['acc', 'desk', ...subs]) next[x] = false;
    if (k === 'hm' && !next.hm) for (const x of CPB4) next[x] = false;
    if (k === 'acc' && !next.acc) for (const x of subs) next[x] = false;
    if (!map) return next;
    const g = geometry(next, map, sizes), byId: Record<string, R | undefined> = { ...g.R, ...g.inner?.t?.sub, bops: g.inner?.ops, tre: g.inner?.tre, bs: g.inner?.bs, acc: g.inner?.t?.acc, desk: g.inner?.t?.desk };
    const target = next[k] ? byId[k] : subs.includes(k) ? byId.acc : (k === 'bs') ? g.inner?.ops : (k === 'acc' || k === 'desk') ? g.inner?.tre : (k === 'bops' || k === 'tre') ? g.R.bank : undefined;
    if (k === 'acc' || k === 'fs' || subs.includes(k)) return next;  // Accounting and its statements open in place, no zoom (Jesse)
    window.setTimeout(() => { if (target) rf.fitBounds({ x: target.x - 40, y: target.y - 40, width: target.w + 80, height: target.h + 80 }, { duration: 450 }); else rf.fitView({ duration: 450, padding: 0.04 }); }, 40);
    return next;
  }), [rf, map, sizes]);
  const nodes = useMemo<Node[]>(() => map ? [{ id: 'd', type: 'diagram', position: { x: 0, y: 0 }, draggable: false, selectable: false, focusable: false, style: { pointerEvents: 'all' },
    data: { result, o, set, map, scenario, desk, buses, sizes, resize, crisisOn, sot, sotRep, setSot } }] : [], [result, o, set, map, scenario, desk, buses, sizes, resize, crisisOn, sot, sotRep, setSot]);
  const tick = useMemo(() => ({ at: Math.min(at, n - 1), playing }), [at, n, playing]);
  // a story step opens the blocks it is about and fits the view
  useEffect(() => { if (!story) return;
    setO(story === 1 ? { bank: true, tre: true, acc: true, bal: true, key: true } : story === 2 ? { comp: true } : { fs: true });
    const id = window.setTimeout(() => rf.fitView({ duration: 500, padding: 0.04 }), 700); return () => window.clearTimeout(id); }, [story, rf]);
  const tools = <div className="bus-time">
      <div className="segmented small story-steps" role="group" aria-label="Story">{[1, 2, 3].map(k => <button key={k} className={story === k ? 'active' : ''} aria-pressed={story === k} onClick={() => setStory(k)}>{k} {['', 'Crises', 'Competitor', 'SOT'][k]}</button>)}</div>
      <button className="ghost" aria-label={playing ? 'Pause' : 'Play through time'} onClick={() => { if (at >= n - 1) setAt(0); setPlaying(p => !p); }}>{playing ? <Pause size={14}/> : <Play size={14}/>}</button>
      <span>{result.year[Math.min(at, n - 1)].toFixed(1)}</span>
      <input type="range" min={0} max={n - 1} value={Math.min(at, n - 1)} onChange={e => { setPlaying(false); setAt(+e.target.value); }}/>
      <div className="segmented small" role="group" aria-label="Connections"><button className={!buses ? 'active' : ''} aria-pressed={!buses} onClick={() => setBuses(false)}>Ports</button><button className={buses ? 'active' : ''} aria-pressed={buses} onClick={() => setBuses(true)}>Buses</button></div>
      <div className="segmented small" role="group" aria-label="ALM desk"><button className={alm ? 'active' : ''} aria-pressed={alm} onClick={() => setAlm(true)}>Desk on</button><button className={!alm ? 'active' : ''} aria-pressed={!alm} onClick={() => setAlm(false)}>Desk off</button></div>
      <label className="sot-pick">Rate shock (SOT) <select aria-label="Rate shock (SOT)" value={sot} onChange={e => setSot(e.target.value)}>
        <option value="">none</option>{SOT_SC.map(sc => <option key={sc} value={sc}>{sc.replace('_', ' ').replace(/^./, c => c.toUpperCase())}</option>)}</select></label>
      <button className="ghost small" onClick={() => { setO({}); window.setTimeout(() => rf.fitView({ duration: 450, padding: 0.04 }), 40); }}>Close all</button>
    </div>;
  return <>
    {toolsSlot ? createPortal(tools, toolsSlot) : tools}
    <div className="bus-canvas">{story > 0 && <div className="story-caption"><b>Step {story}.</b> {STORY[story]}</div>}{map ? <Tick.Provider value={tick}><ReactFlow nodes={nodes} edges={[]} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.04 }} minZoom={0.05} maxZoom={4} proOptions={{ hideAttribution: true }} nodesDraggable={false}><Controls showInteractive={false}/></ReactFlow></Tick.Provider> : <p className="muted">Loading the model…</p>}</div>
  </>;
}

export function BankBusView({ result, desk, patch, toolsSlot, ...sp }: { result: Result; desk: ReactNode; patch: (m: MapData) => MapData; toolsSlot?: HTMLElement | null } & ShockProps) {
  return <section className="panel bus-view"><ReactFlowProvider><Inner result={result} desk={desk} patch={patch} toolsSlot={toolsSlot} {...sp}/></ReactFlowProvider></section>;
}
