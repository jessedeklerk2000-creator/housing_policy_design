export type ControllerKey = 'hinf' | 'zn' | 'netlist' | 'custom';
export interface Scenario {
  name: string; feedback: boolean; controller: ControllerKey; kp: number; ki: number; kd: number; derivative_filter: boolean;
  param_scale: Record<string, number>;  // model parameters changed in system identification: {R/L/C name: factor}
  target_growth_pct: number; reference_base: number; subsidy_scale: number; interest_scale: number; income_scale: number;
  mortgage_scale: number; crisis_scale: number; covid_scale: number;
  subsidy_path: 'historical' | 'step' | 'staircase'; subsidy_base: number; subsidy_step: number; subsidy_step_yr: number;
  phase_from: number; phase_start_yr: number; phase_years: number; phase_steps: number;
  share_control: boolean; skp: number; ski: number; skd: number; share_target_pct: number; income_path: 'historical' | 'stable'; mortgage_shift_yr: number; interest_shift_yr: number; interest_new_share: number; covid_on_yr: number; covid_fall_yr: number; rental_subsidy: boolean; crisis_start_yr: number; crisis_w: boolean; equilibrium_start: boolean; crisis_w_start_yr: number; crisis_w_scale: number; crisis_w_on_yr: number; crisis_w_recovery_yr: number; crisis_w_fall_yr: number; crisis_mortgage_cut: number; interest_path: 'historical' | 'flat'; crisis_w_floor: number; inflation_pct: number; income_growth_pct: number; bank: boolean;
}
export type Kpis = Record<'yoy_min' | 'yoy_max' | 'yoy_std' | 'yoy_mean_abs_gap' | 'price_final' | 'price_gap_final_pct' | 'subsidy_min' | 'subsidy_max' | 'subsidy_mean' | 'subsidy_total' | 'subsidy_max_change_per_year', number>;
export interface LedgerAccount { id: string; label: string; formula: string; inputs: string[]; unit: string; source: string; note: string; minimum?: number }
export interface Ledger { version: string; groups: { id: string; label: string; sections: { label: string; side?: string; accounts: string[] }[] }[]; accounts: Record<string, LedgerAccount>; links: [string, string, string][]; basis: string; thresholds?: Threshold[] }
export interface Threshold { id: string; label: string; value: number | null; unit: string; text?: string; source: string }
export interface Result { ledger?: Ledger; ledger_comp?: Ledger; year: number[]; traces: Record<string, number[]>; series: Record<string, number[]>; kpis: Kpis; scenario: Scenario; engine: string; model_version: string; netlist_sha256: string; netlist: string }
export interface Preset { label: string; kp: number; ki: number; kd: number; filtered: boolean }
export interface Catalogue { defaults: Scenario; presets: Record<string, Preset>; model_version: string; time: { year_at_raw_zero: number } }
export interface SavedRow { id: string; name: string; created_at: string; feedback: boolean; has_result: boolean }
export interface Flow { id: string; label: string; short: string; source: string; target: string; signal: string; unit: string; kind: 'money' | 'real' | 'policy'; chain: string[]; port: { node: string; ret: string } | null; description: string }
export interface Signal { id: string; label: string; signal: string; unit: string; element?: string; target?: string }
export interface Element { name: string; a: string; b: string; value: string; state: string; type: string; role: string; pins: number[][]; agent: string | null; flows: string[]; trace: string; netlist: string }
export interface Layout { size: [number, number]; wires: number[][]; return_wires: number[][]; common_returns: number[][]; dots: number[][]; grounds: number[][]; signals: { flow: string; path: number[][] }[]; ports: Record<string, number[]>; returns: Record<string, number[]>; not_drawn: string[] }
export interface ControllerLayout { size: [number, number]; paths: number[][][]; sums: number[][]; labels: [number, number, string][]; not_drawn: string[] }
/** A loop signal's card (label, title, trace); bank mode overrides the housing ones through MapData.loop. */
export interface LoopSig { label: string; title: string; note?: string; signal: string; unit: string; color: string; pair?: { signal: string; label: string; color: string; first?: string }; third?: { signal: string; label: string; color: string }; step?: { kind: 'signal' | 'flow'; id: string }; dock: { kind: string; id: string } }
export interface MapData { agents: Record<string, { label: string; summary: string; description: string }>; controller: { label: string; description: string }; flows: Flow[]; disturbances: Signal[]; outputs: Signal[]; elements: Element[]; layouts: Record<string, Layout>; controller_layout: ControllerLayout; loop?: Record<string, LoopSig> }
export type Selection = { kind: 'flow' | 'signal' | 'element' | 'agent' | 'sensor' | 'shocks' | 'tf' | 'probe' | 'ident' | 'robust' | 'none'; id: string };
