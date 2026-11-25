// Bank controls, bus view (25 Nov 2026): the same model as the control-loop view (the same agents, the same
// breadboards drawn by AgentCircuit, the same block styles), arranged around buses with the bank in the middle
// (Jesse and his supervisor). Every bus branch ends on the real terminal of its flow: the port and the return point
// from the netlist layout when the agent is open, the matching side of the tile when it is closed (as in the
// control-loop view). Top level: names only. Bank level 1: Bank circuit, Accounting, ALCO, ALM Desk; level 2:
// the bank's breadboard (process), its financial statements (sensor), or the desk's op-amp breadboard. Numbers only in the accounts (Jesse).
// Bus structure after Q. Emanuels' DynaBI bus canvas: one bus per kind of exchange, two rails each (flow f, incentive
// u); here the rails carry each flow's port and return terminal. Values come from the same ngspice run.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ReactFlow, ReactFlowProvider, Controls, useReactFlow, type Node, type NodeProps } from '@xyflow/react';
import { Minus, Pause, Play, Plus } from 'lucide-react';
import { api } from './api';
import { AtContext } from './ModelMap';
import { AgentCircuit, inputPath } from './Schematic';
import { BankStatements, KEY_INPUTS } from './BankStatements';
import type { MapData, Result, Scenario, Selection } from './types';

type R = { x: number; y: number; w: number; h: number };
type P = [number, number];
type Open = Record<string, boolean>;
type Side = 'L' | 'R' | 'T' | 'B';
const LANE = 12, HEAD = 34, S = 0.5, TILE: P = [230, 96];
const NONE: Selection = { kind: 'none', id: '' };
// the statement boxes inside Accounting: ledger group and opened size
const STMT: [string, string, string][] = [['inc', 'Income statement', 'income'], ['eq', 'Equity statement', 'equity'], ['bal', 'Balance sheet', 'balance'], ['key', 'Key figures', 'ratios']];
const STMT_OPEN: Record<string, P> = { inc: [380, HEAD + 330], eq: [380, HEAD + 190], bal: [500, HEAD + 300], key: [380, HEAD + 270] };
const BUSES = [
  { id: 'construction', label: 'Construction bus', color: '#8a6d3b', a: 'constructors', b: 'investors', flows: ['construction_cost', 'houses'] },
  { id: 'housing', label: 'Housing-services bus', color: '#b9770e', a: 'investors', b: 'households', flows: ['rental_services', 'owner_services', 'rent', 'imputed_rent'] },
  { id: 'goods', label: 'Goods and labour bus', color: '#7a5aa6', a: 'firms', b: 'households', flows: ['consumption', 'income', 'goods'] },
  { id: 'mortgage', label: 'Mortgage bus', color: '#b9851c', a: 'investors', b: 'bank', flows: ['mortgages', 'mortgage_interest'] },
  { id: 'deposit', label: 'Deposit bus', color: '#1f6fc4', a: 'households', b: 'bank', flows: ['savings', 'savings_interest'] },
  { id: 'firm', label: 'Firm-credit bus', color: '#2e7d32', a: 'firms', b: 'bank', flows: ['loans', 'loan_interest'] },
] as const;

type Geo = ReturnType<typeof geometry>;
function geometry(o: Open, map: MapData) {
  const size = (id: string) => map.layouts[id].size as P;
  const box = (id: string): P => o[id] ? [size(id)[0] * S, size(id)[1] * S + HEAD] : TILE;
  const [cw, ch] = box('constructors'), [fw, fh] = box('firms'), [iw, ih] = box('investors'), [hw, hh] = box('households');
  const c1 = 40, w1 = Math.max(cw, fw), c2 = c1 + w1 + 240, w2 = Math.max(iw, hw);
  const top = 120, row2 = top + Math.max(ch, ih) + 230;
  const R: Record<string, R> = {
    constructors: { x: c1 + w1 - cw, y: top, w: cw, h: ch }, investors: { x: c2, y: top, w: iw, h: ih },
    firms: { x: c1 + w1 - fw, y: row2, w: fw, h: fh }, households: { x: c2, y: row2, w: hw, h: hh },
  };
  // the bank: closed tile, or level 1/2 with Accounting (bank breadboard + statements), ALCO, Σ and ALM Desk
  const bx = c2 + w2 + 330, by = top;
  const [bw0, bh0] = size('bank'), cs = 0.9, circ: P = [bw0 * cs, bh0 * cs];
  let inner: null | { bs: R; acc: R; circ: R | null; sub: Record<string, R> | null; alco: R; sum: P; desk: R } = null;
  if (o.bank) {
    // Bank circuit = the bank's breadboard (process); Accounting = the financial statements (sensor)
    const bs: R = o.bs ? { x: bx + 140, y: by + 90, w: circ[0] + 20, h: HEAD + circ[1] + 20 } : { x: bx + 140, y: by + 90, w: 280, h: 420 };
    // Accounting holds one box per statement, each closed until its + is clicked
    let acc: R = { x: bs.x + bs.w + 150, y: by + 90, w: 230, h: 110 }, sub: Record<string, R> | null = null;
    if (o.acc) {
      const sz = (k: string): P => o[k] ? STMT_OPEN[k] : [210, 72], x0 = acc.x + 20, y0 = acc.y + HEAD + 70;
      const inc: R = { x: x0, y: y0, w: sz('inc')[0], h: sz('inc')[1] }, eq: R = { x: x0, y: inc.y + inc.h + 70, w: sz('eq')[0], h: sz('eq')[1] };
      const bal: R = { x: x0 + Math.max(inc.w, eq.w) + 120, y: y0, w: sz('bal')[0], h: sz('bal')[1] };
      const key: R = { x: bal.x + bal.w + 170, y: y0, w: sz('key')[0], h: sz('key')[1] };
      sub = { inc, eq, bal, key };
      acc = { ...acc, w: key.x + key.w + 30 - acc.x, h: Math.max(eq.y + eq.h, bal.y + bal.h, key.y + key.h) + 30 - acc.y };
    }
    const c = acc.x + acc.w + 200, alco: R = { x: c, y: by + 90, w: 230, h: 90 }, sum: P = [c + 115, alco.y + alco.h + 90];
    const desk: R = o.desk ? { x: c, y: sum[1] + 80, w: 880, h: 580 } : { x: c, y: sum[1] + 80, w: 230, h: 110 };
    inner = { bs, acc, alco, sum, desk, circ: o.bs ? { x: bs.x + 10, y: bs.y + HEAD + 10, w: circ[0], h: circ[1] } : null, sub };
    R.bank = { x: bx, y: by, w: Math.max(acc.x + acc.w, desk.x + desk.w, alco.x + alco.w) + 70 - bx, h: Math.max(bs.y + bs.h, acc.y + acc.h, desk.y + desk.h) + 120 - by };
  } else R.bank = { x: bx, y: by, w: 260, h: 420 };
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
    const acc = g.inner?.bs, same = Object.keys(l.ports).filter(f => sideOf(l.ports[f]) === side).sort((a, b) => l.ports[a][side === 'L' ? 1 : 0] - l.ports[b][side === 'L' ? 1 : 0]), i = same.indexOf(flow);
    if (side === 'L') { const y0 = acc ? acc.y + 60 : r.y + 80, dy = acc ? (acc.h - 100) / same.length : (r.h - 120) / same.length, y = y0 + i * dy; return { p: [r.x, y], q: [r.x, y + LANE], side }; }
    const x0 = acc ? acc.x + 40 : r.x + 50, x = x0 + i * 60; return { p: [x, r.y + r.h], q: [x + LANE, r.y + r.h], side };
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

type DiagramData = { result: Result; at: number; o: Open; set: (k: string) => void; map: MapData; scenario: Scenario; desk: ReactNode };
function Diagram({ data }: NodeProps<Node<DiagramData>>) {
  const { result, at, o, set, map, scenario, desk } = data;
  const g = geometry(o, map), { R } = g, B = R.bank;
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
    const ends = bus.flows.flatMap(f => [terminal(map, g, o, bus.a, f), terminal(map, g, o, bus.b, f)]);
    const vertical = ends.every(e => e.side === 'L' || e.side === 'R');
    const A = R[bus.a], Bb = R[bus.b];
    // rail position: in the gap between the two agents (vertical buses) or between / below them (horizontal)
    const c = vertical ? (bus.id === 'mortgage' ? g.c2 + g.w2 + 90 : bus.id === 'deposit' ? g.c2 + g.w2 + 170 : (Math.min(A.x + A.w, Bb.x + Bb.w) + Math.max(A.x, Bb.x)) / 2 - LANE / 2)
      : bus.id === 'firm' ? Math.max(R.firms.y + R.firms.h, R.households.y + R.households.h, Bb.y + Bb.h) + 70 : (A.y + A.h + Bb.y) / 2 - LANE / 2;
    const taps: P[] = [];
    const branch = (pt: P, k: number, key: string, dash?: string) => {
      const end: P = vertical ? [c + k, pt[1]] : [pt[0], c + k]; taps.push(end);
      wires.push(line([pt, end], bus.color, key, dash)); wires.push(dot(end, bus.color, key + 'd'));
    };
    ends.forEach((e, i) => { branch(e.p, 0, `${bus.id}${i}p`); branch(e.q, LANE, `${bus.id}${i}q`, '5 3'); });
    const along = taps.map(t => vertical ? t[1] : t[0]), lo = Math.min(...along) - 24, hi = Math.max(...along) + 24;
    wires.unshift(<g key={bus.id + 'rails'}>
      {[0, LANE].map(k => <line key={k} x1={vertical ? c + k : lo} x2={vertical ? c + k : hi} y1={vertical ? lo : c + k} y2={vertical ? hi : c + k} stroke={bus.color} strokeWidth={6} strokeLinecap="round" strokeOpacity={k ? 0.5 : 1}/>)}
      <text x={vertical ? c + LANE / 2 : hi + 14} y={vertical ? lo - 12 : c + LANE} textAnchor={vertical ? 'middle' : 'start'} className="bus-name" fill={bus.color}>{bus.label}</text>
    </g>);
  }
  // ---- the Financial sector (empty for now) and the interbank bus from the bank's bottom edge
  const ib = terminal(map, g, o, 'bank', 'loan_interest'), fsX = ib.p[0] + 260, railY = B.y + B.h + 150;
  const fs: R = { x: fsX - 40, y: railY + 90, w: TILE[0], h: TILE[1] }, ibx = ib.p[0] + 120, IB = '#c0392b';
  wires.push(<g key="ib">
    {[0, LANE].map(k => <line key={k} x1={ibx - 24} x2={fsX + LANE + 24} y1={railY + k} y2={railY + k} stroke={IB} strokeWidth={6} strokeLinecap="round" strokeOpacity={k ? 0.5 : 1}/>)}
    {line([[ibx, B.y + B.h], [ibx, railY]], IB, 'ib1')}{line([[ibx + LANE, B.y + B.h], [ibx + LANE, railY + LANE]], IB, 'ib2', '5 3')}
    {line([[fsX, railY], [fsX, fs.y]], IB, 'ib3')}{line([[fsX + LANE, railY + LANE], [fsX + LANE, fs.y]], IB, 'ib4', '5 3')}
    <text x={fsX + LANE + 40} y={railY + LANE} className="bus-name" fill={IB}>Interbank bus</text>
  </g>);
  // ---- disturbances d: Covid (and the other active shocks) into the firms' breadboard, the subsidy into households
  const D = '#c0392b', SCALE: Record<string, keyof Scenario> = { d_income: 'income_scale', d_covid: 'covid_scale', d_crisis: 'crisis_scale' };
  const firmIns = map.disturbances.filter(d => d.target === 'firms' && !(SCALE[d.id] && scenario[SCALE[d.id]] === 0));
  firmIns.forEach((d, i) => {
    const r = R.firms, e = map.elements.find(x => x.name === (d as { element?: string }).element && x.agent === 'firms');
    const y = o.firms && e?.pins ? r.y + HEAD + inputPath('left', i, firmIns.length, map.layouts.firms.size as P, e.pins)[0][1] * S : r.y + HEAD + (r.h - HEAD) * (i + 1) / (firmIns.length + 1);
    wires.push(arrow([[r.x - 120, y], [r.x, y]], D, 'df' + d.id, 'd'));
  });
  const govY = Math.max(R.firms.y + R.firms.h, R.households.y + R.households.h, B.y + B.h) + 150, gx = R.households.x + R.households.w * 0.8;
  wires.push(arrow([[gx, govY], [gx, R.households.y + R.households.h]], D, 'dgov', 'd', 0.9));
  const gov: R = { x: gx - TILE[0] / 2, y: govY, w: TILE[0], h: TILE[1] };
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
    { const t = terminal(map, g, o, 'bank', 'loan_interest'), x = t.p[0] + 120;
      wires.push(line([[x, B.y + B.h], [x, circ ? circ.y + circ.h : bs.y + bs.h]], IB, 'in-ib')); wires.push(line([[x + LANE, B.y + B.h], [x + LANE, circ ? circ.y + circ.h : bs.y + bs.h]], IB, 'iq-ib', '5 3')); }
    // the breadboard's stocks and flows are read by Accounting; Accounting reports y to Σ
    { const ya = sub ? acc.y + HEAD + 30 : acc.y + 55;
      if (sub) over.push(arrow([[bs.x + bs.w, ya], [sub.bal.x + 40, ya], [sub.bal.x + 40, sub.bal.y]], G, 'x', 'stocks · flows', 0));
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
    wires.push(arrow([[sum[0], sum[1] + 17], [sum[0], dk.y]], '#1f2a26', 'e', 'e₁, e₂'));
    // u: the desk's rates into the bank's rate sources (B§Mortgage_rate_ALM and B2 on the breadboard)
    const el = (name: string): P | null => { const e = map.elements.find(x => x.agent === 'bank' && x.name === name); if (!circ || !e?.pins) return null;
      const cx = e.pins.reduce((s, p) => s + p[0], 0) / e.pins.length, cy = e.pins.reduce((s, p) => s + p[1], 0) / e.pins.length; return [circ.x + cx * g.cs, circ.y + cy * g.cs]; };
    const uT = [el('B§Mortgage_rate_ALM') ?? [bs.x + bs.w, bs.y + bs.h - 110] as P, el('B2') ?? [bs.x + bs.w, bs.y + bs.h - 60] as P];
    ['u₁ loan rate', 'u₂ savings rate'].forEach((name, i) => {  // labels on the top lane, clear of each other
      // over the top of Accounting, then down into the breadboard's rate source (or the closed box's right edge)
      const uy = dk.y + 45 + 30 * i, mx = acc.x + acc.w + 40 + 25 * i, t = uT[i], top = Math.min(bs.y, acc.y) - 20 - 18 * i, dx = bs.x + bs.w + 40 + 20 * i;
      const pts = circ ? [[dk.x, uy], [mx, uy], [mx, top], [t[0], top], [t[0], t[1] - 22]] : [[dk.x, uy], [mx, uy], [mx, top], [dx, top], [dx, t[1]], [t[0], t[1]]];
      over.push(arrow(pts, PU, 'u' + i, name, 0.5));
    });
    inside = <>
      <Block r={bs} label="Bank circuit" tone={o.bs ? 'sub-group' : 'sub-closed'} open={o.bs} toggle={() => set('bs')} z={1}>
        {o.bs && circ && <div className="bus-circuit" style={{ position: 'absolute', left: circ.x - bs.x, top: circ.y - bs.y, width: circ.w, height: circ.h }}><AgentCircuit map={map} agent="bank" scenario={scenario} selection={NONE} pick={() => {}} outside/></div>}
      </Block>
      <Block r={acc} label="Accounting" tone={o.acc ? 'sensor-open' : 'sensor'} open={o.acc} toggle={() => set('acc')} z={1}/>
      {sub && STMT.map(([k, label, gid]) => <Block key={k} r={sub[k]} label={label} tone={o[k] ? 'sensor-open bus-stmt' : 'sensor'} open={o[k]} toggle={() => set(k)} z={3}>
        {o[k] && <div className="bus-stmt-body nowheel" style={{ position: 'absolute', left: 6, right: 6, top: HEAD + 4, bottom: 6 }}>
          <AtContext.Provider value={{ result, at }}><BankStatements only={gid}/></AtContext.Provider></div>}
      </Block>)}
      <Block r={alco} label="ALCO" tone="reference"/>
      <div className="map-node summing" style={{ position: 'absolute', left: sum[0] - 17, top: sum[1] - 17, width: 34, height: 34, zIndex: 2 }}/>
      <Block r={dk} label="ALM Desk" tone="controller" open={o.desk} toggle={() => set('desk')}>
        {o.desk && <div className="bus-breadboard" style={{ position: 'absolute', left: 8, right: 8, top: HEAD + 6, bottom: 8 }}><AtContext.Provider value={{ result, at }}>{desk}</AtContext.Provider></div>}
      </Block>
    </>;
  }
  const W = Math.max(B.x + B.w, fs.x + fs.w + 200) + 80, H = Math.max(fs.y + fs.h, gov.y + gov.h, R.firms.y + R.firms.h) + 140;
  const agent = (id: string) => <Block key={id} r={R[id]} label={map.agents[id]?.label ?? id} tone="agent" open={o[id]} toggle={() => set(id)}>
    {o[id] && <div className="bus-circuit" style={{ position: 'absolute', left: 0, top: HEAD, width: R[id].w, height: R[id].h - HEAD }}>
      <AgentCircuit map={map} agent={id} scenario={scenario} selection={NONE} pick={() => {}} outside={id !== 'firms'} inputs={id === 'firms' ? firmIns : []}/></div>}
  </Block>;
  return <div className="bus-diagram nodrag" style={{ width: W, height: H }}>
    <svg width={W} height={H} className="bus-wires">{wires}</svg>
    {['constructors', 'investors', 'households', 'firms'].map(agent)}
    <Block r={gov} label="Government" tone="reference bus-gov-block"/>
    <Block r={fs} label="Financial sector" tone="sub-closed"/>
    <Block r={B} label="Bank" tone={o.bank ? 'sub-group' : 'sub-closed'} open={o.bank} toggle={() => set('bank')} z={0}/>
    {inside}
    <svg width={W} height={H} className="bus-wires bus-over">{over}</svg>
  </div>;
}

const nodeTypes = { diagram: Diagram };

function Inner({ result, desk, patch }: { result: Result; desk: ReactNode; patch: (m: MapData) => MapData }) {
  const n = result.year.length;
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
    if (k === 'acc' && !next.acc) for (const x of subs) next[x] = false;
    if (!map) return next;
    const g = geometry(next, map), byId: Record<string, R | undefined> = { ...g.R, ...g.inner?.sub, bs: g.inner?.bs, acc: g.inner?.acc, desk: g.inner?.desk };
    const target = next[k] ? byId[k] : subs.includes(k) ? byId.acc : (k === 'bs' || k === 'acc' || k === 'desk') ? g.R.bank : undefined;
    window.setTimeout(() => { if (target) rf.fitBounds({ x: target.x - 40, y: target.y - 40, width: target.w + 80, height: target.h + 80 }, { duration: 450 }); else rf.fitView({ duration: 450, padding: 0.04 }); }, 40);
    return next;
  }), [rf, map]);
  const nodes = useMemo<Node[]>(() => map ? [{ id: 'd', type: 'diagram', position: { x: 0, y: 0 }, draggable: false, selectable: false, focusable: false, style: { pointerEvents: 'all' },
    data: { result, at: Math.min(at, n - 1), o, set, map, scenario, desk } }] : [], [result, at, n, o, set, map, scenario, desk]);
  return <>
    <div className="bus-time">
      <button className="ghost" aria-label={playing ? 'Pause' : 'Play through time'} onClick={() => { if (at >= n - 1) setAt(0); setPlaying(p => !p); }}>{playing ? <Pause size={14}/> : <Play size={14}/>}</button>
      <span>{result.year[Math.min(at, n - 1)].toFixed(1)}</span>
      <input type="range" min={0} max={n - 1} value={Math.min(at, n - 1)} onChange={e => { setPlaying(false); setAt(+e.target.value); }}/>
      <button className="ghost small" onClick={() => { setO({}); window.setTimeout(() => rf.fitView({ duration: 450, padding: 0.04 }), 40); }}>Close all</button>
    </div>
    <div className="bus-canvas">{map ? <ReactFlow nodes={nodes} edges={[]} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.04 }} minZoom={0.05} maxZoom={4} proOptions={{ hideAttribution: true }} nodesDraggable={false}><Controls showInteractive={false}/></ReactFlow> : <p className="muted">Loading the model…</p>}</div>
  </>;
}

export function BankBusView({ result, desk, patch }: { result: Result; desk: ReactNode; patch: (m: MapData) => MapData }) {
  return <section className="panel bus-view"><ReactFlowProvider><Inner result={result} desk={desk} patch={patch}/></ReactFlowProvider></section>;
}
