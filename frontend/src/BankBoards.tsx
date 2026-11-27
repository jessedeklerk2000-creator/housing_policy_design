// Breadboards of the "Bank controls" blocks (20 Nov 2026), shown when the ALM desk or Reporting block is opened on the
// model canvas. Both are B-sources in bank_netlist.py, drawn here as equivalent circuits in the breadboard symbols.
// Component values on the op-amp stages are normalised (Claude's choice), as on the PID breadboard of the main view.
import { BREADBOARD, Glyph, W, cap, gnd, res, stage } from './Schematic';

export type Vals = Record<string, number | null | undefined>;
const n = (v: number | null | undefined, d = 2) => v == null ? '–' : v.toLocaleString('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d });

// ---------- small drawing helpers in the breadboard style
const el = (x1: number, y1: number, x2: number, y2: number, type: string, label: string, value: string, k: string, dx = 0, dy = 0) => {
  const len = Math.hypot(x2 - x1, y2 - y1), ang = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI, vert = Math.abs(y2 - y1) > Math.abs(x2 - x1);
  return <g key={k} className="element active"><g className="glyph" transform={`translate(${x1} ${y1}) rotate(${ang})`}><Glyph type={type} length={len}/></g>
    <text className="bk-el" x={(vert ? x1 + 34 : (x1 + x2) / 2) + dx} y={(vert ? (y1 + y2) / 2 - 6 : y1 - 32) + dy} textAnchor={vert ? 'start' : 'middle'}>{label}</text>
    <text className="bk-elv" x={(vert ? x1 + 34 : (x1 + x2) / 2) + dx} y={(vert ? (y1 + y2) / 2 + 20 : y1 + 44) + dy} textAnchor={vert ? 'start' : 'middle'}>{value}</text></g>;
};
const dot = (x: number, y: number, k: string) => <circle key={k} className="bb-dot" cx={x} cy={y} r={6}/>;
const sum = (x: number, y: number, signs: [string, string], k: string) => <g key={k}><circle className="sum-mark" cx={x} cy={y} r={24}/><text className="sign" x={x - 40} y={y - 26}>{signs[0]}</text><text className="sign" x={x - 40} y={y + 44}>{signs[1]}</text></g>;
const port = (x: number, y: number, t: string, k: string, anchor: 'start' | 'end' = 'start') => <text key={k} className="bk-port" x={x} y={y} textAnchor={anchor}>{t}</text>;
const frame = (w: number, h: number, label: string, children: React.ReactNode, law?: string, note?: string): React.ReactElement =>
  <svg className="circuit embedded bk-bb" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label}>{BREADBOARD}<rect x={0} y={0} width={w} height={h} fill="url(#breadboard)"/>{children}
    {law && <text className="bb-law" x={w / 2} y={h - 50}>{law}</text>}{note && <text className="bb-note" x={w / 2} y={h - 20}>{note}</text>}</svg>;

/** ALM Desk (Menkveld 2025, eq. 3-4, 3-5, 3-8): two PI controllers (P stage + I stage each), then FTP ± spread/2. */
export function DeskBoard({ K, v, alm }: { K: { Kp_ftp: number; Ki_ftp: number; Kp_s: number; Ki_s: number }; v: Vals; alm: boolean }) {
  const pi = (y: number, name: string, kp: number, ki: number, err: string, out: string, outV: string, k: string) => <g key={k} opacity={alm ? 1 : .4}>
    <text className="bk-row" x={30} y={y - 236}>{name}</text>
    {W([[20, y], [70, y]], `${k}in`)}{port(24, y - 14, err, `${k}pin`)}{dot(70, y, `${k}j`)}
    {W([[70, y], [70, y - 90], [100, y - 90]], `${k}up`)}{W([[70, y], [70, y + 110], [100, y + 110]], `${k}dn`)}
    <g transform={`translate(-20 ${-90})`}>{stage(120, y, res(120, y, 150, 'R_in', '1', `${k}pr`), res(330, y - 110, 100, 'R_f = Kp', n(kp, 3), `${k}pf`), `${k}P`)}</g>
    <g transform={`translate(-20 ${110})`}>{stage(120, y, res(120, y, 150, 'R = 1/Ki', n(ki ? 1 / ki : 0, 1), `${k}ir`), cap(330, y - 110, 100, 'C', '1', `${k}ic`), `${k}I`)}</g>
    {W([[430, y - 90], [520, y - 90], [520, y - 24]], `${k}po`)}{W([[430, y + 110], [520, y + 110], [520, y + 24]], `${k}io`)}{sum(520, y, ['+', '+'], `${k}s`)}
    {W([[544, y], [640, y]], `${k}o`)}{port(560, y - 16, `${out} ${outV}`, `${k}ol`)}
  </g>;
  return frame(1300, 990, 'ALM Desk breadboard', <>
    {pi(260, 'Liquidity risk: PI → FTP', K.Kp_ftp, K.Ki_ftp, 'e₂ = NSFR target − NSFR', 'FTP', `${n(v.ftp)}%`, 'f')}
    {pi(680, 'Solvency risk: PI → spread', K.Kp_s, K.Ki_s, 'e₁ = Tier 1 target − Tier 1', 'spread', `${n(v.s)}%`, 's')}
    {/* the client rates by maturity (Jesse, 27 Nov 2026): FTP ± spread/2, then the move of the risk-free curve at the
        product's maturity, read at the interbank port (Treasury's FTP per maturity) */}
    {W([[640, 260], [760, 260], [760, 446]], 'a1')}{W([[640, 680], [760, 680], [760, 494]], 'a2')}{sum(760, 470, ['+', '+½'], 'rm')}
    {W([[700, 260], [700, 200], [870, 200], [870, 576]], 'b1')}{W([[700, 680], [700, 760], [870, 760], [870, 624]], 'b2')}{dot(700, 260, 'd1')}{dot(700, 680, 'd2')}
    {sum(870, 600, ['+', '−½'], 'rs')}
    {/* the risk-free curve from the interbank port enters at the bottom right (Treasury's FTP per maturity): its move at
        30 yr into u₁, β × its move at the short end into u₂, its move at 10 yr into u₃ */}
    {W([[1250, 990], [1250, 880], [1100, 880]], 'cv')}{port(1086, 870, 'Δ risk-free curve (interbank port)', 'cvl', 'end')}
    {W([[784, 470], [1076, 470]], 'u1a')}{sum(1100, 470, ['', ''], 'rm2')}{W([[1100, 880], [1100, 494]], 'c30')}{dot(1100, 880, 'j30')}{port(1108, 530, `Δr₃₀ ${n(v.d30)}`, 'c30l')}
    {W([[1124, 470], [1280, 470]], 'u1')}{port(1276, 440, `u₁ ${n(v.rm)}%`, 'u1l', 'end')}
    {W([[894, 600], [1126, 600]], 'u2a')}{sum(1150, 600, ['', ''], 'rs2')}{W([[1150, 880], [1150, 624]], 'csh')}{dot(1150, 880, 'jsh')}{port(1158, 655, `β·Δr₀ ${n(v.dsh == null ? null : 0.5 * v.dsh)}`, 'cshl')}
    {W([[1174, 600], [1280, 600]], 'u2')}{port(1276, 570, `u₂ ${n(v.rs)}%`, 'u2l', 'end')}
    {dot(810, 470, 'd3')}{W([[810, 470], [810, 730], [1176, 730]], 'u3a')}{sum(1200, 730, ['', ''], 'rf2')}{W([[1200, 880], [1200, 754]], 'c10')}{dot(1200, 880, 'j10')}{port(1208, 805, `Δr₁₀ + c`, 'c10l')}
    {W([[1224, 730], [1280, 730]], 'u3')}{port(1276, 700, `u₃ ${n(v.rf)}%`, 'u3l', 'end')}
  </>, 'u₁ = FTP + s/2 + Δr₃₀  ·  u₂ = FTP − s/2 + β·Δr₀  ·  u₃ = FTP + s/2 + Δr₁₀ + c',
    alm ? 's = spread. β = 0.5, c = −0.49 pp (10-yr minus 30-yr point of the start curve). Normalised values; each inverting stage is followed by a gain −1 stage (not drawn).' : 'Desk switched off: FTP and spread stay at their start values; moves of the risk-free curve still pass through.');
}

/** Balance sheet of your bank: deposits and equity as capacitors, Tier 1 and loans/funding as read-outs. */
export function BalanceBoard({ v }: { v: Vals }) {
  const cell = (x0: number, w: number, title: string, srcs: [string, string, boolean][], c: string, cv: string, k: string) => <g key={k}>
    <text className="bk-row" x={x0} y={120}>{title}</text>
    {W([[x0, 200], [x0 + w, 200]], `${k}t`)}{W([[x0, 520], [x0 + w, 520]], `${k}b`)}{gnd(x0 + w / 2, 520, `${k}g`)}
    {srcs.map(([l, f, into], i) => el(x0 + 40 + i * 150, into ? 520 : 200, x0 + 40 + i * 150, into ? 200 : 520, 'bi', l, f, `${k}${i}`, -6))}
    {el(x0 + w - 40, 200, x0 + w - 40, 520, 'cap', c, cv, `${k}c`, -150)}</g>;
  return frame(1300, 760, 'Balance sheet breadboard', <>
    {cell(40, 420, 'Deposits', [['inflow', '(D* − D)/τ', true]], 'Deposits D', `D = ${n(v.dep, 1)}`, 'd')}
    {cell(560, 700, 'Equity', [['net interest', 'NII', true], ['losses', 'loss·uw·M', false], ['payout', 'pay₀·E/E₀', false]], 'Equity E', `E = ${n(v.eq, 2)}`, 'e')}
    {port(40, 610, `D* rises with the savings rate (${n(v.rs)}%)`, 'p1')}
    {port(560, 610, `Tier 1 capital ratio = E / risk-weighted assets = ${n(v.t1, 1)}%`, 'p2')}
    {port(560, 645, `NSFR = available / required stable funding = ${n(v.nsfr, 1)}%`, 'p3')}
  </>, 'τ·dD/dt = D* − D  ·  dE/dt = NII − losses − payout', 'NII = mortgage rate·loans + market rate·cash − savings rate·D − (market rate + premium)·deposits of other banks.');
}
