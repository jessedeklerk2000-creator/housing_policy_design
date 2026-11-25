// Display names and formula symbols for the circuit elements (handoff FIGURE_LABELS_NAMING, 25 Nov 2026).
// The SPICE netlist keeps its own ids (the solver and the backend match them as strings); this is a display layer only.
// Name scheme: SPICE type letter + a short English subscript (L_rent, R_imp., B_own), unique as a whole name.
// Both tables (data/element_names.json, data/figure_terms.json) are Claude's reading of the netlist, for Jesse to check;
// backend/housing/export_mapping.py reads the same files for the thesis table.
import { createContext } from 'react';
import katex from 'katex';
import NAMES_JSON from './data/element_names.json';
import TERMS_JSON from './data/figure_terms.json';

export type NameEntry = { letter: string; sub: string; meaning: string; agent: string | null; type: string; value: string };
export type Term = { element: string; symbol: string; meaning: string };
export type FormulaTerms = { id: string; title: string; no: string; terms: Term[]; node?: { label: string; element: string; side: 'left' | 'right'; meaning: string }; unmapped?: string };
export const NAMES = NAMES_JSON as Record<string, NameEntry>;
export const TERMS = TERMS_JSON as FormulaTerms[];

/** Plain-text display name (menus, tooltips, titles): "R rent". Unknown ids (bank-view parts) come back unchanged. */
export const namePlain = (id: string) => { const n = NAMES[id]; return n ? `${n.letter} ${n.sub}` : id; };
/** TeX of the display name: R_{\text{rent}}. */
export const nameTex = (id: string) => { const n = NAMES[id]; return n ? `${n.letter}_{\\text{${n.sub}}}` : null; };
export const tex = (s: string) => katex.renderToString(s, { throwOnError: false, output: 'html' });

export type LabelMode = 'names' | 'symbols' | 'both';
/** Formula symbols per element: those of the highlighted formula first, then the first symbol any formula gives it. */
export function symbolsFor(formulaId: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  const order = formulaId ? [...TERMS.filter(f => f.id === formulaId), ...TERMS.filter(f => f.id !== formulaId)] : TERMS;
  order.forEach(f => f.terms.forEach(t => { if (t.symbol && !(t.element in out)) out[t.element] = t.symbol; }));
  return out;
}
export type LabelState = { mode: LabelMode; symbols: Record<string, string>; nodes: NonNullable<FormulaTerms['node']>[] };
export const LabelCtx = createContext<LabelState>({ mode: 'names', symbols: {}, nodes: [] });

/** The mapping as CSV and as a booktabs table (Element | Symbol | Meaning | Equation), one block per agent. */
export function mappingRows() {
  const rows: { agent: string; element: string; name: string; symbol: string; meaning: string; eq: string }[] = [];
  TERMS.forEach(f => f.terms.forEach(t => rows.push({ agent: NAMES[t.element]?.agent ?? '', element: t.element, name: namePlain(t.element), symbol: t.symbol, meaning: t.meaning, eq: `${f.title} (${f.no})` })));
  return rows.sort((a, b) => a.agent.localeCompare(b.agent));
}
export function mappingCsv() {
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  return ['agent,netlist_id,element,symbol,meaning,equation', ...mappingRows().map(r => [r.agent, r.element, r.name, r.symbol, r.meaning, r.eq].map(q).join(','))].join('\n');
}
export function mappingTex() {
  const esc = (s: string) => s.replace(/[&%#_]/g, m => '\\' + m);
  const rows = mappingRows(), agents = [...new Set(rows.map(r => r.agent))];
  const body = agents.map(a => [`\\multicolumn{4}{l}{\\textit{${a.charAt(0).toUpperCase() + a.slice(1)}}}\\\\`, ...rows.filter(r => r.agent === a).map(r => {
    const n = NAMES[r.element]; return `$${n ? `${n.letter}_{\\text{${esc(n.sub)}}}` : esc(r.element)}$ & ${r.symbol ? `$${r.symbol}$` : '--'} & ${esc(r.meaning)} & ${esc(r.eq)}\\\\`; })].join('\n')).join('\n\\midrule\n');
  return `\\begin{tabular}{llll}\n\\toprule\nElement & Symbol & Meaning & Equation\\\\\n\\midrule\n${body}\n\\bottomrule\n\\end{tabular}\n`;
}
