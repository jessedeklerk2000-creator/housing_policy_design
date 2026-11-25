import { useEffect, useState } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

// The CPB housing-market model as the backbone of the circuit (guided tour, first step): the equations from
// Groot & Möhlmann (2020), CPB-Woningmarktmodel 2020, CPB Achtergronddocument; equation numbers refer to that
// document, parameter values are its own (beta 0.65, rho 3.95%, sigma 2, delta 0.117).
// flows / elements: what lights up on the canvas when the formula is clicked. Which circuit parts belong to which
// equation is Claude's reading of the netlist (10 Nov 2026), for Jesse to check.
// trace: elements whose connecting wires light up as well (the wires between them, not the ports to other agents).
export type Formula = { id: string; title: string; no: string; tex: string; note?: string; explain?: string; flows: string[]; elements: string[]; trace?: string[] };
export const FORMULAS: Record<string, Formula[]> = {
  constructors: [
    { id: 'construction', title: 'New construction', no: '2.14', tex: 'I_t = (\\gamma+\\omega)\\,\\alpha_t\\,P_m^{\\beta}',
      note: 'γ growth of the stock, ω demolition, β = 0.65 price elasticity of supply',
      explain: 'New construction follows the house price: 1% higher price, about 0.65% more building. γ + ω is what keeps the stock growing and replaces demolished houses; α is calibrated to observed construction. In the circuit: a controlled source driven by the construction payments.',
      flows: ['houses', 'construction_cost'], elements: ['B§Construction', 'V§Construction_cost', 'L2', 'L4', 'B§Housing_services'] },
  ],
  investors: [
    { id: 'price', title: 'Market price of a house', no: '2.17', tex: 'P_m = \\textstyle\\sum_{t=1}^{\\infty} \\displaystyle\\frac{w^{*}(t) - \\kappa(t)}{(1+\\rho)^{t}}',
      note: 'w* gross (imputed) rent, κ maintenance, ρ = 3.95% required return',
      explain: 'A house is worth all its future net rents: the rent w* minus maintenance κ, discounted at the required return. The CPB keeps maintenance on its steady path and the return constant, so the price moves with the expected rents. In the circuit: the investors receive the rents and imputed rents, pay maintenance and the construction payments.',
      flows: ['construction_cost', 'rent', 'imputed_rent'], elements: ['L§Gross_rent', 'L§Gross_imputed_rent', 'V§Maintenance_costs', 'L1', 'R9', 'R13'],
      trace: ['L§Gross_rent', 'L§Gross_imputed_rent', 'V§Maintenance_costs', 'L1', 'R9', 'R13'] },
  ],
  households: [
    // Utility and budget together (Jesse, 25 Nov 2026): both are CPB eq. 2.1, the household's problem (max u subject to b)
    { id: 'utility', title: 'Utility and budget', no: '2.1',
      tex: '\\begin{aligned}' + '\\max\\; u &= \\bigl[(\\theta(h_k-\\bar h_k)^{\\rho} + (1-\\theta)(h_h-\\bar h_h)^{\\rho})^{1/\\rho}\\bigr]^{\\delta}\\, x^{1-\\delta}' + ' \\\\ \\text{s.t.}\\; b &= w_k h_k + w_h h_h + p_x x\\end{aligned}',
      note: 'θ preference for owning, σ = 1/(1 − ρ) = 2, δ = 0.117; b: every money flow into and out of the households',
      explain: 'Households split their budget b over owning (h_k), renting (h_h) and other consumption (x). θ: the preference for owning; h̄: the minimum housing they need; σ = 2: how easily they switch between owning and renting; δ: the weight of housing in utility. Every euro of b goes to rent, imputed rent or other consumption. In the circuit: controlled sources turn the marginal utilities into incentives, and money in equals money out over the household ports.',
      flows: ['rental_services', 'owner_services', 'goods', 'rent', 'imputed_rent', 'consumption', 'income'],
      elements: ['L§Demand_rent', 'L§Demand_owner_occupied', 'B4', 'L§Demand_consumption', 'L§Income', 'L§Consumption', 'L§Rent', 'L§Imputed_rent'],
      // the budget node (Jesse): Income, Consumption, Rent and Imputed rent and the wires between them; not the savings pair R18/R2
      trace: ['L§Income', 'L§Consumption', 'R12', 'L§Rent', 'R5', 'L§Imputed_rent', 'R4'] },
    { id: 'subsidy', title: 'Subsidy formula', no: '2.6', tex: 'w_{k,h} = w^{*}_{k,h}\\,(1 - s_{k,h})',
      note: 'sₖ owner-occupied, sₕ rental subsidy rate: the Tax Authority’s inputs',
      explain: 'Households pay the gross price w* minus a subsidy share s (subsidievoet): sₖ for owning, sₕ for renting. The two rates are the inputs of the system; the Tax Authority sets sₖ, and with feedback the rule sets it from the price gap.',
      flows: ['owner_subsidy', 'rental_subsidy', 'rent', 'imputed_rent'], elements: ['I§Owner_occupied_subsidies', 'I§Rental_subsidies1', 'B§PID'] },
  ],
};
// Height of the formula strip above an opened agent's circuit, in canvas (model) units.
export const STRIP_H: Record<string, number> = { constructors: 190, investors: 215, households: 330 };
// Households: strip at the bottom, because the rails from the investors enter its circuit from the top.
export const STRIP_BOTTOM = new Set(['households']);

const html = (tex: string) => katex.renderToString(tex, { throwOnError: false, displayMode: true, output: 'html' });

// Natural width (px at --eq 1) of each agent's widest formula card, measured off-screen once the KaTeX fonts are
// loaded. The canvas uses it to pick one formula scale for all cards that still fits every card (ModelMap).
let widths: Promise<Record<string, number>> | null = null;
function measure(): Promise<Record<string, number>> {
  return (document.fonts?.ready ?? Promise.resolve()).then(() => {
    const out: Record<string, number> = {};
    for (const [agent, list] of Object.entries(FORMULAS)) {
      const box = document.createElement('div');
      box.className = 'formulas formula-measure';
      box.style.cssText = '--eq:1; position:absolute; left:-10000px; top:0; visibility:hidden; width:max-content;';
      for (const f of list) {
        const card = document.createElement('div'); card.className = 'eq'; card.style.width = 'max-content';
        card.innerHTML = `<div class="eq-title">${f.title} <span class="eq-no">(${f.no})</span></div><div class="eq-body">${html(f.tex)}</div>`;
        box.appendChild(card);
      }
      document.body.appendChild(box);
      out[agent] = Math.max(...[...box.children].map(c => (c as HTMLElement).getBoundingClientRect().width));
      box.remove();
    }
    return out;
  });
}
export function useFormulaWidths(): Record<string, number> | null {
  const [w, setW] = useState<Record<string, number> | null>(null);
  useEffect(() => { let live = true; (widths ??= measure()).then(r => { if (live) setW(r); }); return () => { live = false; }; }, []);
  return w;
}

export function FormulaCards({ agent, active, pick, eq }: { agent: string; active: string | null; pick: (f: Formula | null) => void; eq?: number }) {
  const list = FORMULAS[agent]; if (!list) return null;
  return <div className="formulas nodrag" style={eq ? { ['--eq' as string]: eq } : undefined} onClick={e => e.stopPropagation()}>
    {list.map(f => { const toggle = () => pick(active === f.id ? null : f);
      return <div key={f.id} role="button" tabIndex={0} className={'eq' + (active === f.id ? ' on' : '')} aria-pressed={active === f.id} title="Show the flows and elements this equation describes"
        onClick={e => { e.stopPropagation(); toggle(); }} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }}>
        <div className="eq-title">{f.title} <span className="eq-no">({f.no})</span></div>
        <div className="eq-body" dangerouslySetInnerHTML={{ __html: html(f.tex) }}/>
        {f.note && <div className="eq-note">{f.note}</div>}
        {active === f.id && f.explain && <div className="eq-explain">{f.explain}</div>}
      </div>; })}
  </div>;
}
