import { useEffect, useMemo, useRef, useState } from 'react';
import { LoaderCircle, Play, Wand2 } from 'lucide-react';
import { api } from './api';

// ---------- types
export type K3 = [number, number, number];
export interface Design { K: K3; filtered: boolean; settling: number; overshoot: number; minCycle?: number | null }  // minCycle: shortest allowed cycle in years, null = no limit
export interface PoleRow { re: number; im: number; decay_rate: number; settling_yr: number | null; cycle_yr: number | null; damping: number; inside?: boolean; shift?: number; zero_dist?: number; pinned?: boolean }
interface Overview {
  op_year: number; presets: Record<string, { label: string; K: K3 }>; ultimate: { Ku: number; Pu_yr: number; zn: K3 } | null; wf: number;
  open_loop: { re: number; im: number }[]; fixed: { re: number; im: number }[]; plant_zeros: { re: number; im: number }[];
  locus: { gains: number[]; poles: { re: number; im: number }[][] }; cycle_yr: number[]; WP: number[]; WT: number[]; ks_limit: number;
}
interface Evaluation { poles: PoleRow[]; stable: boolean; outside: number; sigma_min: number; zeta_min: number; S: number[]; T: number[]; KS: number[]; peaks: Record<'S' | 'T' | 'KS', number>; limits: Record<'S' | 'T' | 'KS', number> }
export interface Transfer { input: string; output: string; feedback: boolean; cycle_yr: number[]; gain: number[]; phase_deg: number[]; step_years: number[]; step: number[]; poles: PoleRow[]; zeros: PoleRow[]; integrators: number; long_run_gain: number | null }
export type Pick = { kind: 'flow' | 'signal' | 'element'; id: string; label: string };

// The job each curve checks, next to its name (Jesse's choice, 11 Nov 2026).
const ECON = { S: 'shock rejection', T: 'robustness to model error', KS: 'policy effort' };
export const COLORS = { hinf: '#145a32', zn: '#7cc96a', design: '#2F6FB5', spec: '#E8642B', S: '#00A6D6', T: '#6D1780', KS: '#E8642B', price: '#3f9a1f', subsidy: '#1f6fc4' };
const num = (v: number, d = 2) => v.toLocaleString('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d });
export const specFrom = (settling: number, overshoot: number) => { const lo = Math.log(overshoot / 100); return { sigma: 4 / settling, zeta: -lo / Math.sqrt(Math.PI ** 2 + lo ** 2) }; };
const overshootOf = (zeta: number) => 100 * Math.exp(-Math.PI * zeta / Math.sqrt(1 - zeta ** 2));

let overviewCache: Promise<Overview> | null = null;
export const getOverview = () => (overviewCache ??= api<Overview>('/analysis/overview').catch(e => { overviewCache = null; throw e; }));

/** Calls fn after the inputs have been still for a moment; drops answers that arrive out of order. */
function useDebounced<T>(fn: () => Promise<T>, deps: unknown[], delay = 140) {
  const [value, setValue] = useState<T>(); const [error, setError] = useState(''); const turn = useRef(0);
  useEffect(() => {
    const mine = ++turn.current;
    const t = window.setTimeout(() => { fn().then(v => { if (mine === turn.current) { setValue(v); setError(''); } }).catch(e => { if (mine === turn.current) setError((e as Error).message); }); }, delay);
    return () => clearTimeout(t);
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return { value, error };
}

// ---------- generic plot with a cycle-length axis
export interface Trace { name: string; x: number[]; y: number[]; color: string; dash?: string; width?: number; fill?: string; fillcolor?: string; showlegend?: boolean; opacity?: number; hover?: boolean }
export function Plot({ traces, height = 260, xTitle, yTitle, logX = false, logY = false, reverseX = false, xRange, yRange, shapes = [], notes = [], label, legendY = -0.3, compact = false }: { compact?: boolean; legendY?: number; traces: Trace[]; height?: number; xTitle: string; yTitle: string; logX?: boolean; logY?: boolean; reverseX?: boolean; xRange?: [number, number]; yRange?: [number, number]; shapes?: object[]; notes?: object[]; label: string }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true; const node = box.current;
    void import('plotly.js-dist-min').then(({ default: Plotly }) => {
      if (!live || !node) return;
      const range = (r: [number, number] | undefined, log: boolean) => r && (log ? r.map(Math.log10) : r);
      const xr = range(xRange, logX);
      Plotly.react(node, traces.map(t => ({ type: 'scatter', mode: 'lines', name: t.name, x: t.x, y: t.y, opacity: t.opacity ?? 1, showlegend: t.showlegend ?? true, fill: t.fill, fillcolor: t.fillcolor,
        line: { color: t.color, dash: t.dash ?? 'solid', width: t.width ?? 2.4 }, hoverinfo: t.hover === false ? 'skip' : undefined, hovertemplate: t.hover === false ? undefined : `%{x:.2f} → %{y:.3g}<extra>${t.name}</extra>` })), {
        height, margin: compact ? { l: 46, r: 8, t: 4, b: 34 } : { l: 62, r: 14, t: 6, b: 48 }, paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)', font: { family: 'Inter, system-ui, sans-serif', size: compact ? 10 : 12, color: '#3c4a45' }, showlegend: !compact && traces.filter(t => t.showlegend ?? true).length > 1,
        legend: { orientation: 'h', y: legendY, yanchor: 'top' }, hovermode: 'closest', shapes, annotations: notes,
        xaxis: { title: { text: xTitle }, type: logX ? 'log' : 'linear', gridcolor: '#e8ece9', zeroline: false, range: xr && (reverseX ? [xr[1], xr[0]] : xr), autorange: xr ? false : reverseX ? 'reversed' : true, ...(logX ? { tickvals: [0.2, 0.5, 1, 2, 5, 10, 20, 50, 100], ticktext: ['0.2', '0.5', '1', '2', '5', '10', '20', '50', '100'] } : {}) },
        yaxis: { title: { text: yTitle }, type: logY ? 'log' : 'linear', gridcolor: '#e8ece9', zerolinecolor: '#aab5b0', range: range(yRange, logY), exponentformat: 'power', ...(logY ? { dtick: 1 } : {}) },
      }, { displayModeBar: false, responsive: true });
    });
    return () => { live = false; };
  }, [traces, height, xTitle, yTitle, logX, logY, reverseX, xRange, yRange, shapes, notes, compact, legendY]);
  return <div ref={box} style={{ minHeight: height }} role="img" aria-label={label}/>;
}
const within = (cyc: number[], ys: number[], lo: number, hi: number) => { const x: number[] = [], y: number[] = []; cyc.forEach((c, i) => { if (c >= lo && c <= hi) { x.push(c); y.push(ys[i]); } }); return { x, y }; };

// ---------- transfer function panel (used by the model map)
export function TransferPanel({ input, output, feedback, K, filtered, swap, clear }: { input?: Pick; output?: Pick; feedback: boolean; K: K3; filtered: boolean; swap: () => void; clear: () => void }) {
  const ready = !!input && !!output;
  const { value: tf, error } = useDebounced(() => ready ? api<Transfer>('/analysis/transfer', { input: { kind: input!.kind, id: input!.id }, output: { kind: output!.kind, id: output!.id }, feedback, K, filtered }) : Promise.resolve(undefined), [input?.id, input?.kind, output?.id, output?.kind, feedback, K.join(), filtered], 60);
  const view = tf && ready && tf.feedback === feedback ? tf : undefined;
  return <>
    <p className="eyebrow">Transfer function · {feedback ? 'closed loop' : 'open loop'}</p><h3>How one flow moves another</h3>
    <div className="tf-picks"><div><span>Input</span><strong>{input?.label ?? 'Right-click a flow, shock or subsidy'}</strong></div><div><span>Output</span><strong>{output?.label ?? 'Right-click a flow, price or component'}</strong></div></div>
    <div className="row"><button className="ghost small" disabled={!ready} onClick={swap}>Swap</button><button className="ghost small" onClick={clear}>Clear</button></div>
    {error && <p className="state-note">{error}</p>}
    {!ready && <p className="muted">Right-click a port pair, a shock arrow or a subsidy arrow and choose <b>Use as input</b>. Then right-click a second item and choose <b>Use as output</b>.</p>}
    {ready && !view && !error && <p className="muted"><LoaderCircle className="spin" size={14}/> Computing…</p>}
    {view && <TransferView tf={view}/>}
  </>;
}
export function TransferView({ tf }: { tf: Transfer }) {
  const g = within(tf.cycle_yr, tf.gain, 0.2, 100), ph = within(tf.cycle_yr, tf.phase_deg, 0.2, 100);
  const slow = tf.poles.filter(p => p.cycle_yr === null || p.cycle_yr > 0.3).slice(0, 8);
  return <>
    <p className="muted">From <b>{tf.input}</b> to <b>{tf.output}</b>. {tf.long_run_gain !== null ? <>A permanent change of 1 in the input changes the output by <b>{num(tf.long_run_gain, 3)}</b> in the long run.</> : <>The output keeps drifting after a permanent change: the path contains {tf.integrators} accumulator{tf.integrators > 1 ? 's' : ''}.</>}</p>
    <Plot label="Gain against cycle length" traces={[{ name: 'Gain', ...g, color: '#1f2a26' }]} height={200} xTitle="Cycle length of the input [years]" yTitle="Gain" logX logY reverseX/>
    <Plot label="Phase against cycle length" traces={[{ name: 'Phase', ...ph, color: '#8a9692' }]} height={160} xTitle="Cycle length [years]" yTitle="Phase [°]" logX reverseX/>
    <Plot label="Step response" traces={[{ name: 'Response to a permanent change of 1', x: tf.step_years, y: tf.step, color: '#3f9a1f' }]} height={200} xTitle="Years after the change" yTitle="Change in output"/>
    <h4>Poles of this path</h4>
    <table className="pole-table"><thead><tr><th>Cycle</th><th>Settles in</th><th>Damping</th></tr></thead><tbody>
      {slow.map((p, i) => <tr key={i}><td>{p.cycle_yr ? `${num(p.cycle_yr, 1)} yr` : 'no cycle'}</td><td>{p.settling_yr ? `${num(p.settling_yr, 1)} yr` : '—'}</td><td>{num(p.damping, 2)}</td></tr>)}
    </tbody></table>
    <p className="muted small">{tf.poles.length} poles and {tf.zeros.length} zeros after cancelling the parts this input cannot reach. Linear model of the run netlist, linearised around {2015}.</p>
  </>;
}

// ---------- pole plot with lines you can drag
const X0 = -6, X1 = 0.6, Y1 = 13, PW = 640, PH = 500, M = { l: 54, r: 14, t: 12, b: 42 };
const sx = (re: number) => M.l + (re - X0) / (X1 - X0) * (PW - M.l - M.r);
const sy = (im: number) => M.t + (Y1 - im) / (2 * Y1) * (PH - M.t - M.b);
function PolePlot({ ev, ov, spec, setSpec, showLocus, showOpen, showZeros }: { ev?: Evaluation; ov: Overview; spec: { settling: number; overshoot: number; minCycle?: number | null }; setSpec: (s: { settling: number; overshoot: number; minCycle?: number | null }) => void; showLocus: boolean; showOpen: boolean; showZeros: boolean }) {
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<'line' | 'wedge' | 'cycle' | null>(null);
  const [hover, setHover] = useState<PoleRow | null>(null);
  const { sigma, zeta } = specFrom(spec.settling, spec.overshoot), t = Math.tan(Math.acos(zeta));
  const toData = (e: React.PointerEvent) => { const m = svg.current!.getScreenCTM()!.inverse(), p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m); return { re: X0 + (p.x - M.l) / (PW - M.l - M.r) * (X1 - X0), im: Y1 - (p.y - M.t) / (PH - M.t - M.b) * 2 * Y1 }; };
  const move = (e: React.PointerEvent) => {
    if (!drag) return; const { re, im } = toData(e);
    if (drag === 'cycle') { setSpec({ ...spec, minCycle: Math.min(30, Math.max(0.5, Math.round(2 * Math.PI / Math.max(0.21, Math.abs(im)) * 10) / 10)) }); return; }
    if (drag === 'line') setSpec({ ...spec, settling: Math.min(30, Math.max(0.5, Math.round(4 / Math.max(0.134, -re) * 10) / 10)) });
    else { const angle = Math.atan2(Math.abs(im), Math.max(1e-3, -re)), z = Math.cos(Math.min(1.5, Math.max(0.05, angle))); setSpec({ ...spec, overshoot: Math.min(90, Math.max(1, Math.round(overshootOf(z)))) }); }
  };
  const far = 60, region = `M${sx(-sigma)} ${sy(sigma * t)}L${sx(-far)} ${sy(far * t)}L${sx(-far)} ${sy(-far * t)}L${sx(-sigma)} ${sy(-sigma * t)}Z`;
  const handleR = 4.5, hx = -handleR * Math.cos(Math.acos(zeta)), hy = handleR * Math.sin(Math.acos(zeta));
  const ticks = [0.5, 1, 2, 5].map(c => 2 * Math.PI / c);
  const cross = (re: number, im: number, cls: string, key: string, r = 7) => <path key={key} className={cls} d={`M${sx(re) - r} ${sy(im) - r}L${sx(re) + r} ${sy(im) + r}M${sx(re) - r} ${sy(im) + r}L${sx(re) + r} ${sy(im) - r}`}/>;
  const visible = (p: { re: number; im: number }) => p.re >= X0 && p.re <= X1 && Math.abs(p.im) <= Y1;
  const offscreen = ev ? ev.poles.filter(p => !visible(p)).length : 0;
  // Dominant closed-loop pair: the slowest oscillating pole the gains can move (pinned plant poles excluded).
  // A dashed horizontal line to the axis gives its cycle length, as in the identification plot.
  const dom = ev?.poles.filter(p => p.im > 1e-3 && !p.pinned && visible(p)).sort((a, b) => b.re - a.re)[0];
  return <div className="pole-plot-wrap">
    <svg ref={svg} className={'pole-plot' + (drag ? ' dragging' : '')} viewBox={`0 0 ${PW} ${PH}`} role="img" aria-label="Closed-loop poles against the two lines" onPointerMove={move} onPointerUp={() => setDrag(null)} onPointerLeave={() => setDrag(null)}>
      <defs><clipPath id="plot-area"><rect x={M.l} y={M.t} width={PW - M.l - M.r} height={PH - M.t - M.b}/></clipPath></defs>
      <rect x={M.l} y={M.t} width={PW - M.l - M.r} height={PH - M.t - M.b} className="pp-bg"/>
      <g clipPath="url(#plot-area)">
        <rect x={sx(0)} y={M.t} width={sx(X1) - sx(0)} height={PH - M.t - M.b} className="pp-unstable"/>
        {spec.minCycle ? <><clipPath id="cycle-band"><rect x={M.l} width={PW - M.l - M.r} y={sy(2 * Math.PI / spec.minCycle)} height={Math.max(0, sy(-2 * Math.PI / spec.minCycle) - sy(2 * Math.PI / spec.minCycle))}/></clipPath>
          <path d={region} className="pp-allowed" clipPath="url(#cycle-band)"/></> : <path d={region} className="pp-allowed"/>}
        {ticks.map(w => [w, -w].map(y => <line key={y} x1={M.l} x2={PW - M.r} y1={sy(y)} y2={sy(y)} className="pp-grid"/>))}
        {[-5, -4, -3, -2, -1].map(x => <line key={x} x1={sx(x)} x2={sx(x)} y1={M.t} y2={PH - M.b} className="pp-grid"/>)}
        <line x1={M.l} x2={PW - M.r} y1={sy(0)} y2={sy(0)} className="pp-axis"/><line x1={sx(0)} x2={sx(0)} y1={M.t} y2={PH - M.b} className="pp-axis strong"/>
        {showLocus && ov.locus.poles.map((ps, i) => ps.filter(visible).map((p, j) => <circle key={`${i}-${j}`} cx={sx(p.re)} cy={sy(p.im)} r={1.3} className="pp-locus"/>))}
        {showOpen && ov.open_loop.filter(visible).map((p, i) => cross(p.re, p.im, 'pp-open', `o${i}`, 5))}
        {showZeros && ov.plant_zeros.filter(visible).map((z, i) => <circle key={`z${i}`} cx={sx(z.re)} cy={sy(z.im)} r={6} className="pp-zero"/>)}
        {ov.fixed.filter(visible).map((p, i) => <circle key={`f${i}`} cx={sx(p.re)} cy={sy(p.im)} r={10} className="pp-fixed"/>)}
        {/* spec lines */}
        <path d={`M${sx(0)} ${sy(0)}L${sx(-far)} ${sy(far * t)}M${sx(0)} ${sy(0)}L${sx(-far)} ${sy(-far * t)}`} className="pp-spec"/>
        <line x1={sx(-sigma)} x2={sx(-sigma)} y1={M.t} y2={PH - M.b} className="pp-spec"/>
        <line x1={sx(-sigma)} x2={sx(-sigma)} y1={M.t} y2={PH - M.b} className="pp-grab" onPointerDown={e => { (e.target as Element).setPointerCapture?.(e.pointerId); setDrag('line'); }}/>
        <path d={`M${sx(0)} ${sy(0)}L${sx(-far)} ${sy(far * t)}`} className="pp-grab" onPointerDown={() => setDrag('wedge')}/>
        {ev?.poles.filter(visible).map((p, i) => <g key={`p${i}`} onPointerEnter={() => setHover(p)} onPointerLeave={() => setHover(null)}>{p.pinned && <circle cx={sx(p.re)} cy={sy(p.im)} r={13} className="pp-pin"/>}{cross(p.re, p.im, p.inside ? 'pp-pole in' : 'pp-pole out', `x${i}`)}{p.pinned && p.im > 0 && <text x={sx(p.re) + 16} y={sy(p.im) - 10} className="pp-pin-label">pinned</text>}<circle cx={sx(p.re)} cy={sy(p.im)} r={12} className="pp-hit"/></g>)}
      </g>
      <circle cx={sx(-sigma)} cy={M.t + 16} r={9} className="pp-handle" role="slider" aria-label="Settling-time line" aria-valuenow={spec.settling} tabIndex={0}
        onKeyDown={e => { if (e.key === 'ArrowLeft') setSpec({ ...spec, settling: Math.max(0.5, +(spec.settling - 0.1).toFixed(1)) }); if (e.key === 'ArrowRight') setSpec({ ...spec, settling: Math.min(30, +(spec.settling + 0.1).toFixed(1)) }); }}
        onPointerDown={() => setDrag('line')}/>
      <circle cx={sx(hx)} cy={sy(hy)} r={9} className="pp-handle" role="slider" aria-label="Overshoot wedge" aria-valuenow={spec.overshoot} tabIndex={0}
        onKeyDown={e => { if (e.key === 'ArrowUp') setSpec({ ...spec, overshoot: Math.min(90, spec.overshoot + 1) }); if (e.key === 'ArrowDown') setSpec({ ...spec, overshoot: Math.max(1, spec.overshoot - 1) }); }}
        onPointerDown={() => setDrag('wedge')}/>
      <text x={sx(-sigma) - 6} y={PH - M.b - 8} className="pp-spec-label" textAnchor="end">adjustment rate: shocks gone in {num(spec.settling, 1)} yr</text>
      <text x={sx(hx) - 14} y={sy(hy) - 12} className="pp-spec-label" textAnchor="end">overshoot ≤ {num(spec.overshoot, 0)}%</text>
      {spec.minCycle && 2 * Math.PI / spec.minCycle < Y1 && <g>{[1, -1].map(s => <line key={s} x1={M.l} x2={sx(0)} y1={sy(s * 2 * Math.PI / spec.minCycle!)} y2={sy(s * 2 * Math.PI / spec.minCycle!)} className="pp-spec"/>)}
        {[1, -1].map(s => <line key={'g' + s} x1={M.l} x2={sx(0)} y1={sy(s * 2 * Math.PI / spec.minCycle!)} y2={sy(s * 2 * Math.PI / spec.minCycle!)} className="pp-grab" onPointerDown={e => { (e.target as Element).setPointerCapture?.(e.pointerId); setDrag('cycle'); }}/>)}
        <circle cx={M.l + 22} cy={sy(2 * Math.PI / spec.minCycle)} r={9} className="pp-handle" role="slider" aria-label="Shortest cycle line" aria-valuenow={spec.minCycle} tabIndex={0} onPointerDown={() => setDrag('cycle')}
          onKeyDown={e => { if (e.key === 'ArrowUp') setSpec({ ...spec, minCycle: Math.max(0.5, +(spec.minCycle! - 0.1).toFixed(1)) }); if (e.key === 'ArrowDown') setSpec({ ...spec, minCycle: Math.min(30, +(spec.minCycle! + 0.1).toFixed(1)) }); }}/>
        <text x={M.l + 36} y={sy(2 * Math.PI / spec.minCycle) - 6} className="pp-spec-label">shortest cycle {num(spec.minCycle, 1)} yr</text></g>}
      {dom && <g className="pp-dom"><line x1={M.l} x2={sx(dom.re)} y1={sy(dom.im)} y2={sy(dom.im)} className="pp-dom-line"/>
        <text x={M.l + 6} y={sy(dom.im) - 6} className="pp-dom-label">cycle {num(2 * Math.PI / dom.im, 1)} yr</text></g>}
      <text x={sx(0.5)} y={M.t + 40} className="pp-unstable-label" transform={`rotate(-90 ${sx(0.5)} ${M.t + 40})`} textAnchor="end">unstable</text>
      <text x={M.l + 10} y={PH - M.b - 10} className="pp-allowed-label">admissible</text>
      {[-6, -5, -4, -3, -2, -1, 0].map(x => <text key={x} x={sx(x)} y={PH - M.b + 16} textAnchor="middle" className="pp-tick">{x}</text>)}
      {[0.5, 1, 2, 5].flatMap(c => [1, -1].map(s => <text key={c * s} x={M.l - 6} y={sy(s * 2 * Math.PI / c) + 4} textAnchor="end" className="pp-tick">{c}</text>))}
      <text x={(PW + M.l) / 2} y={PH - 6} textAnchor="middle" className="pp-axis-title">Decay rate [1/year] (left = faster)</text>
      <text x={14} y={PH / 2} textAnchor="middle" className="pp-axis-title" transform={`rotate(-90 14 ${PH / 2})`}>Cycle length [years]</text>
    </svg>
    <div className="pp-tip" aria-live="polite">{hover ? <>Cycle {hover.cycle_yr ? `${num(hover.cycle_yr, 2)} yr` : 'none'} · settles in {hover.settling_yr ? `${num(hover.settling_yr, 1)} yr` : '—'} · damping {num(hover.damping, 2)}{hover.damping < 1 && hover.damping > 0 ? ` · overshoot ${num(overshootOf(hover.damping), 0)}%` : ''} · {hover.inside ? 'inside the lines' : 'outside the lines'}{hover.shift !== undefined && <> · moves {num(hover.shift, 2)}/yr if all gains double</>}{hover.pinned && <> · <b>pinned</b>: a zero sits {num(hover.zero_dist ?? 0, 2)} away, so the subsidy hardly reaches this cycle</>}</> : <>Drag the vertical line or the upper ray. Hover a pole to read it. {offscreen > 0 && `${offscreen} fast pole${offscreen > 1 ? 's' : ''} lie left of the plot.`}</>}</div>
  </div>;
}

function LogSlider({ label, value, lo, hi, onChange }: { label: string; value: number; lo: number; hi: number; onChange: (v: number) => void }) {
  const pos = Math.round(Math.log(Math.max(lo, value) / lo) / Math.log(hi / lo) * 1000);
  return <label className="slider"><span className="slider-head"><span>{label}</span><output>{num(value, 3)}</output></span>
    <input type="range" min={0} max={1000} value={pos} aria-label={label} onChange={e => onChange(+(lo * (hi / lo) ** (Number(e.target.value) / 1000)).toPrecision(4))}/></label>;
}
function Light({ ok, label, value }: { ok: boolean; label: string; value: string }) { return <div className={'light ' + (ok ? 'ok' : 'bad')}><span aria-hidden="true"/>{label}<b>{value}</b></div>; }

const SHOCK_CHOICES = [['d_crisis', 'Financial crisis shock'], ['d_covid', 'Covid shock'], ['d_income', 'Income'], ['d_mortgages', 'Mortgage lending'], ['d_interest', 'Mortgage interest rate']] as const;

export function PoleDesign({ design, setDesign, useInSimulation }: { design: Design; setDesign: (d: Design) => void; useInSimulation: () => void }) {
  const [ov, setOv] = useState<Overview>(); const [err, setErr] = useState('');
  const [showLocus, setShowLocus] = useState(false), [showOpen, setShowOpen] = useState(true), [showZeros, setShowZeros] = useState(true);
  const [withS, setWithS] = useState(false), [tuning, setTuning] = useState(''), [shock, setShock] = useState<string>('d_crisis');
  useEffect(() => { getOverview().then(setOv).catch(e => setErr(e.message)); }, []);
  const { value: ev, error } = useDebounced(() => api<Evaluation>('/analysis/evaluate', { K: design.K, filtered: design.filtered, settling_yr: design.settling, overshoot_pct: design.overshoot, min_cycle_yr: design.minCycle ?? null }), [design.K.join(), design.filtered, design.settling, design.overshoot, design.minCycle], 80);
  const resp = useDebounced(async () => {
    const q = (feedback: boolean, output: object) => api<Transfer>('/analysis/transfer', { input: { kind: 'signal', id: shock }, output, feedback, K: design.K, filtered: design.filtered });
    const [price, subsidy, none] = await Promise.all([q(true, { kind: 'signal', id: 'y_price' }), q(true, { kind: 'flow', id: 'owner_subsidy' }), q(false, { kind: 'signal', id: 'y_price' })]);
    return { price, subsidy, none };
  }, [design.K.join(), design.filtered, shock], 200);
  const setK = (i: number, v: number) => { const K = [...design.K] as K3; K[i] = v; setDesign({ ...design, K }); };
  const tune = async () => {
    setTuning('Searching…');
    try { const r = await api<{ K: K3; met: boolean; violation: number }>('/analysis/tune', { settling_yr: design.settling, overshoot_pct: design.overshoot, min_cycle_yr: design.minCycle ?? null, with_S: withS, filtered: design.filtered }); setDesign({ ...design, K: r.K.map(v => +v.toPrecision(4)) as K3 }); setTuning(r.met ? 'Found gains that put every pole inside your lines.' : 'No gains meet these lines. Shown: the closest found.'); }
    catch (e) { setTuning((e as Error).message); }
  };
  if (err) return <div role="alert" className="notice bad">{err}</div>;
  if (!ov) return <section className="panel"><p className="muted"><LoaderCircle className="spin" size={14}/> Building the linear model (about 15 seconds the first time)…</p></section>;
  const presets: [string, string, K3][] = [['zn', ov.presets.zn.label, ov.presets.zn.K], ...(ov.ultimate ? [['zn_now', 'Ziegler–Nichols (this netlist)', ov.ultimate.zn.map(v => +v.toFixed(4)) as K3] as [string, string, K3]] : []), ['hinf', ov.presets.hinf.label, ov.presets.hinf.K], ['pole', ov.presets.pole.label, ov.presets.pole.K], ['pole_s', ov.presets.pole_s.label, ov.presets.pole_s.K]];
  const r = resp.value, shockName = SHOCK_CHOICES.find(s => s[0] === shock)![1];
  return <>
    <section className="panel"><div className="policy-head"><div><h2>Draw the adjustment you want</h2><p className="muted">Each cross is a closed-loop pole of the price loop. The vertical line sets how fast a shock must be gone; the two rays set how far the price may swing past its new level. Drag them. Every pole should end up in the green area.</p></div></div>
      <div className="pole-layout">
        <PolePlot ev={ev} ov={ov} spec={{ settling: design.settling, overshoot: design.overshoot, minCycle: design.minCycle }} setSpec={s => setDesign({ ...design, settling: s.settling, overshoot: s.overshoot, minCycle: s.minCycle })} showLocus={showLocus} showOpen={showOpen} showZeros={showZeros}/>
        <div className="pole-side">
          {error && <p className="state-note">{error}</p>}
          {ev && <div className={'verdict ' + (!ev.stable ? 'bad' : ev.outside ? 'warn' : 'good')}>{!ev.stable ? 'Unstable: a pole lies right of the axis.' : ev.outside ? `Stable. ${ev.outside} pole${ev.outside > 1 ? 's lie' : ' lies'} outside your lines.` : 'Stable. Every pole lies inside your lines.'}</div>}
          {ev && ev.poles.some(p => p.pinned) && <p className="muted small"><b>Pinned</b> (ringed): {ev.poles.filter(p => p.pinned && p.im >= 0).length === 1 ? 'this pole has' : 'these poles have'} a zero (○) right next to {ev.poles.filter(p => p.pinned && p.im >= 0).length === 1 ? 'it' : 'them'}. The subsidy hardly reaches that cycle in the price, so no choice of the three gains moves it much: it can only slide towards the zero. Moving it needs a second policy instrument or more measurements than the price.</p>}
          <div className="spec-inputs">
            <label>Adjustment rate: shocks gone within<span><input type="number" min={0.5} max={30} step={0.5} value={design.settling} onChange={e => setDesign({ ...design, settling: Math.min(30, Math.max(0.5, Number(e.target.value) || 4)) })}/> years</span></label>
            <label>Largest overshoot<span><input type="number" min={1} max={90} step={1} value={design.overshoot} onChange={e => setDesign({ ...design, overshoot: Math.min(90, Math.max(1, Number(e.target.value) || 25)) })}/> %</span></label>
            <label className="cycle-limit"><span><input type="checkbox" checked={!!design.minCycle} onChange={e => setDesign({ ...design, minCycle: e.target.checked ? 1.5 : null })}/> Shortest cycle allowed</span>{design.minCycle ? <span><input type="range" min={0.5} max={10} step={0.1} value={design.minCycle} aria-label="Shortest cycle allowed in years" onChange={e => setDesign({ ...design, minCycle: Number(e.target.value) })}/><input type="number" min={0.5} max={30} step={0.1} value={design.minCycle} onChange={e => setDesign({ ...design, minCycle: Math.min(30, Math.max(0.5, Number(e.target.value) || 1.5)) })}/> years</span> : <span className="muted small">no limit</span>}</label>
          </div>
          <h4>Controller gains <small className="muted">model units</small></h4>
          <LogSlider label="Kp, reacts to the price gap" value={design.K[0]} lo={0.05} hi={15} onChange={v => setK(0, v)}/>
          <LogSlider label="Ki, reacts to the gap built up over time" value={design.K[1]} lo={0.05} hi={5} onChange={v => setK(1, v)}/>
          <LogSlider label="Kd, reacts to how fast the gap changes" value={design.K[2]} lo={0.05} hi={8} onChange={v => setK(2, v)}/>
          <label className="check"><input type="checkbox" checked={design.filtered} onChange={e => setDesign({ ...design, filtered: e.target.checked })}/> Derivative filter (quarterly data)</label>
          <div className="chips">{presets.map(([id, label, K]) => <button key={id} onClick={() => setDesign({ ...design, K })}>{label}</button>)}</div>
          <div className="tune"><button className="secondary" disabled={tuning === 'Searching…'} onClick={tune}><Wand2 size={15}/> Find gains for my lines</button><label className="check"><input type="checkbox" checked={withS} onChange={e => setWithS(e.target.checked)}/> Also require shock rejection (S limit)</label>{tuning && <p className="muted small">{tuning}</p>}</div>
          {ev && <><h4>Robustness limits <small className="muted">see Robustness</small></h4><div className="lights"><Light ok={ev.limits.S <= 1} label="S · price shock left" value={num(ev.limits.S)}/><Light ok={ev.limits.T <= 1} label="T · model error reaching the price" value={num(ev.limits.T)}/><Light ok={ev.limits.KS <= 1} label="KS · subsidy per price shock" value={num(ev.limits.KS)}/></div><p className="muted small">Each value must be at most 1.</p></>}
          <div className="row"><label className="check"><input type="checkbox" checked={showOpen} onChange={e => setShowOpen(e.target.checked)}/> Market without policy (grey)</label><label className="check"><input type="checkbox" checked={showZeros} onChange={e => setShowZeros(e.target.checked)}/> Zeros (○)</label><label className="check"><input type="checkbox" checked={showLocus} onChange={e => setShowLocus(e.target.checked)}/> Root locus, P only</label></div>
          <button className="primary" onClick={useInSimulation}><Play size={15}/> Use these gains in the simulation</button>
        </div>
      </div>
      {ov.ultimate && showLocus && <p className="muted small">Raising a pure P gain reaches the stability limit at Ku = {num(ov.ultimate.Ku, 2)}, where the price cycles every {num(ov.ultimate.Pu_yr, 2)} years. The thesis found Ku = 13.63 and 0.77 years on its version of the model.</p>}
    </section>
    <section className="panel"><div className="policy-head"><div><h2>What the lines mean for prices</h2><p className="muted">Response to a permanent step of 1 in a shock, from the linear model. Grey: no policy.</p></div>
      <label className="select">Shock<select value={shock} onChange={e => setShock(e.target.value)}>{SHOCK_CHOICES.map(([id, l]) => <option key={id} value={id}>{l}</option>)}</select></label></div>
      {resp.error && <p className="state-note">{resp.error}</p>}
      {r ? <div className="grid2">
        <Plot label="Price response" height={260} xTitle="Years after the shock" yTitle="Change in price" xRange={[0, 15]} shapes={[{ type: 'rect', xref: 'x', yref: 'paper', x0: 0, x1: design.settling, y0: 0, y1: 1, fillcolor: 'rgba(232,100,43,.07)', line: { width: 0 } }]}
          traces={[{ name: 'No policy', x: r.none.step_years, y: r.none.step, color: '#9a9a9a', dash: 'dash', width: 2 }, { name: 'With your gains', x: r.price.step_years, y: r.price.step, color: COLORS.price }]}/>
        <Plot label="Subsidy response" height={260} xTitle="Years after the shock" yTitle="Change in subsidy" xRange={[0, 15]} traces={[{ name: 'Owner-occupied subsidy', x: r.subsidy.step_years, y: r.subsidy.step, color: COLORS.subsidy }]}/>
      </div> : <p className="muted"><LoaderCircle className="spin" size={14}/> Computing…</p>}
      <p className="muted small">Shaded: the years before your settling line. {shockName}: step of 1 model unit. Poles tell how fast and how damped the adjustment is, not how much of a shock gets through; the Robustness page shows that part.</p>
    </section>
    <p className="provenance">Linear model of the run netlist (19 Oct), linearised around {ov.op_year}; the one-year construction delay uses a second-order Padé approximation. Spec values, presets and the word "lazy" are suggestions from the thesis analysis, not agreed values.</p>
  </>;
}

// ---------- robustness
interface MonteCarlo { n: number; perturb: number; stable: number; fraction: number; curves: { stable: boolean; S: number[] }[] }
/** Root locus in the controller's dock: the same plot and spec lines as the Root locus page, driven by the simulation's own PID gains. */
export function ControllerLocus({ K, filtered, setK, design, setDesign, below }: { K: K3; filtered: boolean; setK: (K: K3, preset?: string) => void; design: Design; setDesign: (d: Design) => void; below?: React.ReactNode }) {
  const [ov, setOv] = useState<Overview>(); const [err, setErr] = useState('');
  const [showLocus, setShowLocus] = useState(false), [showZeros, setShowZeros] = useState(true), [tuning, setTuning] = useState('');
  useEffect(() => { getOverview().then(setOv).catch(e => setErr(e.message)); }, []);
  const { value: ev, error } = useDebounced(() => api<Evaluation>('/analysis/evaluate', { K, filtered, settling_yr: design.settling, overshoot_pct: design.overshoot, min_cycle_yr: design.minCycle ?? null }), [K.join(), filtered, design.settling, design.overshoot, design.minCycle], 80);
  const tune = async () => {
    setTuning('Searching…');
    try { const r = await api<{ K: K3; met: boolean }>('/analysis/tune', { settling_yr: design.settling, overshoot_pct: design.overshoot, min_cycle_yr: design.minCycle ?? null, with_S: false, filtered }); setK(r.K.map(v => +v.toPrecision(4)) as K3); setTuning(r.met ? 'Every pole is now admissible.' : 'Closest gains found; not every pole is admissible.'); }
    catch (e) { setTuning((e as Error).message); }
  };
  if (err) return <p className="state-note">{err}</p>;
  if (!ov) return <p className="muted small"><LoaderCircle className="spin" size={14}/> Building the linear model…</p>;
  const presets: [string, string, K3][] = [['zn', ov.presets.zn.label, ov.presets.zn.K], ['hinf', ov.presets.hinf.label, ov.presets.hinf.K], ['pole', ov.presets.pole.label, ov.presets.pole.K]];
  return <div className="dock-locus">
    <h4>Root locus <small className="muted">closed-loop poles of the price loop</small></h4>
    <PolePlot ev={ev} ov={ov} spec={{ settling: design.settling, overshoot: design.overshoot, minCycle: design.minCycle }} setSpec={s => setDesign({ ...design, settling: s.settling, overshoot: s.overshoot, minCycle: s.minCycle })} showLocus={showLocus} showOpen={true} showZeros={showZeros}/>
    {below}
    {error && <p className="state-note">{error}</p>}
    {ev && <div className={'verdict ' + (!ev.stable ? 'bad' : ev.outside ? 'warn' : 'good')}>{!ev.stable ? 'Unstable: a pole lies right of the axis.' : ev.outside ? `Stable. ${ev.outside} pole${ev.outside > 1 ? 's are' : ' is'} not admissible.` : 'Stable. Every pole is admissible.'}</div>}
    <div className="spec-inputs">
      <label>Adjustment rate: shocks gone within<span><input type="number" min={0.5} max={30} step={0.5} value={design.settling} onChange={e => setDesign({ ...design, settling: Math.min(30, Math.max(0.5, Number(e.target.value) || 4)) })}/> years</span></label>
      <label>Largest overshoot<span><input type="number" min={1} max={90} step={1} value={design.overshoot} onChange={e => setDesign({ ...design, overshoot: Math.min(90, Math.max(1, Number(e.target.value) || 25)) })}/> %</span></label>
            <label className="cycle-limit"><span><input type="checkbox" checked={!!design.minCycle} onChange={e => setDesign({ ...design, minCycle: e.target.checked ? 1.5 : null })}/> Shortest cycle allowed</span>{design.minCycle ? <span><input type="range" min={0.5} max={10} step={0.1} value={design.minCycle} aria-label="Shortest cycle allowed in years" onChange={e => setDesign({ ...design, minCycle: Number(e.target.value) })}/><input type="number" min={0.5} max={30} step={0.1} value={design.minCycle} onChange={e => setDesign({ ...design, minCycle: Math.min(30, Math.max(0.5, Number(e.target.value) || 1.5)) })}/> years</span> : <span className="muted small">no limit</span>}</label>
    </div>
    <div className="row"><label className="check"><input type="checkbox" checked={showLocus} onChange={e => setShowLocus(e.target.checked)}/> Locus (raise all gains)</label><label className="check"><input type="checkbox" checked={showZeros} onChange={e => setShowZeros(e.target.checked)}/> Zeros (○)</label></div>
    <div className="chips">{presets.map(([id, label, k]) => <button key={id} onClick={() => setK(k, id === 'zn' || id === 'hinf' ? id : undefined)}>{label}</button>)}</div>
    <div className="tune"><button className="secondary" disabled={tuning === 'Searching…'} onClick={tune}><Wand2 size={15}/> Find gains for my lines</button>{tuning && <p className="muted small">{tuning}</p>}</div>
    {ev && <div className="lights"><Light ok={ev.limits.S <= 1} label="S · price shock left" value={num(ev.limits.S)}/><Light ok={ev.limits.T <= 1} label="T · model error reaching the price" value={num(ev.limits.T)}/><Light ok={ev.limits.KS <= 1} label="KS · subsidy per price shock" value={num(ev.limits.KS)}/></div>}
  </div>;
}

// only: just the controller in use against the limits, no Ziegler–Nichols / H-inf comparison (guided tour, before H-inf is shown)
export function Robustness({ design, docked = false, only = false }: { design: Design; docked?: boolean; only?: boolean }) {
  const [ov, setOv] = useState<Overview>(); const [err, setErr] = useState('');
  const [perturb, setPerturb] = useState(20), [mc, setMc] = useState<{ design: MonteCarlo; zn: MonteCarlo; hinf: MonteCarlo } | null>(null), [busy, setBusy] = useState(false);
  useEffect(() => { getOverview().then(setOv).catch(e => setErr(e.message)); }, []);
  const ev = (K: K3) => api<Evaluation>('/analysis/evaluate', { K, filtered: design.filtered, settling_yr: design.settling, overshoot_pct: design.overshoot, min_cycle_yr: design.minCycle ?? null });
  const { value: curves, error } = useDebounced(async () => { const o = await getOverview(); const [d, z, h] = await Promise.all([ev(design.K), ev(o.presets.zn.K), ev(o.presets.hinf.K)]); return { d, z, h }; }, [design.K.join(), design.filtered], 120);
  useEffect(() => setMc(null), [design.K.join(), design.filtered, perturb]);
  const draw = async () => {
    if (!ov) return; setBusy(true);
    try { const q = (K: K3) => api<MonteCarlo>('/analysis/montecarlo', { K, filtered: design.filtered, perturb: perturb / 100, n: 100 }); const [d, z, h] = await Promise.all([q(design.K), q(ov.presets.zn.K), q(ov.presets.hinf.K)]); setMc({ design: d, zn: z, hinf: h }); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const panels = useMemo(() => {
    if (!ov || !curves) return null;
    const cyc = ov.cycle_yr, lo = 0.2, hi = 60;
    const lim = (vals: number[]) => within(cyc, vals, lo, hi);
    const trustEnd = cyc.find((c, i) => ov.WT[i] >= 1 && (i === 0 || ov.WT[i - 1] < 1)) ?? 1.5;
    // Shaded area above the limit: one closed polygon (limit curve, then back along the top).
    const shade = (limit: number[], name: string): Trace[] => { const l = lim(limit); return [{ name: 'outside our limit', x: [...l.x, ...[...l.x].reverse()], y: [...l.y, ...l.x.map(() => 1e4)], color: 'rgba(0,0,0,0)', width: 0, fill: 'toself', fillcolor: 'rgba(232,100,43,.09)', showlegend: false, hover: false }, { name, ...l, color: COLORS.spec, dash: 'dash', width: 2 }]; };
    // When the gains in use are the H-inf gains, the H-inf curve is the design: no separate 'your design' curve.
    const isHinf = design.K.every((v, i) => Math.abs(v - ov.presets.hinf.K[i]) < 1e-3 * Math.max(1, Math.abs(v)));
    const isZn = design.K.every((v, i) => Math.abs(v - ov.presets.zn.K[i]) < 1e-3 * Math.max(1, Math.abs(v)));
    const three = (key: 'S' | 'T' | 'KS'): Trace[] => only ? [{ name: isZn ? 'Ziegler–Nichols PID' : isHinf ? 'H∞ PID' : 'Your PID', ...lim(curves.d[key]), color: isZn ? COLORS.zn : isHinf ? COLORS.hinf : COLORS.design, width: 2.8 }] : [{ name: 'Ziegler–Nichols (thesis gains)', ...lim(curves.z[key]), color: COLORS.zn, dash: 'dot', width: 2.8 }, { name: 'H∞ PID', ...lim(curves.h[key]), color: COLORS.hinf }, ...(isHinf ? [] : [{ name: 'Your design', ...lim(curves.d[key]), color: COLORS.design, dash: 'dot' as const, width: 2.6 }])];
    const vline = (x: number, text: string) => ({ shape: { type: 'line', x0: x, x1: x, yref: 'paper', y0: 0, y1: 1, line: { color: '#8a9692', width: 1, dash: 'dot' } }, note: { x: Math.log10(x), xref: 'x', yref: 'paper', y: 1, text, showarrow: false, xanchor: 'left', font: { size: 11, color: '#5b6a64' } } });
    const bw = vline(2 * Math.PI / 2, 'bandwidth 3.1 yr'), trust = vline(trustEnd, `trust ends ${num(trustEnd, 1)} yr`);
    const mcS: Trace[] = mc ? mc.design.curves.map((c, i) => ({ name: c.stable ? 'random market, stable' : 'random market, unstable', ...within(cyc.filter((_, j) => j % 5 === 0), c.S, lo, hi), color: c.stable ? 'rgba(47,111,181,.35)' : 'rgba(200,40,30,.6)', width: 1, showlegend: i < 1, hover: false })) : [];
    return {
      S: { traces: [...shade(ov.WP.map(v => 1 / v), 'our limit 1/|W_P|'), ...mcS, ...three('S')], shapes: [bw.shape], notes: [bw.note] },
      T: { traces: [...shade(ov.WT.map(v => 1 / Math.max(v, 1e-9)), 'our limit 1/|W_T|'), ...three('T')], shapes: [trust.shape], notes: [trust.note] },
      KS: { traces: [...shade(cyc.map(() => ov.ks_limit), `our limit ${ov.ks_limit}`), ...three('KS')], shapes: [], notes: [] },
    };
  }, [ov, curves, mc, only]);
  if (err) return <div role="alert" className="notice bad">{err}</div>;
  if (!ov || !panels || !curves) return <section className="panel"><p className="muted"><LoaderCircle className="spin" size={14}/> Building the linear model and 150 random markets (about 15 seconds the first time)…</p>{error && <p className="state-note">{error}</p>}</section>;
  const hinfIsDesign = design.K.every((v, i) => Math.abs(v - ov.presets.hinf.K[i]) < 1e-3 * Math.max(1, Math.abs(v))), znIsDesign = design.K.every((v, i) => Math.abs(v - ov.presets.zn.K[i]) < 1e-3 * Math.max(1, Math.abs(v))), designName = hinfIsDesign ? 'H∞ PID' : znIsDesign && only ? 'Ziegler–Nichols' : 'Your design';
  const card = (key: 'S' | 'T' | 'KS', title: string, meaning: string, yTitle: string) => {
    const v = curves.d.limits[key];
    return <section className="panel robust-card"><div className="robust-head"><div><h3 style={{ color: COLORS[key] }} title={docked ? meaning : undefined}>{title} <span className="econ">· {ECON[key]}</span></h3>{!docked && <p className="muted small">{meaning}</p>}</div><div className={'light ' + (v <= 1 ? 'ok' : 'bad')}><span aria-hidden="true"/>{designName}<b>{num(v)}</b></div></div>
      <Plot label={title} traces={panels[key].traces} shapes={panels[key].shapes} notes={panels[key].notes} height={docked ? 190 : 330} compact={docked} legendY={-0.3} xTitle={docked ? 'Cycle length [years]' : 'Cycle length of the shock [years]'} yTitle={yTitle} logX logY reverseX xRange={[0.2, 60]} yRange={key === 'KS' ? [0.1, 300] : [0.01, 20]}/></section>;
  };
  const pct = (m: MonteCarlo) => `${Math.round(m.fraction * 100)}% stable (${m.stable} of ${m.n})`;
  return <div className={docked ? 'robust-docked' : 'robust-page'}>
    {docked && only ? <div className="robust-legend"><span><i style={{ borderColor: COLORS.spec, borderTopStyle: 'dashed' }}/>limit (shaded: not met)</span><span><i style={{ borderColor: znIsDesign ? COLORS.zn : COLORS.design, borderTopWidth: 3 }}/>{designName === 'Your design' ? 'your PID' : designName}</span></div>
      : docked ? <div className="robust-legend"><span><i style={{ borderColor: COLORS.spec, borderTopStyle: 'dashed' }}/>limit (shaded: not met)</span><span><i style={{ borderColor: COLORS.zn, borderTopStyle: 'dotted', borderTopWidth: 3 }}/>Ziegler–Nichols</span><span><i style={{ borderColor: COLORS.hinf }}/>H∞ PID</span>{!hinfIsDesign && <span><i style={{ borderColor: COLORS.design, borderTopStyle: 'dotted' }}/>your design</span>}</div>
      : <section className="panel"><h2>Robustness: does the policy survive a wrong model?</h2><p className="muted">Three curves against the cycle length of a shock, long cycles on the left. A design meets a limit when its curve stays out of the shaded area. Your design comes from the Root locus page.</p></section>}
    <div className="robust-grid">
      {card('S', 'S · Sensitivity', 'Share of a price shock of that cycle length that is left after the policy. Small is good: the government fights cycles longer than about 3 years.', '|S|')}
      {card('T', 'T · Complementary sensitivity', 'How far errors in the model reach the price through the policy. It must be small where the model is wrong, for cycles shorter than about 1.5 years.', '|T|')}
      {card('KS', 'KS · Control sensitivity', 'Subsidy per unit of price shock: how hard the government intervenes.', '|KS|')}
    </div>
    <section className="panel"><div className="policy-head"><div><h2>Draw random markets</h2><p className="muted">Every resistor, inductor and capacitor in the netlist is multiplied by its own random factor within ± the chosen percentage. Counted: how many of 100 random markets the closed loop keeps stable.</p></div></div>
      <div className="mc-row"><label className="slider"><span className="slider-head"><span>Model uncertainty</span><output>± {perturb}%</output></span><input type="range" min={0} max={60} step={5} value={perturb} aria-label="Model uncertainty" onChange={e => setPerturb(Number(e.target.value))}/></label>
        <button className="primary" disabled={busy} onClick={draw}>{busy ? <LoaderCircle className="spin" size={15}/> : <Play size={15}/>} Draw 100 markets</button></div>
      {mc && <div className="kpis three"><div className="kpi"><span>{designName}</span><strong>{Math.round(mc.design.fraction * 100)}<em>%</em></strong><small>{pct(mc.design)}</small></div>{!only && <><div className="kpi"><span>Ziegler–Nichols (thesis gains)</span><strong>{Math.round(mc.zn.fraction * 100)}<em>%</em></strong><small>{pct(mc.zn)}</small></div><div className="kpi"><span>H∞ PID</span><strong>{Math.round(mc.hinf.fraction * 100)}<em>%</em></strong><small>{pct(mc.hinf)}</small></div></>}</div>}
      {mc && <p className="muted small">The S panel above now shows |S| of your design in 40 of these markets (red: unstable). Same 100 markets for every design; the percentages move a few points with a different random seed.</p>}
      {busy && !mc && <p className="muted small">The first draw at a new uncertainty builds 100 markets, about 8 seconds.</p>}
    </section>
    <section className="panel"><h3>Guarantee instead of a sample (μ-analysis)</h3><p className="muted">The thesis reports that the H∞ PID stays stable for any combination of errors up to ±31% on 25 parameters. That number comes from the thesis version of the model and needs minutes of computation; it is not recomputed here for the run netlist.</p></section>
    <p className="provenance">Weights are the thesis analysis's own choices: bandwidth 2 rad/yr (3.1-year cycle), peak 2.2 (the thesis uses 2; with 2 the H∞ PID misses by 1% on this netlist), effort limit 8.2, model error from 150 random ±20% markets (seed 11), taken as a running maximum so the T limit stays flat after its peak. The ZN preset uses the thesis gains, set on an earlier version of the model; the Root locus page also offers ZN recomputed for this netlist.</p>
  </div>;
}
