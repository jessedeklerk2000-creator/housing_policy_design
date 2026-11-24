import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, MousePointerClick, X } from 'lucide-react';
import type { Scenario } from './types';
import type { Probe } from './ModelMap';
import { CPB_PEAKS, FLAT, GROWTH, NO_SUBSIDY, ONE_STEP, PHASE, QUIET, SHOCKS_CBS, TREND_TARGET, W_SLIDE } from './Tour';

// Guided tour (Jesse, 12 Nov 2026): takes a visitor by the hand on the canvas. Each step is a short story; each
// sub-step points at one thing to click (pulsing ring + speech bubble) and moves on once the click has happened.
// "Show me" does the click. Everything happens on the canvas: the scenario panel stays closed.
// The presenter tour (Tour.tsx) is the same story without the hand-holding, for the slides.

/** What the canvas reports to the guide after every change (ModelMap → App). */
export type Snap = { n: number; playing: boolean; finance: boolean; agents: string[]; system: boolean; cpb: boolean; controller: boolean; formulas: boolean; hl: string | null; pins: string[]; charts: string[]; plays: number; stepping: boolean; sel: string; stepInput: string; showZn: boolean };
export type GState = { snap: Snap; s: Scenario; runs: number };
/** One-off canvas commands from the guide (App → ModelMap). */
export type GuideCmd = { n: number; fit?: boolean; focus?: string; view?: { system?: boolean; cpb?: boolean; finance?: boolean; formulas?: boolean; controller?: boolean; agents?: string[] }; stepInput?: string; dock?: boolean };
type Sub = {
  target?: string; text: string;
  side?: boolean;                               // bubble beside the target (left or right), not above or below
  opt?: string;                                 // inside the target (an open picker): ring this option
  avoid?: string;                               // keep the bubble off this block too (e.g. the agent around a + button)
  done?: (g: GState, b: GState) => boolean;     // the click has happened (b: the state when this sub-step began)
  show?: { click?: string; patch?: Partial<Scenario>; cmd?: Omit<GuideCmd, 'n'> };
  enter?: Omit<GuideCmd, 'n'>;                  // canvas command when the sub-step begins
  cont?: boolean;                               // no click to wait for: a Continue button
  figure?: 'underwater' | 'ladder';             // small illustration in the bubble (the two problems)
};
export type GuideStep = { title: string; goal: string; setup: Partial<Scenario>; pins: Probe[]; robustOnly?: boolean; compare?: boolean; cbs?: boolean; compareOpen?: boolean; rejectSize?: boolean; zn?: boolean; cpbOverlay?: boolean; chapter?: ChapterId; subs: Sub[]; end?: string };  // chapter: set on the first step of a chapter

// Chapters (Jesse, 17 Nov 2026, option A): the problems, the modelling, then the solving, split into the two problems,
// and maximum stability as an extra chapter at the end (it does not follow from the two problems).
export type ChapterId = 'intro' | 'model' | 'underwater' | 'ladder' | 'stability';
export const CHAPTERS: Record<ChapterId, { label: string; part?: string; color: string; soft: string }> = {
  intro: { label: 'The problems', color: '#5c6b65', soft: '#eef1ef' },
  model: { label: 'Modelling', color: '#3f9a1f', soft: '#ebf5e5' },
  underwater: { label: 'Underwater mortgages', part: 'Solving', color: '#1f6fc4', soft: '#e6f0fa' },
  ladder: { label: 'Housing ladder', part: 'Solving', color: '#b9770e', soft: '#fbf2df' },
  stability: { label: 'Maximum stability', part: 'Extra', color: '#7a4fb3', soft: '#f1ebf8' },
};  // no end: straight on to the next step

// Canvas targets (CSS selectors)
const node = (id: string) => `.react-flow__node[data-id="${id}"]`, edge = (id: string) => `.react-flow__edge[data-id="${id}"] .rail-hit`;
const T = {
  market: node('system'), households: `${node('households')} .formulas .eq`, anyEq: '.react-flow__node .formulas', cbs: node('sensor'), ctrl: node('controller'),
  u: edge('u2'), y: edge('yout'), play: 'button.play', loop: '.loop-switch', kpUp: '[aria-label="kp up"]', card: '.pin-card',
  chipSub: '[data-guide="chip-subsidy"]', chipIncome: '[data-guide="chip-income"]', chipShocks: '[data-guide="chip-shocks"]', chipBank: '[data-guide="chip-bank"]', chipCtrl: '[data-guide="chip-controller"]', chipShare: '[data-guide="chip-share"]',
  ident: '[data-guide="ident"]', robust: '[data-guide="robust"]', stepMode: '[data-guide="plot-step"]', zn: '[data-guide="zn-compare"]', dock: '.inspector:not(.left-dock)',
};
const played = (g: GState, b: GState) => g.snap.plays > b.snap.plays && !g.snap.playing;  // after the playback has finished
const pinned = (key: string) => (g: GState) => g.snap.pins.includes(key);
const PLAY = (text: string): Sub => ({ target: T.play, text, done: played, show: { click: T.play } });
const price: Probe = { flow: 'y_price', q: 's' }, subsidy: Probe = { flow: 'owner_subsidy', q: 's' }, income: Probe = { flow: 'd_income', q: 's' }, yoy: Probe = { flow: 'y_yoy', q: 's' };
const crisis: Probe = { flow: 'd_crisis', q: 's' }, mortgages: Probe = { flow: 'd_mortgages', q: 's' }, rentalSub: Probe = { flow: 'rental_subsidy', q: 's' }, share: Probe = { flow: 'y_share', q: 's' }, rentCost: Probe = { flow: 'y_rent_cost', q: 's' };
const START = { ...QUIET, ...FLAT, ...NO_SUBSIDY };
// Closed-loop steps: the target is the trend of the fitted price (flat in real terms) and the fitted 4.47% inflation is
// added on the year-on-year card. (A target growing 2.5% a year was tried on 11 Nov and dropped on 12 Nov: the rule
// then needed a subsidy of about 250 by 2025.)
const LOOP = { ...SHOCKS_CBS, ...TREND_TARGET, feedback: false, controller: 'zn', equilibrium_start: true } as Partial<Scenario>;
// The financial crisis on its own (underwater chapter; Jesse, 18 Nov 2026): one shock that hits the firms (the W of the
// slides, W_SLIDE) and the bank's lending in the same W (loans to firms 30 -> 10, and a cut of 15 in mortgage lending).
// Bank on, everything else held still: no mortgage path (only the cut), interest at its 1996 value, flat income, no
// Covid, no subsidy path. Without the crisis the price then stays at 90.64, the target (checked 18 Nov 2026), so the
// subsidy starts at 0. The cut of 15 is Claude's choice: a 21% drop without a rule, as the CPB's 21% for 2008-2013.
const CRISIS = { ...START, ...W_SLIDE, bank: true, mortgage_scale: 0, interest_path: 'flat', crisis_mortgage_cut: 15, covid_scale: 0, inflation_pct: 0, reference_base: 90.64, target_growth_pct: 0, feedback: false, controller: 'zn', equilibrium_start: true } as Partial<Scenario>;

export const GUIDE: GuideStep[] = [
  // Problem-first framing (Jesse and supervisor, 17 Nov 2026). Numbers checked against the sources on 17 Nov 2026.
  { chapter: 'intro', title: 'Two problems', goal: 'Two problems in the Dutch housing market, and how control engineering can tackle them.', setup: START, pins: [], subs: [
    { figure: 'underwater', text: 'Problem 1, underwater mortgages. When house prices fall, mortgages end up underwater: households cut spending and stop moving, and the recession deepens. From 2009 to 2013, 1 in 3 Dutch households with a mortgage ended up underwater (DNB).', cont: true },
    { figure: 'ladder', text: 'Problem 2, the housing ladder. Policy that helps one group worsens the position of another (CPB, 2020): help first-time buyers and prices rise for everyone else.', cont: true },
    { text: 'To tackle them, we first need a model that moves in time. The next steps build it, tune it on real cycles and the CPB model, and then design a controller.', cont: true },
  ] },
  { chapter: 'model', title: 'The market as a circuit', goal: 'See how the model is built.', setup: START, pins: [], subs: [
    { target: T.market, text: 'The Tax Authority sends the subsidy as a signal into the Housing Market; CBS measures the house price that comes out. Click the Housing Market to open it.', done: g => g.snap.system, show: { click: T.market } },
    { target: `${node('households')} button.toggle`, enter: { view: { system: true, cpb: true, formulas: true } }, text: 'Inside: the CPB model, its agents in four quadrants, each with its CPB equations. Open Households down to its elements, the breadboard: click + on Households.', done: g => g.snap.agents.includes('households'), show: { click: `${node('households')} button.toggle` } },
    { target: T.households, text: 'Every element here belongs to a CPB equation. Click the Utility equation: the flows and elements it describes light up, with a short explanation.', done: g => !!g.snap.hl, show: { click: T.households } },
    { text: 'Click the other equations, Budget and Subsidy, to see what each one describes. Scroll to zoom, drag to move the canvas; Whole model (toolbar, top left) shows everything again. Continue when you are ready.', cont: true },
  ] },
  { title: 'One push on the subsidy', goal: 'Raise the subsidy once and watch the market respond.', setup: START, pins: [subsidy, price], subs: [
    { target: T.chipSub, opt: 'One step', text: 'Open “Subsidy path” under the Tax Authority and choose One step: from 0 to 20 in 2005.', done: (g, b) => g.s.subsidy_path === 'step', show: { patch: ONE_STEP } },
    PLAY('Press ▶. The price overshoots, turns and settles: the market’s own dynamics.'),
    { target: T.ident, text: 'More analysis sits in the side panel: click Identify system for the market’s poles and its step response. Change the adjustment time or the cycle there to see other dynamics.', done: g => g.snap.sel === 'ident:', show: { click: T.ident } },
    { target: T.dock, text: 'Top: the poles of the market, each cross one of its own movements. Further left: it dies out faster; higher up: a shorter cycle. The green pair dominates the price. Below: the price after a subsidy of +1, with when it peaks, when it reaches its trough and the full adjustment time, summed up under the plot.', cont: true },
    { target: T.dock, text: 'These can be changed: under “Change the model”, type another full adjustment time (and, if you like, a cycle), tick the circuit values that may change and press Fit parameters. The new market shows blue dashed; “Use in the simulation” keeps it. Close the panel with − when you are done.', cont: true },
  ] },
  { title: 'A growing economy', goal: 'The same push, now on a trend.', setup: { ...START, ...ONE_STEP }, pins: [income, subsidy, price], subs: [
    { target: T.chipIncome, opt: 'Grows 2% a year', text: 'Open “Income” under the Housing Market and choose Grows 2% a year.', done: (g, b) => g.s.income_path === 'stable' && g.s.income_growth_pct === 2, show: { patch: GROWTH } },
    PLAY('Press ▶. The subsidy step still shows against the trend.'),
  ] },
  { title: 'Phase out a subsidy', goal: 'Remove a subsidy of 30 between 2005 and 2015: in many small steps or in a few big ones?', setup: { ...START, ...GROWTH, ...ONE_STEP }, pins: [income, subsidy, price], compare: true, subs: [
    { target: T.chipSub, opt: 'Phase-out', text: 'Open “Subsidy path” and choose Phase-out. A “Steps” slider appears next to it, starting at 20 small steps.', done: (g, b) => g.s.subsidy_path === 'staircase', show: { patch: PHASE(20) } },
    PLAY('Press ▶. Each step is small, so the price glides.'),
    { target: T.chipSub, opt: 'steps', text: 'Now the same cut in 3 big steps: set the “Steps” slider to 3. The previous run stays on the plots, grey dashed.', done: (g, b) => g.s.subsidy_path === 'staircase' && g.s.phase_steps <= 5, show: { patch: PHASE(3) } },
    PLAY('Press ▶. Each big step starts its own cycle.'),
    { target: T.chipSub, opt: 'steps', text: 'Try other numbers on the “Steps” slider: 1 step (one cut) or 10. Each time the previous run stays grey dashed, for comparison.', cont: true },
  ] },
  { title: 'Compared with the CPB model', goal: 'Feed the model the historical subsidies (calculated for this thesis) and compare it with the CPB model.', setup: { ...START, ...GROWTH, ...PHASE(3) }, pins: [subsidy, price], cpbOverlay: true, subs: [
    { target: T.chipSub, opt: 'Compare with CPB', text: 'Open “Subsidy path” and choose Compare with CPB.', done: g => g.s.subsidy_path === 'historical' && g.s.subsidy_scale === 10, show: { patch: CPB_PEAKS } },
    { target: T.cbs, text: 'Click CBS (right) for the year-on-year price change. Green dashed: the CPB model.', done: g => g.snap.charts.includes('cbs'), show: { click: T.cbs } },
    PLAY('Press ▶ and watch the year-on-year card.'),
    { target: '.pin-card.chart-card.cbs', side: true, enter: { focus: 'cbs-card' }, text: 'In the CPB model (green dashed, one value a year) the price jumps to its new level at once. The circuit adds the market’s own dynamics, found in step 2 with Identify system, so its price moves gradually, with overshoot and cycles. The match with the CBS index (grey bars) is not exact yet, but matching it was never the aim of the original CPB model. Making the model dynamic is not the whole answer; it opens doors. The multiports are modular, so a sector can be added: to follow the year-on-year house price better, the next step adds one, the financial sector.', cont: true },
  ] },
  { title: 'The real world: bank and shocks', goal: 'Add the financial sector and every historical shock.', setup: CPB_PEAKS, pins: [subsidy, price], cbs: true, cpbOverlay: true, subs: [
    { target: T.chipBank, text: 'Switch the bank on (under the Housing Market): mortgages, interest and savings now run through a financial sector.', done: g => g.s.bank, show: { patch: { bank: true } } },
    { target: T.market, text: 'Open the Housing Market to see the new flows: the financial sector sits beside the CPB quadrants, with mortgages, mortgage interest, savings, savings interest and loans to firms.', done: g => g.snap.system, show: { click: T.market } },
    { target: `${node('finance')} button.toggle`, text: 'Open the financial sector down to its elements: click + on Financial sector.', done: g => g.snap.finance, show: { click: `${node('finance')} button.toggle` } },
    { enter: { view: { finance: true, agents: ['bank'] }, focus: 'bank' }, text: 'The bank on the breadboard: mortgages, interest and savings run through its elements, built the same way as the CPB agents. Continue when you are ready.', cont: true },
    { target: T.chipShocks, opt: 'Historical', enter: { fit: true }, text: 'Open “Shocks” and choose Historical: the crisis, Covid, interest rates, mortgage lending and income, fitted to CBS.', done: (g, b) => g.s.crisis_scale > 0 && g.s.mortgage_scale === SHOCKS_CBS.mortgage_scale, show: { patch: SHOCKS_CBS } },
    { target: edge('d_income'), enter: { focus: 'system' }, text: 'Each red arrow is one disturbance entering the market. Click the Income arrow to plot it; the plot fills in when you press ▶.', done: pinned('d_income:s'), show: { click: edge('d_income') } },
    { target: edge('d_interest'), text: 'Now the Mortgage interest rate arrow, at the financial sector.', done: pinned('d_interest:s'), show: { click: edge('d_interest') } },
    { target: edge('d_crisis'), text: 'And the Financial crisis shock. The other red arrows can be clicked in the same way.', done: pinned('d_crisis:s'), show: { click: edge('d_crisis') } },
    { ...PLAY('Press ▶ and compare the model (green) with the CBS index (grey bars).'), enter: { focus: 'cbs-card' } },
    { target: '.pin-card.chart-card.cbs', side: true, enter: { focus: 'cbs-card' }, figure: 'underwater', text: 'Look at 2008 to 2013: house prices fell 21% (CPB, 2023). This is the drop that put 1 in 3 mortgages underwater. Next: a rule that keeps such a drop small.', cont: true },
  ] },
  // Underwater: the financial crisis alone (CRISIS). Measured 18 Nov 2026 (backend run, tests/test_model.py checks the
  // open loop): open loop lows -21.1% (2008.8) and -21.3% (2012.9), back at 90.6 around 2020, +5.2% in 2025. ZN: largest
  // drop 2.7%, the price rings about once a year, subsidy -10.5..46.8. H∞: largest drop 7.8% (2008.4), overshoot +9.6%
  // (2010.0), subsidy smooth 0 -> 33 -> 35 -> 0. Both rules end with a levy of -8.9 after 2021 (less mortgage debt left).
  { chapter: 'underwater', title: 'The crisis on its own', goal: 'Only the financial-crisis shock: how far does the price fall?', setup: CRISIS, pins: [crisis, mortgages, price], subs: [
    { figure: 'underwater', text: 'Solving problem 1, underwater mortgages. A mortgage goes underwater when the price falls; a rise does no harm. So we isolate the shock that caused the fall: the financial crisis, which hits the firms and the bank’s lending at the same time. Everything else is held still.', cont: true },
    PLAY('Press ▶. The financial crisis comes in two waves, in 2008 and from 2011 (a W): firms invest less and the bank lends less, also for mortgages.'),
    { target: '.pin-card[data-pin="y_price:s"]', side: true, enter: { focus: 'card:y_price:s' }, text: 'The price follows the W: in the model it falls 21% by 2009, is back by 2010, falls 21% again by 2013 and only recovers around 2020. Without a reaction, the subsidy stays where it was.', cont: true },
  ] },
  { title: 'How should the government have reacted?', goal: 'Let a rule set the subsidy from the measured price, on the crisis alone.', setup: CRISIS, pins: [price, subsidy], compareOpen: true, zn: true, subs: [
    { target: T.loop, text: 'Until now the subsidy followed a fixed path, whatever happened to the price: open loop. Closing the loop allows closed-loop feedback: the measured price goes back to the government, so the subsidy can react to what the market does. Click the switch on the feedback line to close it.', done: g => g.s.feedback, show: { click: T.loop } },
    PLAY('Press ▶. The rule now sets the subsidy from the measured price. Grey dashed: the same crisis without the rule.'),
    { target: T.ctrl, enter: { fit: true }, text: 'Click the Tax Authority to open the rule. It is a PID controller, tuned with the classic Ziegler–Nichols recipe. It looks at the gap between Parliament’s target price and the measured price, and sets the subsidy from it in three ways: P (proportional) reacts to the gap now; I (integral) to the gap added up over time, so a lasting gap is removed; D (derivative) to how fast the gap changes, so it acts early.', done: g => g.snap.controller, show: { click: T.ctrl } },
    { target: '.pin-card[data-pin="owner_subsidy:s"]', side: true, enter: { fit: true }, text: 'This is how the government could have reacted: raise the subsidy in each wave of the crisis and lower it in between. The price drop shrinks from 21% to about 3%. But look at the subsidy: it jumps up and down about once a year. Keep that in mind for the next steps.', cont: true },
    { target: T.kpUp, avoid: T.ctrl, enter: { dock: true }, text: 'Now tune it yourself. Press ▲ on P: each click makes the rule act 20% harder on the gap (more aggressive).', done: (g, b) => g.s.kp !== b.s.kp, show: { click: T.kpUp } },
    { target: T.zn, text: 'Click “⋯ Ziegler–Nichols PID” (toolbar) to keep the original rule on the cards as a light green dotted line, next to your tuned one.', done: g => g.snap.showZn, show: { click: T.zn } },
    { ...PLAY('Press ▶ to run your tuned rule on the same crisis.'), enter: { fit: true } },
    { target: '.pin-card[data-pin="y_price:s"]', side: true, enter: { focus: 'card:y_price:s' }, text: 'Three lines on the same financial crisis. Solid green: your tuned rule. Light green dotted: the original Ziegler–Nichols rule. Grey dashed: no rule. Try ▼ on P, or I and D, each time followed by ▶.', cont: true },
    { target: T.dock, text: 'For the control details and deeper analysis, look at the side panel: the gains, the root locus with its admissible region, and a search for gains that meet your own limits.', cont: true },
  ] },
  { title: 'What if the model is wrong?', goal: 'Check the rule against model error.', setup: { ...CRISIS, feedback: true }, pins: [price, subsidy], robustOnly: true, subs: [
    { target: T.robust, text: 'Click Robustness (toolbar): S, T and KS of the rule against their limits.', done: g => g.snap.sel === 'robust:', show: { click: T.robust } },
    { target: T.dock, text: 'S: shock rejection. T: robustness to model error. KS: policy effort. Ziegler–Nichols crosses the shaded limits: fast, but it trusts the model too much and pushes hard.', cont: true },
  ] },
  { title: 'A robust rule: H∞', goal: 'Replace the fast rule with one designed for model error.', setup: { ...CRISIS, feedback: true }, pins: [price, subsidy], compareOpen: true, zn: true, subs: [
    { target: T.chipCtrl, opt: 'hinf', text: 'H∞ (H-infinity) designs the rule for the worst case. Ziegler–Nichols tunes for the model as it is; H∞ chooses the gains so the loop still behaves when the model is wrong (here: every circuit value off by up to ±20%), while it still damps shocks and does not push the subsidy too hard. It is again a PID, only with other gains. Switch the rule to H∞ (under the Tax Authority).', done: (g, b) => g.s.controller === 'hinf', show: { patch: { controller: 'hinf' } } },
    PLAY('Press ▶. Grey dashed: the crisis without a rule.'),
    { target: T.robust, text: 'Open Robustness again: H∞ (dark green) next to Ziegler–Nichols (light green dotted). H∞ stays within all three limits.', done: g => g.snap.sel === 'robust:', show: { click: T.robust } },
  ], end: 'Back to the problem: in the model, the financial crisis lowers the price by at most about 8% with H∞ instead of 21% without a rule, and the subsidy moves smoothly; between the waves the price overshoots by about 10%. Ziegler–Nichols keeps the drop smaller (3%), but its subsidy jumps up and down and it fails when the model is wrong. After 2021 both rules turn the subsidy into a small levy: the crisis leaves less mortgage debt behind, which would push the price above its target.' },
  // Measured 17 Nov 2026 (backend run, fitted inputs, TREND_TARGET): price 2025 131.5 for targets 18/20.5/22%; the share
  // settles at 17.7/20.2/21.7% and money moves between the owner-occupied and the rental subsidy.
  { chapter: 'ladder', title: 'The ladder problem', goal: 'Compare what renters and owners pay for the same housing.', setup: { ...LOOP, feedback: false }, pins: [rentCost], subs: [
    { figure: 'ladder', text: 'Solving problem 2, the housing ladder. Not everyone can buy a house, so renting has to stay affordable for the people still climbing the ladder. First, what do renters and owners pay?', cont: true },
    PLAY('Press ▶. The card shows the cost per m² of housing: rent ÷ rental housing services (amber) and imputed rent ÷ owner-occupied services (blue).'),
    { target: '.pin-card[data-pin="y_rent_cost:s"]', side: true, enter: { focus: 'card:y_rent_cost:s' }, text: 'Renters pay more per m² than owners, and the gap grows: in the model, rent per m² rises 57% from 1996 to 2025 and the owner cost 38%. The people who cannot buy yet pay the most.', cont: true },
  ] },
  // Measured 17 Nov 2026 (backend run, fitted inputs, TREND_TARGET): price 2025 131.5 for targets 18/20.5/22%; the share
  // settles at 17.7/20.2/21.7%; at 22% rent per m² in 2025 is 2.84 against an owner cost of 3.41 (open loop 4.51 / 2.76).
  { title: 'A second PID controller', goal: 'Two goals, two inputs: MIMO control for owners and renters.', setup: { ...LOOP, feedback: true, controller: 'hinf', share_control: false }, pins: [price, share, rentCost, subsidy, rentalSub], subs: [
    { target: T.ctrl, side: true, text: 'Two goals at once: the price (output y₁) and the rental share of housing (output y₂). One input can hold one output at its target, so two outputs need two inputs: the owner-occupied subsidy and the rental subsidy. A system with several inputs and several outputs is MIMO (multiple input, multiple output).', cont: true },
    { target: T.ctrl, side: true, text: 'The difficulty of MIMO control: each subsidy moves both outputs, so two separate rules can work against each other. The design used here avoids that. A second PID controller watches the rental share and only moves money between the two subsidies: what it adds to the rental subsidy, it takes from the owner-occupied subsidy. Both subsidies move the price by about the same amount, so the price hardly feels the shift and the first PID controller keeps the price on target.', cont: true },
    { target: T.chipShare, opt: 'on', text: 'Add the second PID controller: click “+ PID” next to Rental share, at the Tax Authority.', done: g => g.s.share_control, show: { patch: { share_control: true } } },
    PLAY('Press ▶. Two PID controllers now work side by side: the first holds the price, the second the rental share.'),
    { target: T.chipShare, opt: 'target', text: 'Move the rental-share target, for example to 22%, to help renters.', done: (g, b) => g.s.share_target_pct !== b.s.share_target_pct, show: { patch: { share_target_pct: 22 } } },
    PLAY('Press ▶ and watch the cost card and the two subsidy cards.'),
    { target: '.pin-card[data-pin="y_rent_cost:s"]', side: true, enter: { fit: true }, text: 'The trade-off made visible: money moves from the owner-occupied to the rental subsidy, rent per m² falls (at 22% even below the owner cost), and the price hardly moves. Building more homes would help every group at once, but the government does not build itself: it steers with subsidies.', cont: true },
  ] },
  // Maximum stability (Jesse, 17 Nov 2026): not one of the two problems, an extra chapter after them. Measured 17 Nov 2026
  // (drop.py, fitted inputs, TREND_TARGET): 2008 drop 36% open loop, 4.2% H∞; H∞ subsidy -44 to +94.
  { chapter: 'stability', title: 'All shocks at once', goal: 'How far can a rule steer the whole market towards stability?', setup: { ...LOOP, controller: 'hinf' }, pins: [subsidy, yoy], compareOpen: true, subs: [
    { text: 'An extra question beyond the two problems: how far can the government steer the market towards maximum stability? Now every historical shock is on: the crisis, Covid, interest rates, mortgage lending and income, and the rule (H∞) damps every swing, booms as well as busts.', cont: true },
    { target: T.loop, text: 'Close the loop again: click the switch on the feedback line.', done: g => g.s.feedback, show: { click: T.loop } },
    { target: edge('shocks'), text: 'Click the red disturbance arrow (d): all six disturbances open as plots at once.', done: g => g.snap.pins.filter(k => k.startsWith('d_')).length >= 6, show: { click: edge('shocks') } },
    PLAY('Press ▶. The rule now sets the subsidy from the measured price, and the price follows. Grey dashed: history without the rule.'),
    { target: '.pin-card[data-pin="y_yoy:s"]', side: true, enter: { focus: 'card:y_yoy:s' }, text: 'The year-on-year price change with the rule (green) and with the historical subsidies (grey dashed): the cycles are almost gone.', cont: true },
  ], end: 'Maximum stability has a price: with every historical shock, the H∞ rule keeps the 2008 drop near 4% instead of 36%, but the subsidy swings from −44 to +94 and becomes a levy in the booms. The underwater problem needed only the support in the crisis, not the levy.' },
  { title: 'Absorb a shock', goal: 'Hit the market with one shock and see what the rule does.', setup: { ...LOOP, feedback: true, controller: 'hinf' }, pins: [price, subsidy], cbs: true, rejectSize: true, subs: [
    { target: T.stepMode, text: 'A step is a sudden change in one input that then stays, for example the mortgage interest rate rising by one percentage point and staying there. The step response shows how the market, and the rule, react to it over the following years. Switch the plots to Step response (toolbar).', done: g => g.snap.stepping, show: { click: T.stepMode } },
    { target: T.chipShocks, opt: 'd_interest', text: 'Open “Step in” under the Housing Market and choose Mortgage interest rate: a rise of one percentage point.', done: g => g.snap.stepInput === 'd_interest', show: { cmd: { stepInput: 'd_interest' } } },
    PLAY('Press ▶. Solid: with the rule. Grey dashed: the same shock without it.'),
    { target: T.chipShocks, text: 'Pick another shock, such as the financial crisis, and press ▶ to compare.', done: (g, b) => g.snap.stepInput !== b.snap.stepInput, show: { cmd: { stepInput: 'd_crisis' } } },
  ], end: 'Two problems, one approach: a dynamic model and a controller designed for it. The canvas is yours: explore on your own.' },
];

/** The chapter a step belongs to: the last chapter start at or before it. */
export function chapterOf(i: number): ChapterId { for (let k = i; k >= 0; k--) { const c = GUIDE[k].chapter; if (c) return c; } return 'intro'; }

// Click a canvas target as a visitor would (React handlers listen to bubbling clicks; the card position uses the pointer).
export function clickTarget(sel: string) {
  const el = document.querySelector(sel) as HTMLElement | SVGElement | null; if (!el) return;
  const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window }));
}

/** Top bar of the guided tour: the steps, the goal of this one, Back / Next / leave. */
export function GuideBar({ step, go, exit, busy }: { step: number; go: (i: number) => void; exit: () => void; busy: boolean }) {
  const t = GUIDE[step];
  return <div className="tour-bar guide-bar" role="region" aria-label="Guided tour" data-no-shot>
    <div className="chapters">{(Object.keys(CHAPTERS) as ChapterId[]).map(c => { const ch = CHAPTERS[c], idx = GUIDE.map((_, i) => i).filter(i => chapterOf(i) === c);
      return <div key={c} className={`chapter${chapterOf(step) === c ? ' current' : ''}`} style={{ '--ch': ch.color, '--ch-soft': ch.soft } as React.CSSProperties}>
        <span className="chapter-label">{ch.part && <em>{ch.part} · </em>}{ch.label}</span>
        <div className="tour-steps">{idx.map(i => <button key={i} className={i === step ? 'on' : i < step ? 'done' : ''} disabled={busy} title={GUIDE[i].title} aria-label={`Guide step ${i + 1}: ${GUIDE[i].title}`} onClick={() => go(i)}>{i + 1}</button>)}</div>
      </div>; })}</div>
    <div className="tour-text"><strong>{step + 1}. {t.title}</strong><span>{t.goal}</span></div>
    <div className="tour-nav"><button className="ghost" disabled={busy || step === 0} onClick={() => go(step - 1)}><ChevronLeft size={15}/> Back</button>
      <button className="ghost" disabled={busy || step === GUIDE.length - 1} onClick={() => go(step + 1)}>Skip step <ChevronRight size={15}/></button>
      <button className="ghost" aria-label="Leave the guided tour" title="Leave the guided tour" onClick={exit}><X size={15}/></button></div>
  </div>;
}

/** Pulsing ring on the target and a speech bubble next to it (fixed to the window, follows the canvas). */
export function Coach({ step, sub, busy, onShow, onContinue, onNext, onExit }: { step: number; sub: number; busy: boolean; onShow: () => void; onContinue: () => void; onNext: () => void; onExit: () => void }) {
  const t = GUIDE[step], s = t.subs[sub], last = step === GUIDE.length - 1;
  const [rect, setRect] = useState<DOMRect | null>(null), [area, setArea] = useState<DOMRect | null>(null);
  // the bubble's own height, so a long text never runs off the bottom (or top) of the window
  const bubble = useRef<HTMLDivElement>(null), [bh, setBh] = useState(220);
  useLayoutEffect(() => { const h = bubble.current?.offsetHeight; if (h && Math.abs(h - bh) > 2) setBh(h); });
  useEffect(() => {
    const sel = s?.target; if (!sel) { setRect(null); setArea(null); return; }
    // every frame, so the ring stays on the target while the canvas moves; an open picker menu counts as part of it
    let raf = 0, last = '';
    const measure = () => {
      const el = document.querySelector(sel), o = s?.opt ? el?.querySelector(`[data-opt="${s.opt}"]`)?.getBoundingClientRect() : null;
      const r = el?.getBoundingClientRect(), m = el?.querySelector('.chip-menu')?.getBoundingClientRect();
      const u = r && m ? new DOMRect(Math.min(r.left, m.left), Math.min(r.top, m.top), Math.max(r.right, m.right) - Math.min(r.left, m.left), Math.max(r.bottom, m.bottom) - Math.min(r.top, m.top)) : r;
      const ok = u && u.width + u.height > 0 && u.bottom > 0 && u.top < window.innerHeight ? u : null, k = ok ? [ok.left, ok.top, ok.width, ok.height].map(Math.round).join() : '';
      // the bubble keeps off the target and, when set, the block around it
      const a = s?.avoid ? document.querySelector(s.avoid)?.getBoundingClientRect() : null;
      const v = ok && a ? new DOMRect(Math.min(ok.left, a.left), Math.min(ok.top, a.top), Math.max(ok.right, a.right) - Math.min(ok.left, a.left), Math.max(ok.bottom, a.bottom) - Math.min(ok.top, a.top)) : ok;
      const kk = k + (v ? [v.left, v.top, v.width, v.height].map(Math.round).join() : '');
      const ringAt = o && o.width > 0 ? o : ok, k2 = kk + (ringAt ? [ringAt.left, ringAt.top].map(Math.round).join() : '');
      if (k2 !== last) { last = k2; setRect(ringAt); setArea(v); }
      raf = requestAnimationFrame(measure);
    };
    measure(); return () => cancelAnimationFrame(raf);
  }, [s?.target, step, sub]);
  // the bubble can be dragged by its header (out of the way of what you are looking at); a new step resets it
  const [off, setOff] = useState({ x: 0, y: 0 });
  useEffect(() => { setOff({ x: 0, y: 0 }); }, [step]);
  const drag = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    const x0 = e.clientX - off.x, y0 = e.clientY - off.y, el = e.currentTarget as HTMLElement; el.setPointerCapture(e.pointerId);
    const move = (m: PointerEvent) => setOff({ x: m.clientX - x0, y: m.clientY - y0 });
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up);
  };
  const W = 340, pad = 14, vw = window.innerWidth, vh = window.innerHeight;
  // bubble below the target when there is room, otherwise above it; docked at the bottom when there is no target
  let pos: React.CSSProperties = { left: 24, bottom: 84 };  // no target: out of the way, bottom left
  const box = area ?? rect;
  if (box && s) {
    const left = Math.min(Math.max(box.left + box.width / 2 - W / 2, 12), vw - W - 12);
    const besideL = box.left - W - pad, besideR = box.right + pad, top = Math.max(Math.min(box.top, vh - 260), 12);
    if (s.side && (besideL >= 12 || besideR + W < vw)) pos = { left: besideL >= 12 ? besideL : besideR, top };
    else pos = box.bottom + 200 < vh ? { left, top: box.bottom + pad } : box.top > 220 ? { left, bottom: vh - box.top + pad }
      : { left: box.right + W + pad < vw ? box.right + pad : Math.max(box.left - W - pad, 12), top: Math.max(Math.min(box.top, vh - 240), 12) };
  }
  const fit = (p: React.CSSProperties): React.CSSProperties => {
    const top = typeof p.top === 'number' ? p.top : typeof p.bottom === 'number' ? vh - p.bottom - bh : 12;
    return { left: p.left, top: Math.max(8, Math.min(top, vh - bh - 8)) };
  };
  return <>
    {rect && s?.target && <div className="coach-ring" style={{ left: rect.left - 6, top: rect.top - 6, width: rect.width + 12, height: rect.height + 12 }}/>}
    <div ref={bubble} className="coach" role="dialog" aria-label="Guided tour hint" style={{ ...fit(pos), width: W, transform: `translate(${off.x}px, ${off.y}px)` }} data-no-shot>
      <div className="coach-head" onPointerDown={drag} title="Drag to move"><MousePointerClick size={15}/><b>Step {step + 1} · {s ? `${sub + 1} of ${t.subs.length}` : 'done'}</b><span className="coach-chapter" style={{ color: CHAPTERS[chapterOf(step)].color }}>{CHAPTERS[chapterOf(step)].label}</span><button className="ghost coach-x" aria-label="Leave the guided tour" onClick={onExit}><X size={14}/></button></div>
      {s?.figure && <Figure kind={s.figure} small/>}
      {s ? <p>{s.text}</p> : t.end ? <p><b>{t.end}</b></p> : null}
      <div className="coach-actions">
        {s?.show && <button className="ghost" disabled={busy} onClick={onShow}>Show me</button>}
        {s?.cont && <button className="primary" disabled={busy} onClick={onContinue}>Continue</button>}
        {s && !s.cont && <button className="ghost" disabled={busy} onClick={onContinue} title="Skip this click">Skip</button>}
        {!s && (last ? <button className="primary" onClick={onExit}>Explore on my own</button> : <button className="primary" disabled={busy} onClick={onNext}>Next step <ChevronRight size={15}/></button>)}
      </div>
    </div>
  </>;
}

/** The two problems, drawn: a house under the water line (mortgage above the value), and a ladder whose rungs move apart. */
export function Figure({ kind, small }: { kind: 'underwater' | 'ladder'; small?: boolean }) {
  const cls = `problem-fig fig${small ? ' small' : ''}`;
  // The two figures of the landing page (economicsystemsandcontrol.com, 24 Nov 2026): the CBS house price index 2006-2014
  // (peak 2008 = 100, -21% to 2013) and the housing ladder (CPB, 2026).
  if (kind === 'underwater') return <svg className={cls} viewBox="0 0 380 160" role="img" aria-label="CBS house price index 2006 to 2014, peak 2008 = 100: the price falls 21% to 2013, below the price paid at the peak">
<line className="fg-grid" x1="44" y1="108.0" x2="370" y2="108.0"/><text className="fg-mut" x="38" y="111.5" textAnchor="end">80</text><line className="fg-grid" x1="44" y1="74.0" x2="370" y2="74.0"/><text className="fg-mut" x="38" y="77.5" textAnchor="end">90</text><line className="fg-grid" x1="44" y1="40.0" x2="370" y2="40.0"/><text className="fg-mut" x="38" y="43.5" textAnchor="end">100</text>
<text className="fg-mut" x="8" y="12" fontSize="9.5">house price index (peak 2008 = 100)</text>
<line className="fg-axis" x1="44" y1="131" x2="370" y2="131"/>
<g className="fg-mut" textAnchor="middle"><text x="50.0" y="146">2006</text><text x="121.1" y="146">2008</text><text x="192.2" y="146">2010</text><text x="263.3" y="146">2012</text><text x="334.4" y="146">2014</text></g>
<path d="M143.3,40.0 L152.2,42.5 L161.1,44.8 L170.0,53.3 L178.9,57.7 L187.8,60.6 L196.7,60.9 L205.6,60.6 L214.4,60.3 L223.3,64.0 L232.2,65.7 L241.1,67.1 L250.0,69.3 L258.9,74.7 L267.8,78.6 L276.7,84.3 L285.6,96.1 L294.4,97.8 L303.3,104.3 L312.2,109.9 L321.1,109.1 L330.0,109.9 L338.9,108.5 L347.8,106.8 L356.7,104.3 L365.6,104.0 L365.6,40.0 Z" fill="#c0392b" fillOpacity=".13"/>
<line className="fg-ref" x1="143.3" y1="40.0" x2="365.6" y2="40.0"/>
<polyline className="fg-line" points="54.4,70.7 63.3,67.1 72.2,63.1 81.1,61.7 90.0,58.1 98.9,54.1 107.8,49.3 116.7,48.2 125.6,43.9 134.4,43.7 143.3,40.0 152.2,42.5 161.1,44.8 170.0,53.3 178.9,57.7 187.8,60.6 196.7,60.9 205.6,60.6 214.4,60.3 223.3,64.0 232.2,65.7 241.1,67.1 250.0,69.3 258.9,74.7 267.8,78.6 276.7,84.3 285.6,96.1 294.4,97.8 303.3,104.3 312.2,109.9 321.1,109.1 330.0,109.9 338.9,108.5 347.8,106.8 356.7,104.3 365.6,104.0"/>
<circle className="fg-dot" cx="143.3" cy="40.0" r="3.2"/><circle cx="312.2" cy="109.9" r="3.2" fill="#c0392b"/>
<text className="fg-ink" x="151.3" y="34.0">price paid at the 2008 peak</text>
<text className="fg-ink" x="62" y="79.1">home value</text>
<text x="242.0" y="58.4" fill="#c0392b" fontWeight="600">underwater</text>
<text x="306.2" y="125.9" fill="#c0392b" fontWeight="600">−21%</text>
</svg>;
  return <svg className={cls} viewBox="0 0 380 150" role="img" aria-label="Housing ladder from social rent to a detached house: with a starter subsidy one household climbs up, and without new homes another drops down">
<defs><marker id="fg-ag" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#3f9a1f"/></marker>
<marker id="fg-ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#c0392b"/></marker></defs>
<line x1="168" y1="12" x2="168" y2="140" stroke="#a7aeab" strokeWidth="2.5"/><line x1="218" y1="12" x2="218" y2="140" stroke="#a7aeab" strokeWidth="2.5"/>
<line x1="168" y1="30" x2="218" y2="30" stroke="#a7aeab" strokeWidth="2.5"/>
<g transform="translate(150,29) scale(1.15) translate(-145,-29)"><path d="M134,29 V19 L145,11 L156,19 V29 Z" fill="#7f8c87"/><rect x="137" y="21" width="4" height="4" fill="#fff"/><rect x="149" y="21" width="4" height="4" fill="#fff"/><rect x="143" y="23" width="4" height="6" fill="#fff"/></g>
<line x1="168" y1="54" x2="218" y2="54" stroke="#a7aeab" strokeWidth="2.5"/>
<g transform="translate(150,53) scale(1.15) translate(-145,-53)"><path d="M134,53 V44 L139,38 L144,44 L149,38 L154,44 V53 Z" fill="#7f8c87"/><rect x="137.5" y="48" width="3" height="5" fill="#fff"/><rect x="147.5" y="48" width="3" height="5" fill="#fff"/></g>
<line x1="168" y1="78" x2="218" y2="78" stroke="#a7aeab" strokeWidth="2.5"/>
<g transform="translate(150,77) scale(1.15) translate(-145,-77)"><path d="M134,77 V69 L141,63 L148,69 V77 Z" fill="#7f8c87"/><rect x="139.5" y="72" width="3" height="5" fill="#fff"/></g>
<line x1="168" y1="102" x2="218" y2="102" stroke="#a7aeab" strokeWidth="2.5"/>
<g transform="translate(150,101) scale(1.15) translate(-145,-101)"><rect x="134" y="87" width="16" height="14" fill="#7f8c87"/><rect x="137" y="90" width="3" height="3" fill="#fff"/><rect x="144" y="90" width="3" height="3" fill="#fff"/><rect x="140.5" y="95" width="3" height="6" fill="#fff"/></g>
<line x1="168" y1="126" x2="218" y2="126" stroke="#a7aeab" strokeWidth="2.5"/>
<g transform="translate(150,125) scale(1.15) translate(-145,-125)"><rect x="134" y="107" width="16" height="18" fill="#7f8c87"/><rect x="137" y="110" width="3" height="3" fill="#fff"/><rect x="137" y="115" width="3" height="3" fill="#fff"/><rect x="137" y="120" width="3" height="3" fill="#fff"/><rect x="143" y="110" width="3" height="3" fill="#fff"/><rect x="143" y="115" width="3" height="3" fill="#fff"/><rect x="143" y="120" width="3" height="3" fill="#fff"/></g>
<circle cx="207" cy="61" r="3.3" fill="#3f9a1f"/><path d="M203,66 h8 l-1,7 h-6 z" fill="#3f9a1f"/><path d="M204,73 l-1.5,5 M210,73 l1.5,5" stroke="#3f9a1f" strokeWidth="2.2" strokeLinecap="round"/><path d="M211,67 l4,-6" stroke="#3f9a1f" strokeWidth="2" strokeLinecap="round"/>
<circle cx="180" cy="85" r="3.3" fill="#8a5a12"/><path d="M176,90 h8 l-1,7 h-6 z" fill="#8a5a12"/><path d="M177,97 l-1.5,5 M183,97 l1.5,5" stroke="#8a5a12" strokeWidth="2.2" strokeLinecap="round"/>
<path d="M226,99 C246,95 246,82 226,76" fill="none" stroke="#3f9a1f" strokeWidth="1.8" markerEnd="url(#fg-ag)"/>
<path d="M180,66 C166,72 166,82 176,84" fill="none" stroke="#c0392b" strokeWidth="1.6" strokeDasharray="3 2" markerEnd="url(#fg-ar)"/>
<text x="252" y="80" fill="#3f9a1f" fontWeight="600">starter subsidy:</text><text x="252" y="93" fill="#3f9a1f">one climbs up</text>
<text x="252" y="112" fill="#c0392b" fontWeight="600">no new homes:</text><text x="252" y="125" fill="#c0392b">another drops down</text>
</svg>;
}

const SRC = {
  dnb: 'https://www.dnb.nl/actuele-economische-vraagstukken/woningmarkt/onze-hoge-hypotheekschulden-risico-s-en-oplossingen/',
  cpb23: 'https://www.cpb.nl/sites/default/files/omnidownload/CPB-Publicatie-Ontwikkelingen-op-de-woningmarkt-en-financiele-risicos.pdf',
  esb: 'https://esb.nu/mobiliteit-bij-hoge-hypotheekschuld/',
  cpb20: 'https://www.cpb.nl/sites/default/files/omnidownload/CPB-Position-Paper-Woningtekort-starters-en-middeninkomens.pdf',
  cpbLti: 'https://www.cpb.nl/sites/default/files/omnidownload/CPB-Publicatie-De-impact-van-leennormen-op-huurders-huizenbezitters-en-investeerders.pdf',
};
const src = (href: string, label: string) => <a href={href} target="_blank" rel="noreferrer">{label}</a>;
// tour steps the cards and the strip point to (indices into GUIDE)
const AT = { model: GUIDE.findIndex(x => x.chapter === 'model'), tune: 5, control: GUIDE.findIndex(x => x.chapter === 'underwater'), robust: GUIDE.findIndex(x => x.title === 'What if the model is wrong?'), ladder: GUIDE.findIndex(x => x.chapter === 'ladder') };

/** First visit: the two problems, then the offer of the guided tour. */
export function Welcome({ start, close }: { start: (step: number) => void; close: () => void }) {
  return <div className="backdrop"><section className="modal welcome problems" role="dialog" aria-modal="true" aria-label="Welcome">
    <p className="eyebrow">Housing Policy Lab</p>
    <h2>Two problems in the Dutch housing market, and how control engineering can tackle them</h2>
    {/* The full guided tour is the main call to action (Jesse, 17 Nov 2026); the cards only offer a jump into one part. */}
    <div className="tour-cta">
      <button className="primary big" onClick={() => start(0)}>Take the full guided tour</button>
      <p>About 5 minutes, {GUIDE.length} steps: the two problems, the model and the solutions. The tour shows you where to click.</p>
      <button className="link" onClick={close}>or explore on my own</button>
    </div>
    <div className="problem-cards">
      <article className="problem-card underwater">
        <Figure kind="underwater"/>
        <h3>Underwater mortgages</h3>
        <p>When house prices fall, mortgages end up underwater. Households cut spending and stop moving, and the recession deepens.</p>
        <ul>
          <li><b>1 in 3</b> Dutch households with a mortgage ended up underwater, 2009–2013 ({src(SRC.dnb, 'DNB')})</li>
          <li>House prices fell <b>21%</b> from 2008 to 2013 ({src(SRC.cpb23, 'CPB, 2023')})</li>
          <li>Owners whose mortgage exceeded their home’s value were <b>22%</b> less likely to move ({src(SRC.esb, 'ESB, 2017')})</li>
        </ul>
        <p className="how"><b>How we tackle it:</b> isolate the crisis and let a robust controller steer the subsidy: raise it while prices fall, so the drop stays small, even when the model is wrong.</p>
        <button className="link jump" onClick={() => start(AT.control)}>Jump to this part of the tour →</button>
      </article>
      <article className="problem-card ladder">
        <Figure kind="ladder"/>
        <h3>The housing ladder</h3>
        <p>Policy that helps one group worsens the position of another: help first-time buyers and prices rise for everyone else.</p>
        <ul>
          <li>Targeted housing policy improves one group’s position and worsens another’s ({src(SRC.cpb20, 'CPB, 2020')})</li>
          <li>Looser borrowing limits raise prices; when supply can’t keep up, the gain goes to existing owners ({src(SRC.cpbLti, 'CPB, 2023')})</li>
        </ul>
        <p className="how"><b>How we tackle it:</b> a multivariable controller steers two subsidies at once and makes the trade-off between groups visible. Building more homes would help every group at once, but the government does not build itself: it steers with subsidies.</p>
        <button className="link jump" onClick={() => start(AT.ladder)}>Jump to this part of the tour →</button>
      </article>
    </div>
    <p className="muted small jump-label">Or jump straight to a part:</p>
    <ol className="method-strip">
      <li><button className="link" onClick={() => start(AT.model)}><span>1</span>Build a dynamic model</button></li>
      <li><button className="link" onClick={() => start(AT.tune)}><span>2</span>Tune it on real cycles and the CPB model</button></li>
      <li><button className="link" onClick={() => start(AT.control)}><span>3</span>Design a controller that tackles the problem</button></li>
    </ol>
    <div className="row"><button className="primary" onClick={() => start(0)}>Take the full guided tour</button><button className="ghost" onClick={close}>Explore on my own</button></div>
  </section></div>;
}
