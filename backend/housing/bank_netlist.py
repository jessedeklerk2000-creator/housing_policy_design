"""Bank controls: the ALM desk as the controller of a coupled bank + housing netlist (experimental, 20 Nov 2026).

A SEPARATE netlist, built at run time from a copy of the housing netlist lines; the housing model itself is untouched.
Bank and ALM structure after B.S.R. Menkveld (MSc thesis, TU Delft), coupled to the housing netlist where the netlist
already has the ports:
  - Mortgage book: the netlist's own debt integrator B§Mortgage_Debt. The outside input I§Mortgages becomes endogenous:
      dM/dt = theta*V*l_new - theta*M - M/T   (movers re-borrow at today's value within LTV/LTI limits; amortisation)
    with theta lower when underwater (ESB 2017) and V = V0 * house price / start price.
  - Mortgage rate r_m = FTP + spread drives B§Mortgage_interest (debt x rate) instead of the fixed Interest_Rates input.
    The netlist's rate channel is weak (+1 pp -> -0.12% price), so the change is multiplied by k_rate (demo choice).
  - Savings rate r_s = FTP - spread drives B2, the savings-interest flow (L15), which was a constant 5.
  - Government: the owner-occupied subsidy source, a user-set step (a disturbance, not a controller here).
  - Crisis: starts at the other banks only (26 Nov 2026): they withdraw wholesale funding and raise the interbank premium.
    Timing follows the netlist's W-shaped firm-credit path (I8), used as a clock only. No direct shock at the firms:
    the bank passes the funding loss on through its own firm lending (credit supply, Khwaja & Mian 2008) and its rates.
  - ALM desk: PI on FTP for the loan-to-FUNDING ratio (loans / (deposits + wholesale funding); Menkveld uses
    loan-to-deposit, which a funding run does not move) and PI on the spread for the Tier 1 ratio.
Covid: the netlist's own Covid shock at the firms stays in (Jesse, 20 Nov 2026).
Bank sizes in illustrative units (book 100 = the netlist's debt start). Time: 6 sim-s = 1 year.
Numbers are demo choices by Claude (20 Nov 2026), see BANK_DEFAULTS; not calibrated to any real bank.
"""
from __future__ import annotations
from functools import lru_cache
import math
import numpy as np
from scipy.stats import norm
from . import ngspice
from .bank_ledger import ledger as bank_ledger
from .scenario import YEAR_AT_RAW_ZERO, Scenario, build, evaluate

YR = 6.0
T0 = 6.01  # .tran start (sim-s): year 0 of the traces

# The netlist base: the "crisis on its own" setup of the guided tour (equilibrium start, open loop, no subsidy, flat
# income and interest), with mortgages handed to the bank and the shock at the firms switched off below.
BASE = dict(bank=True, crisis_scale=2, covid_scale=0, crisis_w=True, crisis_w_start_yr=2007.8, crisis_w_fall_yr=0.8,
            crisis_w_scale=1, crisis_w_on_yr=0.8, crisis_w_recovery_yr=0.8, crisis_w_floor=0, crisis_start_yr=2011.1,
            rental_subsidy=False, share_control=False, feedback=False, param_scale={}, subsidy_path="historical",
            subsidy_scale=0, income_path="stable", income_growth_pct=0, income_scale=1, mortgage_scale=0,
            interest_path="flat", crisis_mortgage_cut=0, inflation_pct=0, reference_base=90.64, target_growth_pct=0,
            controller="zn", equilibrium_start=True)

BANK_DEFAULTS = dict(
    M0=100.0, Lf0=40.0, W0=30.0, E0=8.5, Dep0=110.0,         # balance sheet (illustrative units)
    theta0=0.06, uw_mobility=0.22, T_amort=60.0, ltv_cap=1.0, lti0=0.95, soft=0.05, sigma_ltv=0.45,
    loss_uw=0.004, rw_lo=0.12, rw_hi=0.45, ltv_split=0.55, eta_dep=0.054, tau_dep=1.0, r_mkt=0.025, ftp0=0.026, s0=0.022, w_prem=0.005,
    Kp_ftp=0.05, Ki_ftp=0.05, Kp_s=0.20, Ki_s=0.20,           # ALM desk (PI on FTP and on the spread)
    # eta_dep (26 Nov 2026): savings deposits rise 5.4% per pp the savings rate rises against the market rate: Drechsler,
    # Savov & Schnabl (2017, QJE 132(4); NBER WP 22152 p. 26): a 54 bp wider savings spread goes with 2.9% lower savings
    # deposit growth, a price elasticity of -5.4 (US 1994-2014; applying it to the Netherlands is an assumption). The money
    # leaves the banking system (bonds, funds): the households' alternative to savings, here implicit.
    # Menkveld (2025) eq. 3-4 and 3-8: FTP = (loan + savings)/2, spread = loan - savings, so loan = FTP + spread/2.
    # spread0 2.2% and the spread gains 0.20 give exactly the dynamics of the earlier FTP +/- s form (s0 1.1%, gains 0.10).
    k_rate=300.0,          # rate-channel gain, demo choice (24 Nov 2026, NSFR loop with Basel factors): -7% house price in the
                           # crisis from the bank channel alone; settles up to 500, runs away from about 700.
    funding_cut=0.5,       # share of wholesale funding other banks withdraw in the crisis
    # Interbank premium at the crisis peak (26 Nov 2026): the 3-month EURIBOR-EONIA swap spread rose from about 5 bp
    # before August 2007 to about 190-200 bp in October 2008 (ECB Financial Stability Review Dec 2008, Chart 3.2, p. 61;
    # values read off the chart by Claude), so +1.9 pp.
    premium_pp=1.9,
    # A funding gap (negative cash) is borrowed from the central bank at its marginal lending facility: the policy rate
    # (here r_mkt) + 1 pp, the ECB corridor of 200 bp around the MRO rate (ECB press releases 8 Oct and 18 Dec 2008; the
    # corridor was 100 bp, i.e. +0.5 pp, from 9 Oct 2008 to 21 Jan 2009). No interbank premium on central-bank money.
    gap_penalty_pp=1.0,
    # Yield curve (feedback round 2 B2, 26 Nov 2026): static, a parallel shift with r_mkt (the short end). Term premia =
    # average spread of the 5-year and 10-year over the 1-year spot rate on the ECB euro-area AAA government yield curve
    # (ECB Data Portal, series YC.B.U2.EUR.4F.G_N_A.SV_C_YM.SR_1Y/5Y/10Y, business days 6 Sep 2004 - 25 Nov 2026, 5682 days;
    # computed by Claude): +0.44 pp and +1.02 pp. Dutch mortgages are mostly fixed for 10 years, so the mortgage rate is
    # read against the 10-year point (its margin is reported in the metrics). The netlist's rates are unchanged by it.
    # extended to 30 years (Jesse, 26 Nov 2026): same series and window, 2y +0.08, 20y +1.46, 30y +1.51 pp
    tp2=0.0008, tp5=0.0044, tp10=0.0102, tp20=0.0146, tp30=0.0151,
    # Competitor bank (feedback round 2 B3, M. Mendel; Menkveld Fig. 3-10: two banks competing for the same households).
    # Off by default (competitor=0), so the one-bank results stay as they are. When on, the netlist's mortgage debt is the
    # whole market (start M0 + Mc0) and the bank's book is the market minus the competitor's book. New lending is split by
    # a logit on the rate gap; households pay the share-weighted rate. Values: README / M. Mendel (rate 0.3 pp sharper,
    # market share +10% per 0.1 pp at the start, more wholesale funding, a thinner buffer) and Claude's choices for the
    # sizes (book 25, savings 8, other banks 17, equity 0.62: Tier 1 at the start ~0.82 x the bank's, the ratio of the SOT
    # handoff's Tier 1 14 vs 17). Not calibrated; not tuned to give a story.
    competitor=0.0, comp_gap_pp=0.3, comp_share_per_pp=1.0, Mc0=25.0, Depc0=8.0, Wc0=17.0, Ec0=0.62,
    # Rate shock (SOT scenario on the canvas, 26 Nov 2026): shock_scen 0 = none, 1-6 = the six EU RTS 2024/856 scenarios
    # (parallel up/down, steepener, flattener, short up/down; EU sizes), a step at shock_year. It enters the market rates:
    # the short end (3 months) moves r_mkt (reserves, interbank, central bank), the 10-year point the mortgage rate (Dutch
    # mortgages mostly 10-year fixed), and savers compare their rate with the shocked market rate; the savings rate passes
    # on dep_beta of the short shock (0.5, as in the SOT handoff). The ALM desk reacts on top of that.
    shock_scen=0.0, shock_year=3.0, dep_beta=0.5,
    gov_step=0.0, gov_year=5.0,  # government subsidy step (model units) and the year it starts
    # Firm loans (24 Nov 2026): a short stock fed by the netlist's firm-loan port I8 (30 a year), repaid in Lf0/30 years;
    # firms borrow eta_firm less per pp the loan rate is above its start; the loan interest B5 floats with the loan rate.
    firm_new0=30.0, eta_firm=0.10,
    # Credit supply (26 Nov 2026): new firm lending falls by credit_supply % per 1% of funding (savings + deposits of
    # other banks) the bank has lost. 0.6: Khwaja & Mian (2008), AER 98(4):1413-1442, within-firm estimate for Pakistan
    # after the 1998 nuclear tests (a 1% larger liquidity drop at a bank -> 0.6% less lending to the same firm). Applied
    # here to a Dutch bank, which is an assumption. Iyer et al. (2014, RFS 27(1):347-372) find the same direction for
    # Portugal 2007-08 (banks that relied more on interbank funding cut firm credit more). Applied to the flow of new
    # loans; with a firm-book turnover of Lf0/firm_new0 = 1.3 years the stock follows within about that time.
    credit_supply=0.6,
    # Credit conditions -> house prices (26 Nov 2026). In the netlist mortgages enter the households' housing node only as
    # the net flow, so a permanent cut in lending lowers the book but not the price (measured: book -8%, price 0%).
    # Target: DNB Occasional Studies 13-2 (Verbruggen et al. 2015, p. 8-9): lowering the LTV limit to 90% gives mortgage
    # debt almost -6% and house prices -4 to -5% in the long run (3.5-4% after five years), so ~0.75% price per 1% debt.
    # k_credit (model units of the price current per unit of the lending-supply factor) is set so that a permanent cut
    # in lending supply gives that ratio after 15 years with rates frozen (calibrated by Claude 26 Nov 2026; 90 gives 0.64, 130 gives 0.81).
    k_credit=110.0,  # 10% permanent supply cut: book -10.7%, price -7.9% after 23 years (ratio 0.74)
    # NSFR (Basel III, BCBS 2014): available stable funding factors: capital 100%, less stable retail deposits 90% (stable
    # 95% gives the same results), funding from financial institutions with less than six months to maturity 0% (the
    # interbank funding that ran in 2008 was short-term; Jesse 24 Nov 2026); required stable funding factors: residential
    # mortgages 65%, loans to firms under one year 50%, cash 0%. Check against the BCBS text.
    asf_dep=0.90, asf_w=0.0, rsf_m=0.65, rsf_f=0.50,
    # Risk weights (24 Nov 2026, sources checked): mortgages: DNB minimum risk weight (Art. 458 CRR, in force 2022-2024;
    # EBA-Op-2020-03 par. 10-11, ESRB notification 11 Oct 2022): 12% on the part of each loan up to 55% of the home's
    # value, 45% on the rest; the floor is the exposure-weighted average over the portfolio and binds, since IRB banks'
    # own average was ~11% (EBA-Op-2020-03 par. 15). Applied over the model's own loan-LTV spread (sigma_ltv, the same
    # lognormal as the underwater share). Firm loans: 100%, unrated corporate exposures (Basel CRE20.43).
    rw_firm=1.0,
    covid_scale=1.0,       # the housing netlist's own Covid shock at the firms (x1 as in the main model, year 24)
    hist_subsidy=1.0,      # historical owner-occupied subsidy path of the main model (x1; 0 switches it off), 24 Nov 2026
)
P_START = 90.64  # house price at the equilibrium start (I(Construction_cost)) without the historical subsidy
P_PER_SUBSIDY = 12.2516  # start price rises linearly with the historical subsidy scale (measured 24 Nov 2026: x1 102.90, x2 115.15, x5 151.88)


def equilibrium(b: dict) -> dict:
    """Start values so that the book, deposits and equity are at rest at t = 0."""
    l0 = -b["soft"] * np.logaddexp(-b["ltv_cap"] / b["soft"], -b["lti0"] / b["soft"])
    V0 = b["M0"] * (b["theta0"] + 1 / b["T_amort"]) / (b["theta0"] * l0)
    for _ in range(60):
        uw = norm.cdf((np.log(b["M0"] / V0) - b["sigma_ltv"] ** 2 / 2) / b["sigma_ltv"])
        th = b["theta0"] * (1 - b["uw_mobility"] * uw)
        V0 = b["M0"] * (th + 1 / b["T_amort"]) / (th * l0)
    ltv0 = b["M0"] / V0
    uw0 = float(norm.cdf((np.log(ltv0) - b["sigma_ltv"] ** 2 / 2) / b["sigma_ltv"]))
    rm0, rs0 = b["ftp0"] + b["s0"] / 2, b["ftp0"] - b["s0"] / 2
    cash0 = b["Dep0"] + b["E0"] + b["W0"] - b["M0"] - b["Lf0"]
    nii0 = rm0 * (b["M0"] + b["Lf0"]) + b["r_mkt"] * cash0 - rs0 * b["Dep0"] - (b["r_mkt"] + b["w_prem"]) * b["W0"]
    rwm0 = rw_mortgage(ltv0, b)
    nsfr0 = (b["asf_dep"] * b["Dep0"] + b["E0"] + b["asf_w"] * b["W0"]) / (b["rsf_m"] * b["M0"] + b["rsf_f"] * b["Lf0"])
    return dict(V0=V0, ltv0=ltv0, uw0=uw0, rm0=rm0, rs0=rs0, pay0=nii0 - b["loss_uw"] * uw0 * b["M0"],
                T_firm=b["Lf0"] / b["firm_new0"], nsfr_ref=nsfr0,
                rw_m0=rwm0, t1_ref=b["E0"] / (b["M0"] * rwm0 + b["rw_firm"] * b["Lf0"]), ltf_ref=(b["M0"] + b["Lf0"]) / (b["Dep0"] + b["W0"]))


def rw_mortgage(ltv: float, b: dict) -> float:
    """DNB minimum risk weight of the mortgage book: exposure-weighted average over loans with LTV_i = ltv*exp(sZ - s^2/2)."""
    sg, k = b["sigma_ltv"], b["ltv_split"]
    d1 = (np.log(ltv / k) + sg ** 2 / 2) / sg
    return float(b["rw_lo"] + (b["rw_hi"] - b["rw_lo"]) * (norm.cdf(d1) - k / ltv * norm.cdf(d1 - sg)))


def _phi(x: str) -> str:
    """Normal CDF; ngspice B-sources have no erf (tanh approximation, error < 2e-4). The cube is written as a product:
    ngspice evaluates a**3 as |a|**3 for negative a, which put the underwater share at 19.1% instead of 17.4%."""
    return f"(0.5*(1+tanh(0.7978845608*(({x})+0.044715*({x})*({x})*({x})))))"


def _annuity(r: str) -> str:
    return f"((1-(1+({r}))**(-30))/({r}))"


SHOCK_SCEN = ["none", "parallel_up", "parallel_down", "steepener", "flattener", "short_up", "short_down"]


def rate_shock(b: dict, T: float) -> float:
    """dR (decimal) at maturity T of the selected SOT scenario, EU sizes (0 when none)."""
    from .sot import SIZES, shock
    k = int(round(b.get("shock_scen", 0)))
    return 0.0 if k <= 0 else float(shock(SHOCK_SCEN[k], np.array([T]), SIZES["EU RTS 2024/856"])[0])


def desk(b: dict, alm_on: bool, housing_feedback: bool) -> tuple[list[str], dict]:
    e = equilibrium(b)
    on_c = b["competitor"] > 0
    if on_c:  # the market's debt starts at M0 + Mc0: house values scale with it (same LTV); the bank's own ratios are unchanged
        e["V0"] = equilibrium({**b, "M0": b["M0"] + b["Mc0"]})["V0"]
    c0 = b["Mc0"] / (b["M0"] + b["Mc0"]) if on_c else 0.5
    e["a0"] = float(np.log(c0 / (1 - c0)))                       # logit: share c0 at equal rates
    e["beta"] = b["comp_share_per_pp"] / (c0 * (1 - c0))         # slope at the start: comp_share_per_pp share per pp
    e["kD"] = (b["M0"] + b["Mc0"]) / b["M0"] if on_c else 1.0  # bank units per netlist debt unit
    e["rmavg0"] = e["rm0"] - (b["comp_gap_pp"] / 100 * c0 if on_c else 0.0)
    v = {**b, **e}
    g = lambda k: repr(float(v[k]))
    on, fb = ("1" if alm_on else "0"), ("1" if housing_feedback else "0")
    S = lambda name, expr: f"B§bk_{name} 0 0 I={expr}"
    D1 = f"((ln(I(bk_ltv)/{g('ltv_split')})+{v['sigma_ltv'] ** 2 / 2!r})/{g('sigma_ltv')})"
    ts = T0 + YR * b["shock_year"]
    rows = [
        S("dsh", f"{rate_shock(b, 0.25)!r}*u(time-{ts!r})"),                # rate shock: short end (3 months)
        S("dlg", f"{rate_shock(b, 10.0)!r}*u(time-{ts!r})"),                # rate shock: 10-year point
        S("rmk", f"{g('r_mkt')}+I(bk_dsh)"),                                  # the market rate (short end)
        S("shape", "min((30-I(Crisis_timing))/20,1)"),                          # crisis timing (0..1) at the other banks
        S("W", f"{g('W0')}*(1-{g('funding_cut')}*I(bk_shape))"),              # funding from other banks
        S("P", f"I(Construction_cost)/{P_START + P_PER_SUBSIDY * b['hist_subsidy']!r}"),  # price index, 1 at the start
        # the market's mortgage debt (both banks), in bank units: the netlist's debt stays an index that starts at 100, so
        # the housing netlist starts at rest with or without the competitor (B3)
        S("D", f"I(Mortgage_debt)*{e['kD']!r}"),
        S("M", "I(bk_D)-I(bk_Mc)"),                                          # the bank's own book
        "B§Firm_book_flow 0 0 I=I(Firm_loans)-I(Firm_repayment)",                    # drawn: Net firm lending
        S("Lf", f"{g('Lf0')}+idt(I(Firm_book_flow))/{YR}"),                 # drawn: Firm loans (capacitor)
        f"B§Firm_repayment 0 0 I=I(bk_Lf)/{g('T_firm')}",                    # short: repaid in T_firm years
        S("V", f"{g('V0')}*I(bk_P)"),
        S("ltv", "I(bk_D)/I(bk_V)"),                                         # households' LTV: the market's debt over the home value
        S("uw", _phi(f"(ln(I(bk_ltv))-{v['sigma_ltv'] ** 2 / 2!r})/{g('sigma_ltv')}")),
        # DNB mortgage risk weight (see BANK_DEFAULTS): 12% + 33% x expected share of each loan above 55% LTV
        # DNB mortgage risk weight (see BANK_DEFAULTS): 12% + 33% x (Phi(d1) - 0.55/LTV x Phi(d1 - s)), written inline
        # (separate d1/LTV nodes made the ngspice operating point fail)
        S("rw_m", f"{g('rw_lo')}+({g('rw_hi')}-{g('rw_lo')})*({_phi(D1)}-{g('ltv_split')}/I(bk_ltv)*{_phi(D1 + '-' + g('sigma_ltv'))})"),
        S("rwa", f"I(bk_M)*I(bk_rw_m)+{g('rw_firm')}*I(bk_Lf)"),
        S("t1", "I(bk_E)/I(bk_rwa)"),
        S("ltf", "(I(bk_M)+I(bk_Lf))/(I(bk_Dep)+I(bk_W))"),  # loan-to-deposit (Menkveld eq. 3-1); deposits incl. those of other banks
        S("ltf_err", f"I(bk_ltf)-{g('ltf_ref')}"),
        # NSFR = available / required stable funding (Menkveld eq. 3-3); the FTP loop tracks it (target - measured)
        S("asf", f"{g('asf_dep')}*I(bk_Dep)+I(bk_E)+{g('asf_w')}*I(bk_W)"),   # available stable funding: liabilities x ASF factors
        S("rsf", f"{g('rsf_m')}*I(bk_M)+{g('rsf_f')}*I(bk_Lf)"),               # required stable funding: assets x RSF factors
        S("nsfr", "I(bk_asf)/I(bk_rsf)"),
        S("nsfr_err", f"{g('nsfr_ref')}-I(bk_nsfr)"),
        S("t1_err", f"{g('t1_ref')}-I(bk_t1)"),
        S("ftp", f"{g('ftp0')}+{on}*({g('Kp_ftp')}*I(bk_nsfr_err)+{g('Ki_ftp')}*idt(I(bk_nsfr_err))/{YR})"),
        S("s", f"{g('s0')}+{on}*({g('Kp_s')}*I(bk_t1_err)+{g('Ki_s')}*idt(I(bk_t1_err))/{YR})"),
        S("rm", "I(bk_ftp)+I(bk_s)/2+I(bk_dlg)"),                           # loan rate (Menkveld eq. 3-4, 3-8) + the 10-year shock
        S("rs", f"I(bk_ftp)-I(bk_s)/2+{g('dep_beta')}*I(bk_dsh)"),         # savings rate + part of the short shock
        S("theta", f"{g('theta0')}*(1-{g('uw_mobility')}*I(bk_uw))"),
        S("lti", f"{g('lti0')}*{_annuity('I(bk_rm)')}/{_annuity(g('rm0'))}/I(bk_P)"),
        S("lnew", f"-{g('soft')}*ln(exp(-{g('ltv_cap')}/{g('soft')})+exp(-I(bk_lti)/{g('soft')}))"),
        f"B§Deposit_flow 0 0 I=({g('Dep0')}*(1+{g('eta_dep')}*(I(bk_rs)-{g('rs0')}-I(bk_dsh))*100)-I(bk_Dep))/{g('tau_dep')}",  # vs the market rate  # drawn: Inflow
        S("Dep", f"{g('Dep0')}+idt(I(Deposit_flow))/{YR}"),                 # drawn: Deposits (capacitor)
        # lending supply (26 Nov 2026): the bank lends credit_supply % less per 1% of funding lost (Khwaja & Mian 2008)
        S("lsf", f"max(1-{fb}*{g('credit_supply')}*(1-(I(bk_Dep)+I(bk_W))/{v['Dep0'] + v['W0']!r}),0.2)"),
        S("cash", "I(bk_Dep)+I(bk_E)+I(bk_W)-I(bk_M)-I(bk_Lf)"),
        # ---- competitor bank (B3; competitor=0: all of it zero)
        # its own rate, fixed: 0.3 pp below the bank's start rate (it has no ALM desk). Tied to the bank's rate, it followed the
        # bank's desk into a price war and failed without any crisis (Jesse, 26 Nov 2026: it should not)
        S("rmc", f"{e['rm0']!r}-{v['comp_gap_pp'] / 100!r}*u(time-{T0!r})+I(bk_dlg)"),     # sharper from year 0 (not in the warm-up before it)
        S("sc", f"{g('competitor')}/(1+exp(-({e['a0']!r}+{e['beta']!r}*100*(I(bk_rm)-I(bk_rmc)))))"),   # its share of new lending
        S("lsfc", f"max(1-{fb}*{g('credit_supply')}*{v['Wc0'] / (v['Depc0'] + v['Wc0'])!r}*{g('funding_cut')}*I(bk_shape),0.2)"),
        "B§Comp_flow 0 0 I=" + f"I(bk_sc)*I(bk_theta)*I(bk_V)*I(bk_lnew)*I(bk_lsfc)-I(bk_theta)*I(bk_Mc)-I(bk_Mc)/{b['T_amort']!r}",
        S("Mc", f"{g('competitor')}*{g('Mc0')}+idt(I(Comp_flow))/{YR}"),
        S("Wc", f"{g('competitor')}*max({g('Wc0')}+I(bk_Mc)-{g('Mc0')},0)*(1-{g('funding_cut')}*I(bk_shape))"),  # growth funded by other banks
        S("Depc", f"{g('competitor')}*{g('Depc0')}"),
        S("cashc", "I(bk_Depc)+I(bk_Ec)+I(bk_Wc)-I(bk_Mc)"),
        S("niic", f"I(bk_rmc)*I(bk_Mc)+I(bk_rmk)*I(bk_cashc)-{v['gap_penalty_pp'] / 100!r}*max(-I(bk_cashc),0)-I(bk_rs)*I(bk_Depc)-(I(bk_rmk)+I(bk_prem))*I(bk_Wc)"),
        f"B§Comp_profit 0 0 I=I(bk_niic)-{g('loss_uw')}*I(bk_uw)*I(bk_Mc)-{g('pay0')}*I(bk_Ec)/{g('E0')}",
        S("Ec", f"{g('competitor')}*{g('Ec0')}+idt(I(Comp_profit))/{YR}"),
        S("t1c", f"I(bk_Ec)/max(I(bk_rw_m)*I(bk_Mc),1e-6)"),
        S("nsfrc", f"({g('asf_dep')}*I(bk_Depc)+I(bk_Ec)+{g('asf_w')}*I(bk_Wc))/max({g('rsf_m')}*I(bk_Mc),1e-6)"),
        S("ltdc", "I(bk_Mc)/max(I(bk_Depc),1e-6)"),
        S("sharec", "I(bk_Mc)/I(bk_D)"),
        S("lsfm", "(1-I(bk_sc))*I(bk_lsf)+I(bk_sc)*I(bk_lsfc)"),           # the market's credit supply (new-lending weighted)
        S("rmavg", "(I(bk_M)*I(bk_rm)+I(bk_Mc)*I(bk_rmc))/I(bk_D)"),        # what households pay on average
        # Wholesale funding and any funding gap (negative cash: emergency borrowing) cost the market rate plus the
        # premium, which rises in the crisis. Without the gap term, losing funding made the bank richer (20 Nov 2026).
        S("prem", f"{g('w_prem')}+{v['premium_pp'] / 100!r}*I(bk_shape)"),
        S("nii", f"I(bk_rm)*(I(bk_M)+I(bk_Lf))+I(bk_rmk)*I(bk_cash)-{v['gap_penalty_pp'] / 100!r}*max(-I(bk_cash),0)-I(bk_rs)*I(bk_Dep)"
                 f"-(I(bk_rmk)+I(bk_prem))*I(bk_W)"),
        f"B§Net_interest 0 0 I=I(bk_nii)-{g('loss_uw')}*I(bk_uw)*I(bk_M)-{g('pay0')}*I(bk_E)/{g('E0')}",  # drawn: NII
        S("E", f"{g('E0')}+idt(I(Net_interest))/{YR}"),                     # drawn: Equity (capacitor)
        S("rate", f"0.01033+{fb}*{g('k_rate')}*(I(bk_rmavg)-{e['rmavg0']!r})/{YR}"),   # what the housing market pays (avg over the banks)
    ]
    return rows, e


def _scen(b: dict) -> dict:
    """The housing scenario under the bank: Covid and the historical owner-occupied subsidy (x hist_subsidy) as in the main model."""
    return {**BASE, "covid_scale": b["covid_scale"], "subsidy_scale": b["hist_subsidy"]}


def lines(b: dict, alm_on: bool = True, housing_feedback: bool = True) -> tuple[list[str], dict]:
    base = build(Scenario(**_scen(b)))
    rows, e = desk(b, alm_on, housing_feedback)
    fb = "1" if housing_feedback else "0"
    t_gov = T0 + YR * b["gov_year"]
    out = []
    for l in base:
        if l.startswith("V§Shock_financialcrisis "):
            l = l.split("PWL(")[0] + "PWL(0 0 1 0)"  # crisis comes from other banks, not from the firms
        elif l.startswith("I§Mortgages "):
            # the whole market's new lending (both banks; without the competitor D = M and lsfm = lsf, as before)
            l = (f"B§Mortgages 0 N007 I=(I(bk_theta)*I(bk_V)*I(bk_lnew)*I(bk_lsfm)-I(bk_theta)*I(bk_D)-I(bk_D)/{b['T_amort']!r})/{YR * e['kD']!r}")
            # credit conditions reach housing demand (see k_credit); bank mode only, the thesis netlist is untouched
            out.append(f"B§Credit_conditions 0 N007 I={b['k_credit']!r}*(I(bk_lsfm)-1)")
        elif l.startswith("Interest_Rates "):  # drawn: Mortgage rate (ALM), on the same nodes as the old fixed input
            n1, n2 = l.split()[1:3]
            l = f"B§Mortgage_rate_ALM {n1} {n2} I=I(bk_rate)"
        elif l.startswith("B§Mortgage_interest "):
            l = "B§Mortgage_interest N007 0 I=I(Mortgage_debt)*I(Mortgage_rate_ALM)"
        elif l.startswith("I8 "):  # firm-loan port: the netlist's credit path stays as the crisis clock only
            pwl = l.split(None, 3)[3]
            out.append(f"I§Crisis_timing 0 0 {pwl}")
            l = (f"B§Firm_loans 0 N008 I={b['firm_new0']!r}*I(bk_lsf)"
                 f"*max(1-{fb}*{b['eta_firm']!r}*(I(bk_rm)-{e['rm0']!r})*100,0.2)")
        elif l.startswith("B5 "):  # firm-loan interest floats with the loan rate and the firm-loan stock
            l = f"B5 N001 N003 I=10*I(bk_Lf)/{b['Lf0']!r}*(1+{fb}*(I(bk_rm)/{e['rm0']!r}-1))+0.001*idt(I(I1))"
        elif l.startswith("B2 "):
            l = f"B2 0 N011 I=5*I(bk_rs)/{e['rs0']!r}+0.000*idt(I(V4))"   # savings interest follows the savings rate
        elif l.startswith("I§Owner_occupied_subsidies "):
            # historical subsidy path stays (x hist_subsidy); the user's step is a second source on the same node
            out.append(f"I§Gov_step 0 N031 PWL(0 0 {t_gov:.3f} 0 {t_gov + 3:.3f} {b['gov_step']!r})")
        elif l.startswith(".tran"):
            out += rows
        out.append(l)
    for must in ("B§Mortgages ", "B§Mortgage_interest ", "B2 ", "I§Owner_occupied_subsidies ", "B§Firm_loans ", "B5 ", "B§Mortgage_rate_ALM "):
        assert any(l.startswith(must) and ("bk_" in l or "Crisis_timing" in l or "Mortgage_rate_ALM" in l or must.startswith("I§")) for l in out), must
    return out, e


SIGNALS = {  # output name: (trace, scale)
    "price_index": ("I(Bk_p)", 100), "underwater_pct": ("I(Bk_uw)", 100), "book_ltv_pct": ("I(Bk_ltv)", 100),
    "mortgage_book": ("I(Bk_m)", 1), "tier1_pct": ("I(Bk_t1)", 100), "ltf_pct": ("I(Bk_ltf)", 100), "nsfr_pct": ("I(Bk_nsfr)", 100), "asf": ("I(Bk_asf)", 1), "rsf": ("I(Bk_rsf)", 1),
    "firm_loans": ("I(Bk_lf)", 1), "firm_new_loans": ("I(Firm_loans)", 1),
    "mortgage_rate_pct": ("I(Bk_rm)", 100), "savings_rate_pct": ("I(Bk_rs)", 100), "ftp_pct": ("I(Bk_ftp)", 100),
    "spread_pct": ("I(Bk_s)", 100), "wholesale_funding": ("I(Bk_w)", 1), "deposits": ("I(Bk_dep)", 1),
    "equity": ("I(Bk_e)", 1), "new_lending": ("I(Mortgages)", YR), "firm_lending": ("I(L7)", 1),
    "savings_interest": ("I(L15)", 1), "subsidy": ("I(Gov_step)", 1), "subsidy_hist": ("I(Owner_occupied_subsidies)", 1), "crisis": ("I(Bk_shape)", 100), "covid": ("covid", 1),
    # competitor bank (B3; zero while it is off)
    "comp_share_pct": ("I(Bk_sharec)", 100), "comp_tier1_pct": ("I(Bk_t1c)", 100), "comp_nsfr_pct": ("I(Bk_nsfrc)", 100), "comp_ltd_pct": ("I(Bk_ltdc)", 100),
    "comp_book": ("I(Bk_mc)", 1), "comp_equity": ("I(Bk_ec)", 1), "comp_mortgage_rate_pct": ("I(Bk_rmc)", 100),
}


def _run(text_lines: list[str]) -> dict[str, np.ndarray]:
    """ngspice run that keeps the part before a breakdown (ngspice stops when the loop runs away)."""
    text, names, tstart = ngspice.translate(text_lines)
    vec, _log = ngspice._run_text(text)
    if "time" not in vec or vec["time"].size < 2:
        raise RuntimeError("ngspice returned no data")
    tr = {"time": vec["time"] - tstart}
    tr.update(ngspice._traces(vec, names, vec["time"].size))
    tr["covid"] = tr.get("V(n046)", 0 * tr["time"]) - tr.get("V(n042)", 0 * tr["time"])  # V§Shock_covid N046 N042
    if "I(Mortgage_rate_alm)" in tr:  # the housing series read the old input under its own name
        tr["I(Interest_rates)"] = tr["I(Mortgage_rate_alm)"]
    return tr


def simulate(overrides: dict | None = None, alm_on: bool = True, housing_feedback: bool = True, n: int = 291, full: bool = False) -> dict:
    """JSON-ready result on n points over the 29 years of the run (None after a breakdown). full=True adds "result":
    the same run in the format of the housing runs (scenario.evaluate), for the model canvas (ModelMap)."""
    b = {**BANK_DEFAULTS, **(overrides or {})}
    L, e = lines(b, alm_on, housing_feedback)
    tr = _run(L)
    run_result = None
    if full:
        s = Scenario(**_scen(b))
        try:
            run_result = {**evaluate(s, {k: v for k, v in tr.items() if k != "covid"}), "scenario": s.model_dump(), "engine": "ngspice (PySpice), bank netlist",
                          "model_version": "bank-netlist-experimental", "netlist_sha256": "", "netlist": ""}
        except ValueError:  # a run that breaks down has non-finite values; the canvas then shows no values
            run_result = None
        if run_result:  # ratios and rates in percent on the canvas (Tier 1 16.3, not 0.163); r = the Tier 1 target
            for k in ("I(Bk_t1)", "I(Bk_ltf)", "I(Bk_rm)", "I(Bk_rs)", "I(Bk_ftp)", "I(Bk_s)", "I(Bk_uw)", "I(Bk_ltv)", "I(Bk_ltf_err)", "I(Bk_t1_err)", "I(Bk_rate)", "I(Bk_nsfr)", "I(Bk_nsfr_err)", "I(Bk_t1c)", "I(Bk_nsfrc)", "I(Bk_ltdc)", "I(Bk_sharec)", "I(Bk_rmc)", "I(Bk_rmk)"):
                if k in run_result["traces"]:
                    run_result["traces"][k] = [round(x * 100, 4) for x in run_result["traces"][k]]
            run_result["traces"]["Bank_target_t1"] = [round(100 * e["t1_ref"], 4)] * len(run_result["year"])
            yrs0 = np.asarray(run_result["year"], dtype=float) - YEAR_AT_RAW_ZERO
            for T, tp in ((0, 0.0), (2, b["tp2"]), (5, b["tp5"]), (10, b["tp10"]), (20, b["tp20"]), (30, b["tp30"])):  # B2: the yield curve (%), 0-30 years
                dR = rate_shock(b, max(T, 0.25)) * (yrs0 >= b["shock_year"])     # + the rate shock from shock_year on
                run_result["traces"][f"Yield:{T}"] = [round(100 * (b["r_mkt"] + tp + d), 4) for d in dR]
            # The loop on the canvas (Menkveld Fig. 3-2): r = financial targets, y = financial reports, e = r - y for both
            # channels (target minus measured). The FTP controller uses the opposite sign (loan-to-deposit above target -> FTP up).
            tt = run_result["traces"]
            tt["Bank_target_ltd"] = [round(100 * e["ltf_ref"], 4)] * len(run_result["year"])
            tt["Bank_target_nsfr"] = [round(100 * e["nsfr_ref"], 4)] * len(run_result["year"])
            if "I(Bk_nsfr_err)" in tt:
                tt["Bank_dev_nsfr"] = list(tt["I(Bk_nsfr_err)"])
            # ALM Reporting (25 Nov 2026): the statements on the canvas's own time grid, read by the Play cursor
            yrs = np.asarray(run_result["year"], dtype=float) - YEAR_AT_RAW_ZERO
            led = bank_ledger(tr, b, e, yrs, tr["time"] / YR, np.ones(yrs.size, dtype=bool))
            for k, vals in led["values"].items():
                tt["Ledger:" + k] = vals
            run_result["ledger"] = {k: led[k] for k in ("version", "groups", "accounts", "links", "basis", "thresholds")}
            if "I(Bk_t1_err)" in tt and "I(Bk_ltf_err)" in tt:
                tt["Bank_dev_t1"] = list(tt["I(Bk_t1_err)"])
                tt["Bank_dev_ltd"] = [None if x is None else round(-x, 4) for x in tt["I(Bk_ltf_err)"]]
    t = tr["time"] / YR
    T_END = 29.0
    grid = np.linspace(0, T_END, n)
    reached = float(t[-1])
    P = tr["I(Bk_p)"]
    bad = ~np.isfinite(P) | (P <= 0.02)
    for k, (trace, _) in SIGNALS.items():
        bad |= ~np.isfinite(tr[trace])
    stop = float(t[np.argmax(bad)]) if bad.any() else (T_END if reached >= T_END - 0.05 else reached)
    out: dict = {"t_years": [round(float(x), 3) for x in grid]}
    for k, (trace, sc) in SIGNALS.items():
        y = np.interp(grid, t, np.nan_to_num(tr[trace]) * sc)
        out[k] = [round(float(val), 4) if x <= stop + 1e-9 else None for x, val in zip(grid, y)]
    ok = stop >= T_END - 0.05
    valid = grid <= stop + 1e-9
    def arr(k): return np.array([x for x, keep in zip(out[k], valid) if keep], dtype=float)
    cr = np.array([c or 0 for c in out["crisis"]])
    on = grid[cr > 1]
    out["ledger"] = bank_ledger(tr, b, e, grid, t, valid)  # ALM Reporting: the bank's statements and key figures
    out.update(
        result=run_result, year0=YEAR_AT_RAW_ZERO,
        ok=bool(ok), breakdown_year=None if ok else round(stop, 2),
        crisis_years=[round(float(on.min()), 2), round(float(on.max()), 2)] if on.size else None,
        targets=dict(tier1_pct=round(100 * e["t1_ref"], 2), ltf_pct=round(100 * e["ltf_ref"], 2), nsfr_pct=round(100 * e["nsfr_ref"], 2)),
        start=dict(underwater_pct=round(100 * e["uw0"], 2), book_ltv_pct=round(float(100 * e["ltv0"]), 2),
                   mortgage_rate_pct=round(100 * e["rm0"], 2), savings_rate_pct=round(100 * e["rs0"], 2)),
        summary=None if valid.sum() < 2 else dict(
            min_price_pct=round(float(arr("price_index").min() - 100), 2),
            max_price_after_crisis_pct=round(float(arr("price_index")[grid[valid] > (on.max() if on.size else 0)].max(initial=-1e9) - 100), 2),
            max_underwater_pct=round(float(arr("underwater_pct").max()), 2),
            min_tier1_pct=round(float(arr("tier1_pct").min()), 2), min_nsfr_pct=round(float(arr("nsfr_pct").min()), 2),
            mortgage_rate_range_pct=[round(float(arr("mortgage_rate_pct").min()), 2), round(float(arr("mortgage_rate_pct").max()), 2)]),
    )
    return out


# What the site may change, with its slider range (anything else is rejected, values are clamped).
RANGES = {"funding_cut": (0.0, 1.0), "premium_pp": (0.0, 4.0), "k_rate": (1.0, 900.0),
          "Kp_ftp": (0.0, 1.0), "Ki_ftp": (0.0, 1.0), "Kp_s": (0.0, 3.0), "Ki_s": (0.0, 3.0),
          "uw_mobility": (0.0, 0.5), "theta0": (0.03, 0.10), "sigma_ltv": (0.25, 0.6),
          "gov_step": (-20.0, 20.0), "gov_year": (1.0, 25.0), "covid_scale": (0.0, 2.0), "hist_subsidy": (0.0, 10.0),
          "credit_supply": (0.0, 1.5), "k_credit": (0.0, 400.0), "eta_firm": (0.0, 0.30),
          "competitor": (0.0, 1.0), "shock_scen": (0.0, 6.0), "shock_year": (1.0, 25.0), "comp_gap_pp": (0.0, 1.0), "comp_share_per_pp": (0.0, 3.0)}


@lru_cache(maxsize=256)
def cached(overrides: tuple, alm_on: bool, housing_feedback: bool, full: bool = False) -> dict:
    return simulate(dict(overrides), alm_on, housing_feedback, full=full)


def clamp(o: dict[str, float]) -> dict[str, float]:
    unknown = sorted(set(o) - set(RANGES))
    if unknown:
        raise ValueError(f"cannot change {', '.join(unknown)}")
    if not all(math.isfinite(x) for x in o.values()):
        raise ValueError("values must be finite numbers")
    return {k: round(min(max(x, RANGES[k][0]), RANGES[k][1]), 6) for k, x in o.items()}
