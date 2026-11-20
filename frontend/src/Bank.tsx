// "Bank controls" mode (20 Nov 2026, experimental): the ALM Desk is the controller, the government a disturbance.
// Loop and names as in Menkveld (2025), ch. 3: ALCO = reference governor (financial targets), ALM Desk = controller
// (client rates), ALM Reporting = sensor (financial reports), the Economy / digital twin = process.
// The canvas is the main model canvas (ModelMap) in its bank variant: the same Economy box (housing market, CPB
// quadrants and financial sector, agent by agent), with the ALCO, the ALM Desk and ALM Reporting around it.
// Backend: POST api/bank/simulate -> housing/bank_netlist.py (a separate copy of the housing netlist with the bank,
// run in ngspice; the housing model elsewhere on the site is unchanged). Demo values are Claude's choices.
import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { LoaderCircle, RotateCcw, Minus, Plus } from 'lucide-react';
import { api } from './api';
import type { Line } from './Chart';
import { AtContext, BankCtx, ModelMap, readTrace, type BankVariant } from './ModelMap';
import { BalanceBoard, DeskBoard } from './BankBoards';
import type { Design } from './Analysis';
import type { MapData, Result, Scenario, Selection } from './types';

type Series = (number | null)[];
interface BankRun {
  ok: boolean; breakdown_year: number | null; t_years: number[]; crisis_years: [number, number] | null; year0: number; result: Result | null;
  price_index: Series; underwater_pct: Series; book_ltv_pct: Series; mortgage_book: Series; tier1_pct: Series; ltf_pct: Series;
  mortgage_rate_pct: Series; savings_rate_pct: Series; ftp_pct: Series; spread_pct: Series; wholesale_funding: Series;
  deposits: Series; equity: Series; new_lending: Series; firm_lending: Series; savings_interest: Series; subsidy: Series; crisis: Series; covid: Series;
  targets: { tier1_pct: number; ltf_pct: number }; start: { underwater_pct: number; book_ltv_pct: number; mortgage_rate_pct: number; savings_rate_pct: number };
  summary: { min_price_pct: number; max_price_after_crisis_pct: number; max_underwater_pct: number; min_tier1_pct: number; mortgage_rate_range_pct: [number, number] } | null;
}

// Defaults = bank_netlist.BANK_DEFAULTS (demo choices). Ranges = bank_netlist.RANGES.
const DEF = { funding_cut: 0.5, premium_pp: 3, k_rate: 130, Kp_ftp: 0.05, Ki_ftp: 0.05, Kp_s: 0.10, Ki_s: 0.10, uw_mobility: 0.22, theta0: 0.06, sigma_ltv: 0.45, gov_step: 0, gov_year: 5, covid_scale: 1 };
type Params = typeof DEF;
type Key = keyof Params;
const RANGE: Record<Key, [number, number]> = { funding_cut: [0, 1], premium_pp: [0, 6], k_rate: [1, 300], Kp_ftp: [0, 1], Ki_ftp: [0, 1], Kp_s: [0, 1.5], Ki_s: [0, 1.5], uw_mobility: [0, 0.5], theta0: [0.03, 0.10], sigma_ltv: [0.25, 0.6], gov_step: [-20, 20], gov_year: [1, 25], covid_scale: [0, 2] };
const overrides = (p: Params) => Object.fromEntries((Object.keys(DEF) as Key[]).filter(k => Math.abs(p[k] - DEF[k]) > 1e-9).map(k => [k, p[k]]));
const YEAR0 = 1996.46;  // calendar year of run year 0 (scenario.YEAR_AT_RAW_ZERO)

type Compare = 'none' | 'off' | 'blind';
const COMPARE: Record<Compare, { label: string; alm_on: boolean; housing_feedback: boolean; legend: string }> = {
  none: { label: 'Nothing', alm_on: true, housing_feedback: true, legend: '' },
  off: { label: 'Rates frozen', alm_on: false, housing_feedback: true, legend: 'Rates frozen: the bank absorbs the shock (central bank lends the funding gap at a penalty rate)' },
  blind: { label: 'Market blind', alm_on: true, housing_feedback: false, legend: 'Desk on, but the rate does not reach the housing market' },
};
const C = { now: '#145a32', cmp: '#8a948f', mortgage: '#b9851c', savings: '#1f6fc4', ftp: '#8a948f', target: '#5c6b65', shock: '#c5352a', covid: '#e0782a' };

const pct = (v: number, d = 1) => `${v < 0 ? '−' : v > 0 ? '+' : ''}${Math.abs(v).toFixed(d)}%`;
const f = (v: number | null | undefined, d = 1) => v == null ? '–' : v.toLocaleString('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d });

function useRun(p: Params, alm: boolean, fb: boolean, cmp: Compare) {
  const [now, setNow] = useState<BankRun | null>(null), [other, setOther] = useState<BankRun | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const turn = useRef(0);
  useEffect(() => {
    const mine = ++turn.current, o = overrides(p);
    const t = window.setTimeout(() => {
      setBusy(true);
      const c = COMPARE[cmp], same = cmp === 'none' || (c.alm_on === alm && c.housing_feedback === fb);
      Promise.all([api<BankRun>('/bank/simulate', { overrides: o, alm_on: alm, housing_feedback: fb, full: true }),
        same ? Promise.resolve(null) : api<BankRun>('/bank/simulate', { overrides: o, alm_on: c.alm_on, housing_feedback: c.housing_feedback })])
        .then(([a, b]) => { if (mine === turn.current) { setNow(a); setOther(b); setError(''); } })
        .catch(e => { if (mine === turn.current) setError((e as Error).message); })
        .finally(() => { if (mine === turn.current) setBusy(false); });
    }, 180);
    return () => clearTimeout(t);
  }, [p, alm, fb, cmp]);
  return { now, other, busy, error };
}

// ---------- chart in calendar years, with the crisis shaded
function BankChart({ title, unit, lines, crisis, height = 230 }: { title: string; unit: string; lines: Line[]; crisis: [number, number] | null; height?: number }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true; const node = box.current;
    void import('plotly.js-dist-min').then(({ default: Plotly }) => {
      if (!live || !node) return;
      Plotly.react(node, lines.map(l => ({ type: 'scatter', mode: 'lines', name: l.name, x: l.x, y: l.y, connectgaps: false, line: { color: l.color, dash: l.dash ?? 'solid', width: l.width ?? 2.2 }, hovertemplate: `%{y:.2f}<extra>${l.name}</extra>` })), {
        height, margin: { l: 50, r: 10, t: 6, b: 30 }, paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)', hovermode: 'x unified', showlegend: false,
        font: { family: 'Inter, system-ui, sans-serif', size: 12, color: '#3c4a45' },
        xaxis: { range: [YEAR0, YEAR0 + 29], dtick: 4, tickformat: 'd', gridcolor: '#e8ece9', zeroline: false },
        yaxis: { title: { text: unit }, gridcolor: '#e8ece9', zerolinecolor: '#aab5b0' },
        shapes: crisis ? [{ type: 'rect', xref: 'x', yref: 'paper', x0: crisis[0], x1: crisis[1], y0: 0, y1: 1, fillcolor: 'rgba(197,53,42,0.06)', line: { width: 0 }, layer: 'below' }] : [],
        annotations: crisis ? [{ x: (crisis[0] + crisis[1]) / 2, y: 0, xref: 'x', yref: 'paper', yanchor: 'bottom', text: 'crisis', showarrow: false, font: { size: 11, color: C.shock } }] : [],
      }, { displayModeBar: false, responsive: true });
    });
    return () => { live = false; };
  }, [lines, unit, height, crisis]);
  return <figure className="chart">{title && <figcaption>{title}</figcaption>}<div ref={box} style={{ minHeight: height }} aria-label={title}/></figure>;
}
function Key_({ items }: { items: { name: string; color: string; dash?: string }[] }) {
  return <div className="bank-legend">{items.map(i => <span key={i.name}><svg width="26" height="8" aria-hidden><line x1="1" y1="4" x2="25" y2="4" stroke={i.color} strokeWidth="2.4" strokeDasharray={i.dash === 'dash' ? '6 4' : i.dash === 'dot' ? '1.5 3.5' : undefined} strokeLinecap="round"/></svg>{i.name}</span>)}</div>;
}

// ---------- controls
function Stepper({ label, value, k, set }: { label: string; value: number; k: Key; set: (k: Key, v: number) => void }) {
  const [lo, hi] = RANGE[k];
  const go = (m: number) => set(k, Math.min(hi, Math.max(lo, value === 0 && m > 1 ? 0.01 : +(value * m).toPrecision(4))));
  return <div className="bk-step"><span>{label}</span><button className="ghost small" aria-label={`${label} weaker`} onClick={() => go(1 / 1.2)}><Minus size={13}/></button><output>{f(value, 3)}</output><button className="ghost small" aria-label={`${label} stronger`} onClick={() => go(1.2)}><Plus size={13}/></button></div>;
}
function Knob({ label, hint, value, k, step, format, set }: { label: string; hint: string; value: number; k: Key; step: number; format: (v: number) => string; set: (k: Key, v: number) => void }) {
  return <label className="slider"><span className="slider-head"><span>{label}</span><output>{format(value)}</output></span>
    <input type="range" min={RANGE[k][0]} max={RANGE[k][1]} step={step} value={value} aria-label={label} onChange={e => set(k, Number(e.target.value))}/><small>{hint}</small></label>;
}
function Toggle({ label, on, set }: { label: string; on: boolean; set: (v: boolean) => void }) {
  return <label className="check bk-toggle"><input type="checkbox" checked={on} onChange={e => set(e.target.checked)}/> {label}</label>;
}
type Part = 'desk' | 'reporting' | 'board' | 'others' | 'covid' | 'gov' | 'economy';
function Panel({ part, p, set, alm, setAlm, fb, setFb, run }: { part: Part; p: Params; set: (k: Key, v: number) => void; alm: boolean; setAlm: (v: boolean) => void; fb: boolean; setFb: (v: boolean) => void; run: BankRun | null }) {
  const { result, at } = useContext(AtContext);
  const now = (signal: string, sc = 1) => { const t = result && readTrace(result, signal); return t && t[at] != null ? t[at] * sc : null; };
  switch (part) {
    case 'desk': return <><p className="eyebrow">Controller</p><h3>ALM Desk</h3>
      <p className="muted small">Tracks the ALCO's financial targets with the client rates: two PI controllers (Menkveld, 2025). FTP = (mortgage rate + savings rate)/2; spread = mortgage rate − savings rate (the mortgage rate is Menkveld's loan rate).</p>
      <Toggle label="Desk on (closed loop)" on={alm} set={setAlm}/>
      <h4>Liquidity risk: FTP rate</h4><p className="muted small">Raises the FTP when the loan-to-deposit ratio is above target ({f(run?.targets.ltf_pct, 0)}%).</p>
      <Stepper label="Kp" value={p.Kp_ftp} k="Kp_ftp" set={set}/><Stepper label="Ki" value={p.Ki_ftp} k="Ki_ftp" set={set}/>
      <h4>Solvency risk: spread</h4><p className="muted small">Raises the spread when the Tier 1 capital ratio falls below target ({f(run?.targets.tier1_pct, 1)}%).</p>
      <Stepper label="Kp" value={p.Kp_s} k="Kp_s" set={set}/><Stepper label="Ki" value={p.Ki_s} k="Ki_s" set={set}/>
      <p className="muted small">One click = 20% stronger or weaker. Open the ALM Desk block (+) for its op-amp breadboard.</p>
      <button className="ghost small" onClick={() => (['Kp_ftp', 'Ki_ftp', 'Kp_s', 'Ki_s'] as Key[]).forEach(k => set(k, DEF[k]))}><RotateCcw size={13}/> Default gains</button></>;
    case 'reporting': return <><p className="eyebrow">Sensor · measured output y</p><h3>ALM Reporting</h3>
      <p className="muted small">Turns the cash flow projections of the bank inside the Economy box into financial reports: the Tier 1 capital ratio (solvency) and the loan-to-deposit ratio (liquidity).</p>
      <table className="bk-table"><tbody>
        <tr><td>Mortgages</td><td>{f(now('I(Bk_m)'), 1)}</td></tr><tr><td>Firm loans</td><td>40.0</td></tr>
        <tr><td>Deposits</td><td>{f(now('I(Bk_dep)'), 1)}</td></tr><tr><td>Deposits of other banks</td><td>{f(now('I(Bk_w)'), 1)}</td></tr>
        <tr><td>Equity</td><td>{f(now('I(Bk_e)'), 2)}</td></tr><tr><td>Tier 1</td><td>{f(now('I(Bk_t1)'), 1)}%</td></tr><tr><td>Loan-to-deposit</td><td>{f(now('I(Bk_ltf)'), 1)}%</td></tr>
      </tbody></table><p className="muted small">Illustrative units; the mortgage book starts at 100. Values at the canvas's year.</p></>;
    case 'board': return <><p className="eyebrow">Reference governor · reference input r</p><h3>ALCO</h3>
      <p className="muted small">The Asset-Liability Committee sets the financial targets the ALM Desk tracks: here the bank's start values, Tier 1 capital ratio {f(run?.targets.tier1_pct, 1)}% and loan-to-deposit ratio {f(run?.targets.ltf_pct, 0)}%. Set by hand, as in Menkveld's simulations.</p>
      <p className="muted small">Regulatory constraint: Basel III requires a Tier 1 capital ratio of at least 6%.</p></>;
    case 'others': return <><p className="eyebrow">Disturbance d</p><h3>Other banks</h3>
      <p className="muted small">The crisis comes from outside your bank: other banks withdraw their deposits and charge more, and lending to firms (I8) is cut. Timing as the W-shaped financial crisis of the housing model. A funding gap is borrowed from the central bank at a penalty rate.</p>
      <Knob label="Deposits withdrawn" hint="Share of the deposits of other banks that is withdrawn in the crisis." value={p.funding_cut} k="funding_cut" step={0.05} format={x => `${Math.round(x * 100)}%`} set={set}/>
      <Knob label="Interbank premium" hint="Extra cost of what is left of those deposits." value={p.premium_pp} k="premium_pp" step={0.25} format={x => `+${f(x, 2)} pp`} set={set}/></>;
    case 'covid': return <><p className="eyebrow">Disturbance d</p><h3>Covid shock</h3>
      <p className="muted small">The housing netlist's own Covid shock at the firms, as in the main model (2020.5, fading over about 8 years).</p>
      <Knob label="Size of the Covid shock" hint="× 1 as in the main model; 0 switches it off." value={p.covid_scale} k="covid_scale" step={0.1} format={x => `× ${f(x, 1)}`} set={set}/></>;
    case 'gov': return <><p className="eyebrow">Disturbance d</p><h3>Government</h3>
      <p className="muted small">Here the government does not control: its owner-occupied subsidy is a change the desk has to live with.</p>
      <Knob label="Subsidy change" hint="Step in the owner-occupied subsidy (model units)." value={p.gov_step} k="gov_step" step={1} format={x => `${x > 0 ? '+' : ''}${f(x, 0)}`} set={set}/>
      <Knob label="From" hint="When the step starts (half a year to build up)." value={p.gov_year} k="gov_year" step={0.5} format={x => (YEAR0 + x).toFixed(1)} set={set}/></>;
    default: return <><p className="eyebrow">System</p><h3>Economy</h3>
      <p className="muted small">The housing netlist of the rest of the site (a separate copy) with the bank added. The desk's mortgage rate replaces its fixed interest-rate input; the savings rate drives its savings interest.</p>
      <Toggle label="Mortgage rate reaches the housing market" on={fb} set={setFb}/>
      <Knob label="Strength of the rate channel" hint="Multiplies the netlist's own rate effect (×1: +1 pp gives only −0.1%). 130 is the demo default; above about 250 the loop runs away." value={p.k_rate} k="k_rate" step={1} format={x => `× ${f(x, 0)}`} set={set}/>
      <Knob label="Owners that move per year" hint="Movers repay and borrow again at today's value." value={p.theta0} k="theta0" step={0.005} format={x => `${f(x * 100, 1)}%`} set={set}/>
      <Knob label="Underwater owners move less" hint="ESB 2017: 22% less." value={p.uw_mobility} k="uw_mobility" step={0.01} format={x => `${Math.round(x * 100)}% less`} set={set}/>
      <Knob label="Spread of loan-to-value" hint="Sets the underwater share (17% at the start)." value={p.sigma_ltv} k="sigma_ltv" step={0.01} format={x => f(x, 2)} set={set}/></>;
  }
}

/** Values at the canvas's own time cursor, for the breadboards of the desk and the reporting. */
function useLive(): Record<string, number | null> {
  const { result, at } = useContext(AtContext);
  const v = (signal: string, sc = 1) => { const t = result && readTrace(result, signal); return t && t[at] != null ? t[at] * sc : null; };
  return { ftp: v('I(Bk_ftp)'), s: v('I(Bk_s)'), rm: v('I(Bk_rm)'), rs: v('I(Bk_rs)'), t1: v('I(Bk_t1)'), ltf: v('I(Bk_ltf)'), dep: v('I(Bk_dep)'), eq: v('I(Bk_e)') };
}
function LiveDesk({ p, alm }: { p: Params; alm: boolean }) { return <DeskBoard K={p} v={useLive()} alm={alm}/>; }
function LiveSheet() { return <BalanceBoard v={useLive()}/>; }

// The bank netlist on the same model map (bank_netlist.lines): its disturbances, the desk's control signals and the
// components inside the netlist bank. The desk's rates enter the bank (Jesse, 20 Nov 2026): u1 ends on the mortgage-rate
// source (was the fixed Interest_Rates input), u2 on B2 (savings interest). Added to the bank's drawing: the
// endogenous mortgage book (was I§Mortgages), deposits and equity (capacitors with their behavioural sources) and the
// Tier 1 and loans/funding read-outs. Positions are in the free part of the bank layout (1100 x 700), Claude's choice.
const RENAME: Record<string, { name: string; type?: string; role: string; trace?: string }> = {
  'Interest_Rates': { name: 'B§Mortgage_rate_ALM', type: 'bi2', role: 'Mortgage rate u₁ from the ALM Desk (FTP + spread/2). Replaces the fixed interest-rate input; drives the mortgage interest.', trace: 'I(Bk_rm)' },
  'I§Mortgages': { name: 'B§Mortgages', type: 'bi2', role: 'Mortgage book, endogenous: movers repay and borrow again at today\'s house value, within LTV and LTI limits.' },
  'B2': { name: 'B2', role: 'Savings interest = savings × savings rate u₂ from the ALM Desk (FTP − spread/2).' },
  'B§Mortgage_interest': { name: 'B§Mortgage_interest', role: 'Mortgage interest = mortgage debt × the mortgage rate from the ALM Desk.' },
  'I8': { name: 'I8', role: 'Lending to firms. Cut in the crisis (other banks).' },
};
const added = (name: string, type: string, pins: number[][], role: string, trace: string, state = 'active') =>
  ({ name, a: '', b: '', value: '', state, type, role, pins, agent: 'bank', flows: [] as string[], trace, netlist: '' });
const BANK_PARTS = [
  added('B§Deposit_flow', 'bi2', [[890, 190], [890, 110]], 'Deposits flow in and out with the savings rate: (D* − D)/τ.', 'I(Bk_dep)'),
  added('C§Deposits', 'cap', [[1000, 110], [1000, 190]], 'Deposits D (capacitor: the stock).', 'I(Bk_dep)'),
  added('B§Net_interest', 'bi2', [[890, 350], [890, 270]], 'Net interest income minus losses on underwater mortgages and payout.', 'I(Bk_nii)'),
  added('C§Equity', 'cap', [[1000, 270], [1000, 350]], 'Equity E (capacitor: the stock).', 'I(Bk_e)'),
  added('B§Tier_1', 'bi2', [[360, 120], [480, 120]], 'Read-out: Tier 1 capital ratio = Tier 1 capital (equity) / risk-weighted assets. Measured by ALM Reporting.', 'I(Bk_t1)', 'readout'),
  added('B§Loans_funding', 'bi2', [[360, 220], [480, 220]], 'Read-out: loan-to-deposit ratio = loans / deposits (incl. deposits of other banks). Measured by ALM Reporting.', 'I(Bk_ltf)', 'readout'),
];
const BANK_WIRES = [[890, 110, 1000, 110], [890, 190, 1000, 190], [890, 270, 1000, 270], [890, 350, 1000, 350]];
// The loop signals' cards in bank mode (they replace the housing ones: house price, construction payments, ...).
// Traces from bank_netlist.simulate: ratios and rates ×100, so in % (errors in percentage points).
const BANK_LOOP: NonNullable<MapData['loop']> = {
  y_reference: { label: 'Financial targets', title: 'Reference input r · Tier 1 target (L/D target 100%)', signal: 'Bank_target_t1', unit: '%', color: '#2b6599', dock: { kind: 'signal', id: 'y_reference' } },
  y_error: { label: 'Target deviations', title: 'Control error e · target deviations (target − measured)', signal: 'Bank_dev_t1', unit: '% points', color: '#3f9a1f', pair: { signal: 'Bank_dev_ltd', label: 'loan-to-deposit', color: '#c98a1b', first: 'Tier 1' }, dock: { kind: 'agent', id: 'controller' } },
  x1: { label: 'Tier 1 ratio', title: 'Cash flow projection · Tier 1 capital ratio', signal: 'I(Bk_t1)', unit: '%', color: '#3f9a1f', dock: { kind: 'sensor', id: '' } },
  x2: { label: 'Loan-to-deposit ratio', title: 'Cash flow projection · loan-to-deposit ratio', signal: 'I(Bk_ltf)', unit: '%', color: '#c98a1b', dock: { kind: 'sensor', id: '' } },
  y_price: { label: 'Financial reports', title: 'Measured output y · Tier 1 capital ratio (L/D: card x₂)', signal: 'I(Bk_t1)', unit: '%', color: '#3f9a1f', dock: { kind: 'sensor', id: '' } },
};
function patchMap(m: MapData): MapData {
  const ren = (n: string) => RENAME[n]?.name ?? n;
  const flows = m.flows.map(fl => ({ ...fl, chain: fl.chain.map(ren) })).map(fl => fl.id === 'owner_subsidy' ? { ...fl, label: 'Mortgage rate', short: 'u₁ Mortgage rate', signal: 'I(Bk_rm)', description: 'Client rate set by the ALM Desk: FTP + spread/2. Enters the bank at the mortgage-rate source, which drives the mortgage interest.' }
    : fl.id === 'rental_subsidy' ? { ...fl, label: 'Savings rate', short: 'u₂ Savings rate', signal: 'I(Bk_rs)', description: 'Client rate set by the ALM Desk: FTP − spread/2. Enters the bank at B2, the savings interest.' } : fl);
  const elements = [...m.elements.map(e => RENAME[e.name] && e.agent === 'bank' ? { ...e, name: RENAME[e.name].name, type: RENAME[e.name].type ?? e.type, role: RENAME[e.name].role, trace: RENAME[e.name].trace ?? e.trace } : e), ...BANK_PARTS];
  const bank = m.layouts.bank;
  const layouts = { ...m.layouts, bank: { ...bank, wires: [...bank.wires, ...BANK_WIRES], grounds: [...bank.grounds, [945, 190], [945, 350]],
    // the desk's two rates enter the bank from the top and run to their sources
    signals: [{ flow: 'owner_subsidy', path: [[600, 0], [600, 140], [662, 140]] }, { flow: 'rental_subsidy', path: [[625, 0], [625, 415], [420, 415], [420, 560], [372, 560]] }] } };
  const covid = m.disturbances.find(d => d.id === 'd_covid');
  return { ...m, flows, elements, layouts, loop: BANK_LOOP, controller: { label: 'ALM Desk', description: 'Your bank\'s ALM Desk: tracks the ALCO\'s targets with a PI controller on the FTP rate (liquidity risk) and one on the spread (solvency risk). Its two client rates enter the bank.' },
    disturbances: [...(covid ? [covid] : []),
      { id: 'd_others', label: 'Other banks: deposits withdrawn, firm loans cut', signal: 'I(Bk_w)', unit: 'units', target: 'bank', element: 'I8' },
      { id: 'd_gov', label: 'Government subsidy', signal: 'I(Owner_occupied_subsidies)', unit: 'model units', target: 'households', element: 'I§Owner_occupied_subsidies' }] };
}
const DESIGN: Design = { K: [0, 0, 0], filtered: true, settling: 4, overshoot: 25 };

export function BankMode() {
  const [p, setP] = useState<Params>(DEF);
  const [alm, setAlm] = useState(true), [fb, setFb] = useState(true), [cmp, setCmp] = useState<Compare>('off');
  const set = (k: Key, v: number) => setP(x => ({ ...x, [k]: v }));
  const { now, other, busy, error } = useRun(p, alm, fb, cmp);
  const dirty = JSON.stringify(p) !== JSON.stringify(DEF) || !alm || !fb;
  const panel = (part: Part) => <Panel part={part} p={p} set={set} alm={alm} setAlm={setAlm} fb={fb} setFb={setFb} run={now}/>;
  const variant: BankVariant = {
    desk: <LiveDesk p={p} alm={alm}/>, sensor: <LiveSheet/>, patch: patchMap,
    inspect: (s: Selection) => {
      // every loop line opens a bank panel (the housing inspector would show house price, construction, ...)
      const part: Part | null = s.kind === 'agent' && s.id === 'controller' ? 'desk' : s.kind === 'sensor' ? 'reporting' : s.kind === 'signal' && s.id === 'y_reference' ? 'board'
        : s.kind === 'signal' && s.id === 'y_error' ? 'desk' : (s.kind === 'signal' && (s.id === 'y_price' || s.id === 'y_yoy')) || (s.kind === 'flow' && s.id === 'houses') ? 'reporting'
        : s.kind === 'agent' && s.id === 'system' ? 'economy'
        : s.kind === 'signal' && s.id === 'd_others' ? 'others' : s.kind === 'signal' && s.id === 'd_covid' ? 'covid' : s.kind === 'signal' && s.id === 'd_gov' ? 'gov'
        : s.kind === 'shocks' ? 'others' : null;
      return part ? <div className="bank-inspector">{panel(part)}{s.kind === 'shocks' && <>{panel('covid')}{panel('gov')}</>}</div> : null;
    },
  };
  const scenario = useMemo(() => now?.result ? { ...now.result.scenario, feedback: alm, covid_scale: p.covid_scale } as Scenario : null, [now, alm, p.covid_scale]);

  const charts = useMemo(() => {
    if (!now) return null;
    const X = (r: BankRun) => r.t_years.map(t => +(t + r.year0).toFixed(2));
    const L = (r: BankRun, k: keyof BankRun, name: string, color: string, dash?: string, width?: number): Line => ({ name, x: X(r), y: r[k] as number[], color, dash, width });
    const T = (v: number, name: string): Line => ({ name, x: [YEAR0, YEAR0 + 29], y: [v, v], color: C.target, dash: 'dash', width: 1.3 });
    const both = (k: keyof BankRun, name: string) => [...(other ? [L(other, k, `${name}, ${COMPARE[cmp].label.toLowerCase()}`, C.cmp, 'dash')] : []), L(now, k, name, C.now)];
    return {
      price: both('price_index', 'House price'), uw: both('underwater_pct', 'Underwater'),
      rates: [...(other ? [L(other, 'mortgage_rate_pct', `Mortgage rate, ${COMPARE[cmp].label.toLowerCase()}`, C.cmp, 'dash')] : []), L(now, 'mortgage_rate_pct', 'Mortgage rate', C.mortgage), L(now, 'savings_rate_pct', 'Savings rate', C.savings), L(now, 'ftp_pct', 'FTP', C.ftp, 'solid', 1.2)],
      t1: [...both('tier1_pct', 'Tier 1'), T(now.targets.tier1_pct, 'Target')], ltf: [...both('ltf_pct', 'Loan-to-deposit'), T(now.targets.ltf_pct, 'Target')],
      dist: [{ name: 'Deposits of other banks withdrawn', x: X(now), y: now.wholesale_funding.map(w => w == null ? null : 100 * (30 - w) / 30) as number[], color: C.shock }, { name: 'Covid shock', x: X(now), y: now.covid.map(c => c == null ? null : 100 * c / 80) as number[], color: C.covid }],
      crisis: now.crisis_years ? [now.crisis_years[0] + now.year0, now.crisis_years[1] + now.year0] as [number, number] : null,
    };
  }, [now, other, cmp]);

  const s = now?.summary, o = other?.summary;
  const tag = cmp === 'off' ? 'rates frozen' : 'market blind';
  const sentence = s && now?.ok ? (alm && fb ? `With the desk on, the house price falls to ${pct(s.min_price_pct)}${o && other?.ok ? ` (${tag}: ${pct(o.min_price_pct)})` : ''} and peaks at ${pct(s.max_price_after_crisis_pct)} after the crisis (rebound${p.covid_scale ? ' and Covid boom' : ''}). The bank's Tier 1 never falls below ${f(s.min_tier1_pct, 1)}%${o && other?.ok ? ` (${tag}: ${f(o.min_tier1_pct, 1)}%)` : ''}.`
    : `House price at its lowest ${pct(s.min_price_pct)}; Tier 1 never below ${f(s.min_tier1_pct, 1)}%; mortgage rate ${f(s.mortgage_rate_range_pct[0], 2)}–${f(s.mortgage_rate_range_pct[1], 2)}%.`) : '';
  const broken = [now, other].filter((r): r is BankRun => !!r && !r.ok);
  const legend = [{ name: alm ? (fb ? 'Desk on' : 'Desk on, market blind') : 'Rates frozen', color: C.now }, ...(other ? [{ name: COMPARE[cmp].legend, color: C.cmp, dash: 'dash' }] : [])];

  const left = <div className="bank-left">
    <div className="left-head"><div><p className="eyebrow">Disturbances d and model choices</p><h3>Bank scenario</h3></div>{dirty && <button className="ghost small" onClick={() => { setP(DEF); setAlm(true); setFb(true); }}><RotateCcw size={14}/> Reset</button>}</div>
    <label className="bank-cmp">Compare with <select value={cmp} onChange={e => setCmp(e.target.value as Compare)}>{(Object.keys(COMPARE) as Compare[]).map(k => <option key={k} value={k}>{COMPARE[k].label}</option>)}</select></label>
    {panel('others')}{panel('covid')}{panel('gov')}{panel('economy')}
  </div>;

  return <div className="bank-mode">
    <div className="bank-top">
      <div><h2>Bank controls <span className="tag-exp">experimental</span></h2>
        <p className="muted small">The ALCO sets the financial targets, the ALM Desk controls the client rates, ALM Reporting measures (Menkveld, 2025); the government is only a disturbance. Illustrative bank: balance-sheet sizes are round numbers, not those of any real bank.</p></div>
      <div className="bank-controls">{busy && <LoaderCircle className="spin" size={16} aria-label="Running"/>}</div>
    </div>
    {error && <p className="notice bad">{error}</p>}
    {broken.length > 0 && <p className="notice bad">{broken.map(r => `${r === now ? 'This run' : 'The comparison'} runs away in ${((r.breakdown_year ?? 0) + YEAR0).toFixed(1)}`).join('; ')}: the desk raises rates, prices fall, Tier 1 falls further, the desk raises rates again. The model leaves its valid range there, so the lines stop.</p>}

    <BankCtx.Provider value={variant}>
      {scenario && now?.result ? <ModelMap key="bank" scenario={scenario} result={now.result} pinned={null} busy={busy} run={() => {}} setFeedback={setAlm} update={() => {}} design={DESIGN} setDesign={() => {}} lag={0} left={left}/>
        : <section className="panel"><p className="muted">{busy || !error ? 'Running the bank netlist…' : 'No run.'}</p></section>}
    </BankCtx.Provider>

    {sentence && <p className="bank-sentence">{sentence}</p>}
    {charts && now && <section className="panel">
      <Key_ items={legend}/>
      <div className="bank-grid3">
        <BankChart title="House price index (100 = start)" unit="index" lines={charts.price} crisis={charts.crisis}/>
        <BankChart title="Underwater share" unit="% of owners" lines={charts.uw} crisis={charts.crisis}/>
        <div><BankChart title="Client rates: mortgage and savings rate, and FTP" unit="% a year" lines={charts.rates} crisis={charts.crisis}/><Key_ items={[{ name: 'Mortgage rate', color: C.mortgage }, { name: 'Savings rate', color: C.savings }, { name: 'FTP', color: C.ftp }]}/></div>
        <div><BankChart title="Solvency risk: Tier 1 capital ratio" unit="%" lines={charts.t1} crisis={charts.crisis}/><Key_ items={[{ name: 'target', color: C.target, dash: 'dash' }]}/></div>
        <div><BankChart title="Liquidity risk: loan-to-deposit ratio" unit="%" lines={charts.ltf} crisis={charts.crisis}/><Key_ items={[{ name: 'target', color: C.target, dash: 'dash' }]}/></div>
        <div><BankChart title="Disturbances" unit="% of default size" lines={charts.dist} crisis={charts.crisis}/><Key_ items={[{ name: 'Deposits of other banks withdrawn (% of their deposits)', color: C.shock }, { name: 'Covid shock (% of its main-model size)', color: C.covid }]}/></div>
      </div>
    </section>}

    <details className="panel more bank-how"><summary>How it works</summary>
      <ul>
        <li><b>Engine:</b> a separate copy of the housing netlist with the bank added, run in ngspice. The housing model on the rest of the site is unchanged.</li>
        <li><b>Mortgage book:</b> dM/dt = θ·V·ℓ<sub>new</sub> − θ·M − M/T. V follows the house price, θ (movers) is lower when underwater, ℓ<sub>new</sub> is the smaller of the LTV limit and the LTI room. It replaces the netlist's outside mortgage input; the netlist's own debt integrator holds M.</li>
        <li><b>Client rates:</b> mortgage rate = FTP + spread/2, savings rate = FTP − spread/2 (Menkveld eq. 3-4, 3-8, where the mortgage rate is his loan rate). The mortgage rate drives the netlist's mortgage interest (debt × rate), multiplied by the rate-channel strength. The savings rate drives the netlist's savings interest.</li>
        <li><b>Bank:</b> deposits follow the savings rate; equity grows with net interest income minus losses on underwater mortgages; Tier 1 = equity / risk-weighted assets.</li>
        <li><b>ALM Desk:</b> PI on the FTP rate for the loan-to-deposit ratio (liquidity risk), PI on the spread for the Tier 1 capital ratio (solvency risk), as in Menkveld §3-2 and §3-3-2.</li>
        <li><b>Disturbances:</b> other banks withdraw part of their deposits and raise the premium, and firm lending is cut (W-shaped, as the housing model's financial crisis); the Covid shock at the firms; the government's subsidy step.</li>
      </ul>
      <p className="muted note">Changes from Menkveld's set-up: the bank lends mortgages as well as to firms, and the deposits in the loan-to-deposit ratio include the deposits of other banks (interbank funding), so that a withdrawal by other banks shows up in it; the crisis enters as that withdrawal. Any funding gap is borrowed from the central bank at the crisis premium plus a 2 pp penalty; "Rates frozen" means the bank keeps its rates and absorbs that cost. The gains and the rate-channel strength are demo choices, not estimates.</p>
    </details>
    <p className="muted note">ALM structure, names and rate definitions after B.S.R. Menkveld, <i>Economic Engineering for Proactive Asset and Liability Management: Managing Liquidity and Solvency Risk with Process Control</i>, MSc thesis, TU Delft, 2025.</p>
  </div>;
}
