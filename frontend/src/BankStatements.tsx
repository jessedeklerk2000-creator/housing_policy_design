// ALM Reporting (25 Nov 2026): the bank's financial statements and metrics, live at the canvas's time cursor.
// Structure after Q. Emanuels' DynaBI statement network (statement blocks of sections and accounts; each account opens
// into its formula, inputs and source); content after Menkveld (2025) Fig. 2-2/2-3 and the bank netlist
// (backend/housing/bank_ledger.py). Values in model units (mortgage book 100 at the start), flows per year.
import { useContext, useState, type ReactElement } from 'react';
import { AtContext, readTrace } from './ModelMap';
import type { Ledger } from './types';

const TOTALS = new Set(['assets', 'liabilities', 'liab_equity', 'interest_income', 'interest_expense', 'nii', 'net_profit', 'retained', 'equity', 'tier1', 'nsfr', 'cf_operating', 'cf_financing', 'cf_net']);
const CHECKS = new Set(['balance_check', 'equity_check', 'cf_check']);
const MINUS: Record<string, string[]> = {
  nii: ['interest_expense'], net_profit: ['impairments'], retained: ['dividend'], retained_cum: ['dividend_cum'], balance_check: ['liab_equity'], equity_check: ['equity'], cf_check: ['reserves'],
};
// A9 (M. Mendel): calmer statements. Hidden until "show all lines": the checks, lines that are zero over the whole run,
// and the intermediate metrics (each still reachable by opening the ratio it feeds)
const DETAIL = new Set(['rw_mortgages', 'rwa', 'asf', 'rsf']);
const RATIO_OVER: Record<string, string> = { tier1: 'rwa', nsfr: 'rsf', leverage: 'assets', roe: 'equity', ltd: 'savings' };

// The signals from the statements into the metrics (what ALM Reporting reads off the sheet)
export const KEY_INPUTS: [string, string][] = [['equity', 'equity'], ['mortgages', 'mortgages'], ['firm_loans', 'loans to firms'], ['savings', 'savings'], ['interbank', 'other banks'], ['assets', 'total assets'], ['net_profit', 'net profit']];

export function BankStatements({ part = 'all', only }: { part?: 'all' | 'statements' | 'ratios'; only?: string }) {
  const { result, at } = useContext(AtContext);
  const [all, setAll] = useState(false), [open, setOpen] = useState<Set<string>>(new Set()), [plots, setPlots] = useState<Set<string>>(new Set()), [drag, setDrag] = useState<Record<string, [number, number]>>({});
  const L: Ledger | undefined = result?.ledger;
  if (!result || !L) return <div className="stmt-empty">Run the simulation to see the statements.</div>;
  const val = (id: string) => { const t = readTrace(result, 'Ledger:' + id); return t ? t[at] : undefined; };
  const series = (id: string) => readTrace(result, 'Ledger:' + id) ?? [];
  const unit = (id: string) => L.accounts[id]?.unit ?? '';
  const show = (id: string, x?: number) => x === undefined || x === null ? '–'
    : unit(id).startsWith('%') ? `${x.toFixed(2)}%` : unit(id) === 'pp' ? `${x.toFixed(2)} pp` : (Math.abs(x) < 0.005 ? '0.00' : (x < 0 ? '−' : '') + Math.abs(x).toFixed(2));
  const flip = (set: typeof setOpen) => (k: string) => set(o => { const n = new Set(o); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const toggle = flip(setOpen), togglePlot = flip(setPlots);
  const year = result.year[at];

  const row = (id: string, path: string, depth: number, op = ''): ReactElement => {
    const a = L.accounts[id], x = val(id), k = path + '/' + id, isOpen = open.has(k), check = CHECKS.has(id);
    // bar: share of the largest value of this account over the run (same idea as DynaBI's account bars)
    // A10: one fixed scale over the run (max |value|); an account that never changes sign uses the whole width, so the
    // bar moves twice as far for the same change
    const s = series(id), scale = Math.max(1e-9, ...s.map(v => Math.abs(v ?? 0))), both = s.some(v => (v ?? 0) < -1e-9) && s.some(v => (v ?? 0) > 1e-9);
    const half = both ? 50 : 100, w = check ? 0 : Math.min(half, Math.abs(x ?? 0) / scale * half), left = both ? ((x ?? 0) < 0 ? 50 - w : 50) : (x ?? 0) < 0 ? 100 - w : 0;
    // B1: a DNB threshold: the value red below its minimum (ok = undefined: no verdict, as for normal lines)
    const ok = check ? Math.abs(x ?? 0) < 0.01 : a.minimum !== undefined && x != null && x < a.minimum ? false : undefined;
    // a plotted value: the plot to the right of its line (Jesse, 25 Nov 2026)
    return <div key={k} className={'stmt-entry' + (depth ? ' sub' : '')}>
      <div className={'stmt-line' + (plots.has(k) ? ' plotted' : '')}><button className={'stmt-row' + (TOTALS.has(id) && !depth ? ' total' : '') + (check ? ' check' : '')} onClick={() => toggle(k)} title={a.formula}>
        <span className="stmt-op">{op}</span>
        <span className="stmt-label">{a.label}</span>
        <span className="stmt-bar">{depth === 0 && !check && <i className={(x ?? 0) < 0 ? 'neg' : ''} style={{ left: `${left}%`, width: `${w}%` }}/>}</span>
        <b className={'stmt-val' + (ok === undefined ? '' : ok ? ' ok' : ' bad') + (plots.has(k) ? ' plotted' : '')} role="button" title="Click to plot over time" onClick={ev => { ev.stopPropagation(); togglePlot(k); }}>{show(id, x)}{check && ok !== undefined && (ok ? ' ✓' : ' ✗')}</b>
        <span className="stmt-fold">{isOpen ? '−' : '+'}</span>
      </button>
      {plots.has(k) && <div className="stmt-plot-card nodrag nopan" style={drag[k] ? { transform: `translate(${drag[k][0]}px, ${drag[k][1]}px)` } : undefined}>
        {/* header: the item; drag it to move the card (Jesse) */}
        <div className="stmt-plot-head" onPointerDown={ev => { ev.stopPropagation(); ev.preventDefault(); const el = ev.currentTarget, card = el.parentElement!, z = card.getBoundingClientRect().width / card.offsetWidth || 1;
          const x0 = ev.clientX, y0 = ev.clientY, d0 = drag[k] ?? [0, 0]; el.setPointerCapture(ev.pointerId);
          const move = (e: PointerEvent) => setDrag(o => ({ ...o, [k]: [d0[0] + (e.clientX - x0) / z, d0[1] + (e.clientY - y0) / z] }));
          const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); };
          el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); }}>
          <b>{a.label}</b><button aria-label={`Close plot ${a.label}`} onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); togglePlot(k); }}>×</button></div>
        <StmtPlot y={s} at={at} years={result.year} unit={a.unit} label={a.label} min={a.minimum}/></div>}</div>
      {isOpen && <div className="stmt-drill">
        <div className="stmt-formula">{a.label} = {a.formula}</div>
        {a.inputs.filter(i => L.accounts[i]).map(i => row(i, k, depth + 1, RATIO_OVER[id] === i ? '÷' : MINUS[id]?.includes(i) ? '−' : '+'))}
        <div className="stmt-source">{a.unit} · {a.source}{a.minimum !== undefined ? ` · minimum ${a.minimum}% (DNB threshold)` : ''}{a.note ? ` · ${a.note}` : ''}</div>
      </div>}
    </div>;
  };
  const zeroRun = (id: string) => series(id).every(v => Math.abs(v ?? 0) < 1e-6);
  const shown = (id: string) => all || !(CHECKS.has(id) || DETAIL.has(id) || zeroRun(id));
  const more = (ids: string[]) => { const n = ids.filter(id => CHECKS.has(id) || DETAIL.has(id) || zeroRun(id)).length;
    return n ? <button className="stmt-more" onClick={() => setAll(a => !a)}>{all ? 'Show fewer lines' : `Show all lines (${n} more)`}</button> : null; };
  const block = (gid: string) => {
    const g = L.groups.find(x => x.id === gid); if (!g) return null;  // e.g. the equity statement, removed 26 Nov 2026
    const ids = g.sections.flatMap(x => x.accounts);
    if (gid === 'balance') {
      const side = (s: string) => g.sections.filter(x => x.side === s);
      return <article className="stmt-block stmt-balance" key={gid}>
        <h4>{g.label}</h4>
        <div className="stmt-cols">
          <div><div className="stmt-side">Assets</div>{side('debit').map(sec => <section key={sec.label}>{sec.accounts.filter(shown).map(a => row(a, gid, 0))}</section>)}</div>
          <div><div className="stmt-side">Liabilities and equity</div>{side('credit').map(sec => <section key={sec.label}>{sec.accounts.filter(shown).map(a => row(a, gid, 0))}</section>)}</div>
        </div>
        {side('').map(sec => <section key={sec.label}>{sec.accounts.filter(shown).map(a => row(a, gid, 0))}</section>)}
        {more(ids)}
      </article>;
    }
    return <article className={'stmt-block stmt-' + gid} key={gid}>
      <h4>{g.label}{gid === 'income' ? <small> · per year</small> : gid === 'equity' ? <small> · since the start</small> : null}</h4>
      {g.sections.map(sec => { const acc = sec.accounts.filter(shown); return acc.length ? <section key={sec.label}><div className="stmt-sec">{sec.label}</div>{acc.map(a => row(a, gid, 0))}</section> : null; })}
      {more(ids)}
    </article>;
  };
  const link = (from: string, to: string) => { const l = L.links.find(x => x[0] === from && x[1] === to); return l ? <div className="stmt-link">{l[2]} →</div> : null; };
  if (only) return <div className="bank-statements single nodrag">{block(only)}</div>;
  if (part === 'ratios') return <div className="bank-statements key-only nodrag nowheel">{block('ratios')}</div>;
  const signals = <div className="stmt-signals" aria-label="Signals into the metrics">
    {KEY_INPUTS.map(([id, name]) => <div key={id} className="stmt-signal"><span>{name}</span><b>{show(id, val(id))}</b><i/></div>)}
  </div>;
  return <div className="bank-statements nodrag nowheel">
    <div className="stmt-head"><b>Financial statements · {year.toFixed(1)}</b><small>Model units (mortgage book 100 at the start). Click a line for its formula and source, a number to plot it. {L.basis}</small></div>
    <div className={'stmt-grid' + (part === 'statements' ? ' no-key' : '')}>
      <div className="stmt-col">{block('income')}{block('equity')}{L.groups.some(g => g.id === 'cashflow') && block('cashflow')}</div>
      <div className="stmt-col">{link('income', 'balance')}{block('balance')}</div>
      {part === 'all' && <>{signals}<div className="stmt-col stmt-key">{block('ratios')}</div></>}
    </div>
  </div>;
}

/** A line over the run with the Play cursor (clicked number on a statement). */
export function StmtPlot({ y, at, years, unit, label, min }: { y: (number | null)[]; at: number; years: number[]; unit: string; label: string; min?: number }) {
  const W = 330, H = 96, pad = 6, ok = y.map(v => v ?? NaN), fin = ok.filter(Number.isFinite);
  if (!fin.length) return null;
  let lo = Math.min(...fin, ...(min !== undefined ? [min] : [])), hi = Math.max(...fin, ...(min !== undefined ? [min] : [])); if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
  const m = (hi - lo) * 0.1; lo -= m; hi += m;
  const sx = (i: number) => pad + i / (y.length - 1) * (W - 2 * pad), sy = (v: number) => H - 16 - (v - lo) / (hi - lo) * (H - 26);
  const pts = (a: number, b: number) => ok.slice(a, b).map((v, i) => Number.isFinite(v) ? `${sx(a + i)},${sy(v)}` : '').filter(Boolean).join(' ');
  const f = (v: number) => Math.abs(v) >= 100 ? v.toFixed(1) : v.toFixed(2);
  return <div className="stmt-plot"><svg width={W} height={H} role="img" aria-label={`${label} over time`}>
    {lo < 0 && hi > 0 && <line x1={pad} x2={W - pad} y1={sy(0)} y2={sy(0)} stroke="#d5dbd8"/>}
    {min !== undefined && <g><line x1={pad} x2={W - pad} y1={sy(min)} y2={sy(min)} stroke="#c0392b" strokeDasharray="4 3"/><text x={pad + 2} y={sy(min) - 3} className="mini-tick" fill="#c0392b">minimum {min}%</text></g>}
    <polyline fill="none" style={{ stroke: "var(--plot, #3f9a1f)" }} strokeOpacity={0.25} strokeWidth={2} points={pts(0, y.length)}/>
    <polyline fill="none" style={{ stroke: "var(--plot, #3f9a1f)" }} strokeWidth={2} points={pts(0, at + 1)}/>
    {Number.isFinite(ok[at]) && <circle cx={sx(at)} cy={sy(ok[at])} r={3.5} style={{ fill: "var(--plot, #3f9a1f)" }}/>}
    <text x={W - pad} y={11} textAnchor="end" className="mini-tick">{f(hi - m)}</text><text x={W - pad} y={H - 18} textAnchor="end" className="mini-tick">{f(lo + m)}</text>
    <text x={pad} y={H - 3} className="mini-tick">{years[0].toFixed(0)}</text><text x={W - pad} y={H - 3} textAnchor="end" className="mini-tick">{years[years.length - 1].toFixed(0)}</text>
  </svg><small>{unit}</small></div>;
}
