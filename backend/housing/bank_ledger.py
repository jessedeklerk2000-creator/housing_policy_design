"""Financial statements of the bank (ALM Reporting), built from the bank netlist's traces (25 Nov 2026).

Structure after Q. Emanuels' DynaBI statement ledger (groups -> sections -> accounts; every account has a label,
formula, inputs, unit, source and note) and Menkveld (2025) Fig. 2-2/2-3: ALM Reporting turns the bank's balance sheet
and income statement into the metrics the ALM Desk steers on. Nothing here feeds back into the model: the
netlist is solved by ngspice, this layer only reports it. Values are in model units (mortgage book = 100 at the start);
income-statement lines are flows per year.
"""
from __future__ import annotations

import numpy as np

BASEL_NSF = "Basel III NSFR (BCBS, NSF30)"
BASEL_CRE = "Basel CRE20.43 (unrated corporates)"
DNB_RW = "DNB minimum mortgage risk weight, Art. 458 CRR (EBA-Op-2020-03 par. 10-11)"
MENKVELD = "Menkveld (2025)"
NETLIST = "Bank netlist (ngspice)"
# Regulatory thresholds that DNB (the supervisor) sends to the ALCO (M. Mendel, 26 Nov 2026, feedback round 2 B1). Primary
# sources only; the ledger reports against them, the ALM Desk does not use them (yet).
CRR = "Regulation (EU) No 575/2013 (CRR)"
THRESHOLDS = [
    dict(id="tier1", label="Tier 1 minimum", value=6.0, unit="%", source=CRR + " Art. 92(1)(b)"),
    dict(id="nsfr", label="NSFR minimum", value=100.0, unit="%", source=CRR + " Art. 428b(1); " + BASEL_NSF),
    dict(id="leverage", label="Leverage minimum", value=3.0, unit="%", source=CRR + " Art. 92(1)(d)"),
    dict(id="lcr", label="LCR minimum", value=100.0, unit="%", source=CRR + " Art. 412(1); Delegated Regulation (EU) 2015/61 Art. 4(1)"),
    dict(id="rw_mortgages", label="Mortgage risk-weight floor", value=None, unit="%", text="12% up to 55% LTV, 45% above", source=DNB_RW),
]
MIN = {t["id"]: t["value"] for t in THRESHOLDS if t["value"] is not None}


def ledger(tr: dict, b: dict, e: dict, grid_years: np.ndarray, sim_years: np.ndarray, valid: np.ndarray) -> dict:
    """Statements on the output grid. tr: raw traces, b: parameters, e: equilibrium values."""
    T = lambda k: np.interp(grid_years, sim_years, np.nan_to_num(np.asarray(tr[k], dtype=float)))
    M, Lf, Dep, W, E, cash = T("I(Bk_m)"), T("I(Bk_lf)"), T("I(Bk_dep)"), T("I(Bk_w)"), T("I(Bk_e)"), T("I(Bk_cash)")
    rm, rs, prem, uw, shape = T("I(Bk_rm)"), T("I(Bk_rs)"), T("I(Bk_prem)"), T("I(Bk_uw)"), T("I(Bk_shape)")
    rw_m, rwa, ltv = T("I(Bk_rw_m)"), T("I(Bk_rwa)"), T("I(Bk_ltv)")
    rmk = T("I(Bk_rmk)") if "I(Bk_rmk)" in tr else 0 * rm + b["r_mkt"]   # market rate, with a rate shock if one is set
    gap = b["gap_penalty_pp"] / 100
    zero = 0 * M
    v: dict[str, np.ndarray] = {}
    defs: dict[str, dict] = {}

    def acc(key, label, formula, value, inputs=(), unit="model units", source=NETLIST, note="", sign=1):
        defs[key] = dict(id=key, label=label, formula=formula, inputs=list(inputs), unit=unit, source=source, note=note, sign=sign)
        if key in MIN:
            defs[key]["minimum"] = MIN[key]  # DNB threshold: a line in the plot, the value red below it
        v[key] = np.asarray(value, dtype=float)

    # Balance sheet: assets
    acc("reserves", "Cash and central-bank reserves", "max(cash, 0)", np.maximum(cash, 0), note="Cash is the balancing item: savings + other banks + equity − mortgages − firm loans.")
    acc("mortgages", "Mortgages (long)", "Mortgage book of the netlist (B§Mortgage_Debt)", M, source=NETLIST + ": households' mortgage port")
    acc("firm_loans", "Loans to firms (short)", "Firm book: idt(new firm loans − repayments)", Lf, source=NETLIST + ": firms' loan port")
    acc("assets", "Total assets", "reserves + mortgages + loans to firms", v["reserves"] + M + Lf, ["reserves", "mortgages", "firm_loans"])
    # Balance sheet: liabilities and equity
    acc("current_accounts", "Current accounts (no interest)", "not connected yet", zero, source=MENKVELD + " Fig. 2-3",
        note="On Menkveld's balance sheet; no port in the housing netlist yet, so 0 here.")
    acc("savings", "Savings deposits", "idt(deposit inflow): deposits follow the savings rate", Dep, source=NETLIST + ": households' savings port")
    acc("interbank", "Deposits of other banks", "W0 × (1 − funding cut × crisis shape)", W, source="Crisis disturbance (other banks)")
    acc("cb_borrowing", "Central-bank borrowing", "max(−cash, 0): a funding gap", np.maximum(-cash, 0))
    acc("liabilities", "Total liabilities", "current accounts + savings + other banks + central bank",
        v["current_accounts"] + Dep + W + v["cb_borrowing"], ["current_accounts", "savings", "interbank", "cb_borrowing"])
    acc("equity", "Equity", "opening equity + retained profit", E, ["equity_open", "retained_cum"])
    acc("liab_equity", "Total liabilities and equity", "total liabilities + equity", v["liabilities"] + E, ["liabilities", "equity"])
    acc("balance_check", "Balance check", "total assets − total liabilities and equity", v["assets"] - v["liab_equity"], ["assets", "liab_equity"],
        note="Zero at every point in time.", sign=1)

    # Income statement (per year)
    py = "model units / year"
    acc("ii_mortgages", "Interest on mortgages", "loan rate × mortgages", rm * M, ["mortgages"], py, MENKVELD + " Fig. 2-3 (loan interest)")
    acc("ii_firms", "Interest on loans to firms", "firm-loan rate × loans to firms", (T("I(Bk_rf)") if "I(Bk_rf)" in tr else rm) * Lf, ["firm_loans"], py, MENKVELD + " Fig. 2-3 (loan interest); firm-loan rate priced at the 10-year point")
    acc("ii_reserves", "Interest on reserves", "market rate × reserves", rmk * v["reserves"], ["reserves"], py)
    acc("interest_income", "Interest income", "sum of the above", v["ii_mortgages"] + v["ii_firms"] + v["ii_reserves"], ["ii_mortgages", "ii_firms", "ii_reserves"], py)
    acc("ie_savings", "Interest on savings", "savings rate × savings deposits", rs * Dep, ["savings"], py, MENKVELD + " Fig. 2-3 (deposit interest)")
    acc("ie_interbank", "Interest to other banks", "(market rate + premium) × deposits of other banks", (rmk + prem) * W, ["interbank"], py)
    acc("ie_cb", "Interest to the central bank", "(market rate + 1 pp marginal lending facility) × central-bank borrowing", (rmk + gap) * v["cb_borrowing"], ["cb_borrowing"], py, "ECB corridor: marginal lending facility = MRO rate + 1 pp (ECB press release 8 Oct 2008)")
    acc("interest_expense", "Interest expense", "sum of the above", v["ie_savings"] + v["ie_interbank"] + v["ie_cb"], ["ie_savings", "ie_interbank", "ie_cb"], py)
    acc("nii", "Net interest income", "interest income − interest expense", v["interest_income"] - v["interest_expense"], ["interest_income", "interest_expense"], py, MENKVELD + " Fig. 2-3")
    acc("imp_mortgages", "Impairments on mortgages", "loss rate × underwater share × mortgages", b["loss_uw"] * uw * M, ["mortgages"], py)
    # No firm-loan losses since 26 Nov 2026: the crisis starts at the other banks, not at the firms.
    acc("impairments", "Impairments", "sum of the above", v["imp_mortgages"], ["imp_mortgages"], py)
    acc("net_profit", "Net profit", "net interest income − impairments", v["nii"] - v["impairments"], ["nii", "impairments"], py)
    acc("dividend", "Dividend", "payout in proportion to equity (equity at rest at the start)", e["pay0"] * E / b["E0"], ["equity"], py)
    acc("retained", "Retained profit", "net profit − dividend", v["net_profit"] - v["dividend"], ["net_profit", "dividend"], py)

    # Equity statement (cumulative since the start)
    dt = np.diff(grid_years, prepend=grid_years[0])
    cum = lambda x: np.cumsum(np.r_[0, (x[1:] + x[:-1]) / 2 * dt[1:]])
    acc("equity_open", "Opening equity", "equity at the start", zero + b["E0"])
    acc("profit_cum", "Net profit since the start", "∫ net profit dt", cum(v["net_profit"]), ["net_profit"])
    acc("dividend_cum", "Dividends since the start", "∫ dividend dt", cum(v["dividend"]), ["dividend"])
    acc("retained_cum", "Retained profit since the start", "net profit − dividends since the start", v["profit_cum"] - v["dividend_cum"], ["profit_cum", "dividend_cum"])
    acc("equity_check", "Equity check", "opening equity + retained profit − equity on the balance sheet", b["E0"] + v["retained_cum"] - E, ["equity_open", "retained_cum", "equity"],
        note="Zero up to the accuracy of the time grid.")

    # Metrics (Menkveld Fig. 2-2: ratios derived from the statements; "Metrics" after M. Mendel, 26 Nov 2026)
    pct = "%"
    acc("rw_mortgages", "Risk weight of mortgages", "12% up to 55% of the home's value, 45% above, averaged over the loans", 100 * rw_m, unit=pct, source=DNB_RW,
        note=f"Book loan-to-value now {100 * ltv[0]:.0f}% at the start.")
    acc("rwa", "Risk-weighted assets", "risk weight × mortgages + 100% × loans to firms", rwa, ["rw_mortgages", "mortgages", "firm_loans"], source=DNB_RW + "; " + BASEL_CRE)
    acc("tier1", "Tier 1 capital ratio", "equity ÷ risk-weighted assets", 100 * E / rwa, ["equity", "rwa"], pct, MENKVELD + " eq. 3-7; Basel minimum 6%")
    acc("asf", "Available stable funding", "90% × savings + 90% × current accounts + 100% × equity + 0% × other banks",
        b["asf_dep"] * Dep + E + b["asf_w"] * W, ["savings", "current_accounts", "equity", "interbank"], source=BASEL_NSF + " 30.10, 30.12, 30.14")
    acc("rsf", "Required stable funding", "65% × mortgages + 50% × loans to firms + 0% × reserves", b["rsf_m"] * M + b["rsf_f"] * Lf, ["mortgages", "firm_loans"], source=BASEL_NSF + " 30.25, 30.29, 30.30")
    acc("nsfr", "Net stable funding ratio", "available ÷ required stable funding", 100 * v["asf"] / v["rsf"], ["asf", "rsf"], pct, MENKVELD + " eq. 3-3; Basel minimum 100%")
    acc("ltd", "Loan-to-deposit ratio", "(mortgages + loans to firms) ÷ (savings + current accounts)", 100 * (M + Lf) / (Dep + v["current_accounts"]), ["mortgages", "firm_loans", "savings", "current_accounts"], pct, MENKVELD + " eq. 3-1")
    acc("leverage", "Leverage ratio", "equity ÷ total assets", 100 * E / v["assets"], ["equity", "assets"], pct, "Basel LEV20.7: minimum 3%",
        note="On-balance-sheet exposure only (no derivatives or off-balance items in the model).")
    # LCR, simplified (feedback round 2 B1): Menkveld (2025) eq. 3-2 is HQLA / net cash outflow over 30 days; his p. 36 gives
    # the 10% run-off factor for less stable retail deposits (after BCBS 2013). Here HQLA = reserves, outflow = 10% of savings.
    acc("lcr", "LCR (simplified, after Menkveld)", "reserves ÷ (10% × savings deposits)", 100 * v["reserves"] / (0.10 * Dep), ["reserves", "savings"], pct,
        MENKVELD + " eq. 3-2 and p. 36 (10% run-off, less stable retail deposits)",
        note="Run-off rates are not modelled per deposit type; the 100% run-off of other banks' short deposits and any inflows are left out. "
             "The model bank holds no securities, so its only liquid asset is cash.")
    acc("roe", "Return on equity", "net profit ÷ equity", 100 * v["net_profit"] / E, ["net_profit", "equity"], "% a year", MENKVELD + " Fig. 2-2")
    acc("margin10", "Mortgage rate over the 10-year rate", "mortgage rate − (market rate + 10-year term premium)", 100 * (rm - b["r_mkt"] - b["tp10"] - (T("I(Bk_dlg)") if "I(Bk_dlg)" in tr else 0)),
        unit="pp", source="ECB euro-area AAA yield curve, average 10y-1y spread 2004-2026 (+1.02 pp)", note="Dutch mortgages are mostly fixed for 10 years.")
    acc("nim", "Net interest margin", "net interest income ÷ interest-earning assets (reserves + mortgages + loans to firms)", 100 * v["nii"] / v["assets"],
        ["nii", "assets"], "% a year", "Definition (no regulatory minimum)")

    # Cash flow statement (M. Mendel, 26 Nov 2026), bank presentation of IAS 7: lending and deposit taking are operating
    # activities. Flows per year from the stocks: time derivatives on the output grid. Cash is the balancing item of the
    # balance sheet, so the net change in cash equals d(reserves)/dt minus d(central-bank borrowing)/dt is financing.
    # derivatives on the solver's own (fine) time steps, then sampled on the output grid: differencing on the 0.1-year
    # grid misses the crisis ramps (up to 0.027 a year off)
    sim = np.asarray(sim_years, dtype=float)
    raw = lambda k: np.nan_to_num(np.asarray(tr[k], dtype=float))
    dr = lambda y: np.interp(grid_years, sim, np.gradient(y, sim))
    cash_raw = raw("I(Bk_cash)")
    D = {"M": dr(raw("I(Bk_m)")), "Lf": dr(raw("I(Bk_lf)")), "Dep": dr(raw("I(Bk_dep)")), "W": dr(raw("I(Bk_w)")),
         "res": dr(np.maximum(cash_raw, 0)), "cb": dr(np.maximum(-cash_raw, 0))}
    acc("cf_profit", "Net profit", "net profit (income statement)", v["net_profit"], ["net_profit"], py,
        note="Impairments are already inside net profit and are a real cash outflow here: the model does not write the mortgage book down (cash is the balancing item), so they are not added back.")
    acc("cf_mortgages", "New mortgage lending, net", "− d(mortgages)/dt", -D["M"], ["mortgages"], py)
    acc("cf_firm_loans", "New loans to firms, net", "− d(loans to firms)/dt", -D["Lf"], ["firm_loans"], py)
    acc("cf_savings", "Savings deposits, net inflow", "+ d(savings deposits)/dt", D["Dep"], ["savings"], py)
    acc("cf_interbank", "Deposits of other banks, net", "+ d(deposits of other banks)/dt", D["W"], ["interbank"], py)
    acc("cf_operating", "Cash flow from operating activities", "sum of the above",
        v["cf_profit"] + v["cf_mortgages"] + v["cf_firm_loans"] + v["cf_savings"] + v["cf_interbank"],
        ["cf_profit", "cf_mortgages", "cf_firm_loans", "cf_savings", "cf_interbank"], py)
    acc("cf_investing", "Cash flow from investing activities", "0", zero, unit=py, note="No securities or property in the model yet.")
    acc("cf_cb", "Central-bank borrowing, net", "+ d(central-bank borrowing)/dt", D["cb"], ["cb_borrowing"], py)
    acc("cf_dividend", "Dividend paid", "− dividend", -v["dividend"], ["dividend"], py)
    acc("cf_financing", "Cash flow from financing activities", "central-bank borrowing + dividend paid", v["cf_cb"] + v["cf_dividend"], ["cf_cb", "cf_dividend"], py)
    acc("cf_net", "Net change in cash", "operating + investing + financing", v["cf_operating"] + v["cf_investing"] + v["cf_financing"], ["cf_operating", "cf_investing", "cf_financing"], py)
    acc("cf_check", "Cash check", "net change in cash − d(reserves)/dt", v["cf_net"] - D["res"], ["cf_net", "reserves"], py,
        note="Zero up to the accuracy of the time grid.")

    groups = [
        dict(id="balance", label="Balance sheet", sections=[
            dict(label="Assets", side="debit", accounts=["reserves", "mortgages", "firm_loans", "assets"]),
            dict(label="Liabilities", side="credit", accounts=["current_accounts", "savings", "interbank", "cb_borrowing", "liabilities"]),
            dict(label="Equity", side="credit", accounts=["equity", "liab_equity"]),
            dict(label="Reconciliation", side="", accounts=["balance_check"])]),
        dict(id="income", label="Income statement", sections=[
            dict(label="Interest income", accounts=["ii_mortgages", "ii_firms", "ii_reserves", "interest_income"]),
            dict(label="Interest expense", accounts=["ie_savings", "ie_interbank", "ie_cb", "interest_expense"]),
            dict(label="Result", accounts=["nii", "impairments", "net_profit", "dividend", "retained"])]),
        # no equity statement since 26 Nov 2026 (Jesse): retained profit goes straight into equity on the balance sheet; the
        # cumulative accounts stay as the inputs of equity (open the equity line to see them)
        dict(id="cashflow", label="Cash flow statement", sections=[
            dict(label="Operating activities", accounts=["cf_profit", "cf_mortgages", "cf_firm_loans", "cf_savings", "cf_interbank", "cf_operating"]),
            dict(label="Investing activities", accounts=["cf_investing"]),
            dict(label="Financing activities", accounts=["cf_cb", "cf_dividend", "cf_financing"]),
            dict(label="Result", accounts=["cf_net", "cf_check"])]),
        dict(id="ratios", label="Metrics", sections=[
            dict(label="Solvency (ALM Desk channel 1)", accounts=["rw_mortgages", "rwa", "tier1", "leverage"]),
            dict(label="Liquidity (ALM Desk channel 2)", accounts=["asf", "rsf", "nsfr", "ltd", "lcr"]),
            dict(label="Profitability", accounts=["roe", "nim", "margin10"])]),
    ]
    values = {k: [round(float(x), 4) if keep else None for x, keep in zip(a, valid)] for k, a in v.items()}
    return dict(version="bank-ledger-1", groups=groups, accounts=defs, values=values, thresholds=THRESHOLDS,
                links=[["income", "balance", "Retained profit → equity"], ["balance", "ratios", "Balance-sheet items"], ["income", "ratios", "Net profit"],
                       ["balance", "cashflow", "Changes in stocks"], ["income", "cashflow", "Net profit"]],
                basis="Statements built from the bank netlist's stocks and flows. Cash is the balancing item; current accounts are on the sheet but not yet connected to the model.")


def ledger_comp(tr: dict, b: dict, e: dict, grid_years: np.ndarray, sim_years: np.ndarray, valid: np.ndarray) -> dict:
    """The competitor bank's statements (26 Nov 2026, Jesse: 'I still want the accounting in the competitor bank'): the same
    layout as My Bank's (income statement, balance sheet, metrics), from the competitor's stocks and flows in the same run.
    No firm loans or current accounts (its banking book is mortgages, savings and deposits of other banks)."""
    T = lambda k: np.interp(grid_years, sim_years, np.nan_to_num(np.asarray(tr[k], dtype=float)))
    Mc, Dep, W, E, cash = T("I(Bk_mc)"), T("I(Bk_depc)"), T("I(Bk_wc)"), T("I(Bk_ec)"), T("I(Bk_cashc)")
    rmc, rs, prem, uw, rmk, rw_m = T("I(Bk_rmc)"), T("I(Bk_rs)"), T("I(Bk_prem)"), T("I(Bk_uw)"), T("I(Bk_rmk)"), T("I(Bk_rw_m)")
    gap, py, pct = b["gap_penalty_pp"] / 100, "model units / year", "%"
    v: dict[str, np.ndarray] = {}
    defs: dict[str, dict] = {}

    def acc(key, label, formula, value, inputs=(), unit="model units", source=NETLIST + ": competitor", note=""):
        defs[key] = dict(id=key, label=label, formula=formula, inputs=list(inputs), unit=unit, source=source, note=note, sign=1)
        if key in MIN:
            defs[key]["minimum"] = MIN[key]
        v[key] = np.asarray(value, dtype=float)

    acc("reserves", "Cash and central-bank reserves", "max(cash, 0)", np.maximum(cash, 0))
    acc("mortgages", "Mortgages", "the competitor's mortgage book", Mc)
    acc("assets", "Total assets", "reserves + mortgages", v["reserves"] + Mc, ["reserves", "mortgages"])
    acc("savings", "Savings deposits", "constant (its growth is funded by other banks)", Dep)
    acc("interbank", "Deposits of other banks", "funds its growth; withdrawn in the crisis", W)
    acc("cb_borrowing", "Central-bank borrowing", "max(−cash, 0)", np.maximum(-cash, 0))
    acc("liabilities", "Total liabilities", "savings + other banks + central bank", Dep + W + v["cb_borrowing"], ["savings", "interbank", "cb_borrowing"])
    acc("equity", "Equity", "opening equity + retained profit", E)
    acc("liab_equity", "Total liabilities and equity", "total liabilities + equity", v["liabilities"] + E, ["liabilities", "equity"])
    acc("balance_check", "Balance check", "total assets − total liabilities and equity", v["assets"] - v["liab_equity"], ["assets", "liab_equity"])
    acc("ii_mortgages", "Interest on mortgages", "its mortgage rate × mortgages", rmc * Mc, ["mortgages"], py)
    acc("ii_reserves", "Interest on reserves", "market rate × reserves", rmk * v["reserves"], ["reserves"], py)
    acc("interest_income", "Interest income", "sum of the above", v["ii_mortgages"] + v["ii_reserves"], ["ii_mortgages", "ii_reserves"], py)
    acc("ie_savings", "Interest on savings", "savings rate × savings deposits", rs * Dep, ["savings"], py)
    acc("ie_interbank", "Interest to other banks", "(market rate + premium) × deposits of other banks", (rmk + prem) * W, ["interbank"], py)
    acc("ie_cb", "Interest to the central bank", "(market rate + 1 pp) × central-bank borrowing", (rmk + gap) * v["cb_borrowing"], ["cb_borrowing"], py)
    acc("interest_expense", "Interest expense", "sum of the above", v["ie_savings"] + v["ie_interbank"] + v["ie_cb"], ["ie_savings", "ie_interbank", "ie_cb"], py)
    acc("nii", "Net interest income", "interest income − interest expense", v["interest_income"] - v["interest_expense"], ["interest_income", "interest_expense"], py)
    acc("impairments", "Impairments on mortgages", "loss rate × underwater share × mortgages", b["loss_uw"] * uw * Mc, ["mortgages"], py)
    acc("net_profit", "Net profit", "net interest income − impairments", v["nii"] - v["impairments"], ["nii", "impairments"], py)
    acc("dividend", "Dividend", "the same payout per unit of equity as My Bank", e["pay0"] * E / b["E0"], ["equity"], py)
    acc("retained", "Retained profit", "net profit − dividend", v["net_profit"] - v["dividend"], ["net_profit", "dividend"], py)
    acc("rwa", "Risk-weighted assets", "risk weight × mortgages", rw_m * Mc, ["mortgages"], source=DNB_RW)
    acc("tier1", "Tier 1 capital ratio", "equity ÷ risk-weighted assets", 100 * E / np.maximum(v["rwa"], 1e-9), ["equity", "rwa"], pct, MENKVELD + " eq. 3-7; target of its desk 8%")
    acc("nsfr", "Net stable funding ratio", "(90% × savings + equity) ÷ (65% × mortgages)", 100 * (b["asf_dep"] * Dep + E + b["asf_w"] * W) / np.maximum(b["rsf_m"] * Mc, 1e-9), ["savings", "equity", "mortgages"], pct, BASEL_NSF)
    acc("ltd", "Loan-to-deposit ratio", "mortgages ÷ savings", 100 * Mc / np.maximum(Dep, 1e-9), ["mortgages", "savings"], pct, MENKVELD + " eq. 3-1")
    acc("leverage", "Leverage ratio", "equity ÷ total assets", 100 * E / np.maximum(v["assets"], 1e-9), ["equity", "assets"], pct, "Basel LEV20.7")
    acc("share", "Market share of mortgages", "its book ÷ the market's", 100 * T("I(Bk_sharec)"), ["mortgages"], pct)
    acc("rate", "Its mortgage rate", "its own ALM desk (Tier 1 target 8%), never below funding cost + 0.2 pp", 100 * rmc, unit=pct)
    groups = [
        dict(id="balance", label="Balance sheet", sections=[
            dict(label="Assets", side="debit", accounts=["reserves", "mortgages", "assets"]),
            dict(label="Liabilities", side="credit", accounts=["savings", "interbank", "cb_borrowing", "liabilities"]),
            dict(label="Equity", side="credit", accounts=["equity", "liab_equity"]),
            dict(label="Reconciliation", side="", accounts=["balance_check"])]),
        dict(id="income", label="Income statement", sections=[
            dict(label="Interest income", accounts=["ii_mortgages", "ii_reserves", "interest_income"]),
            dict(label="Interest expense", accounts=["ie_savings", "ie_interbank", "ie_cb", "interest_expense"]),
            dict(label="Result", accounts=["nii", "impairments", "net_profit", "dividend", "retained"])]),
        dict(id="ratios", label="Metrics", sections=[
            dict(label="Solvency", accounts=["rwa", "tier1", "leverage"]),
            dict(label="Liquidity", accounts=["nsfr", "ltd"]),
            dict(label="Market", accounts=["share", "rate"])]),
    ]
    values = {k: [round(float(x), 4) if keep else None for x, keep in zip(a, valid)] for k, a in v.items()}
    return dict(version="bank-ledger-comp-1", groups=groups, accounts=defs, values=values, links=[], thresholds=THRESHOLDS,
                basis="The competitor's statements, from its stocks and flows in the same run.")
