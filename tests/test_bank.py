"""Bank steers (experimental, 20 Nov 2026): the ALM desk on a separate copy of the housing netlist (bank_netlist.py).
Numbers are the demo defaults (20 Nov 2026; 24 Nov 2026: live firm-loan port, NSFR loop, historical subsidy, gain 300)."""
import json
import sys
from pathlib import Path
import pytest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from fastapi.testclient import TestClient
from housing import bank_netlist as bn, ngspice
from housing.scenario import Scenario, build
from housing.server import create_app

pytestmark = pytest.mark.skipif(not ngspice.available(), reason="needs libngspice")


def test_housing_netlist_is_untouched():
    base = build(Scenario(**bn.BASE))
    coupled, _ = bn.lines(dict(bn.BANK_DEFAULTS))
    assert not any("bk_" in l for l in base)
    assert any(l.startswith("I§Mortgages ") for l in base) and not any(l.startswith("I§Mortgages ") for l in coupled)


def test_starts_at_rest():
    r = bn.simulate(alm_on=False)
    assert r["underwater_pct"][0] == pytest.approx(17.38, abs=0.02)  # ngspice a**3 = |a|**3 bug guarded in _phi
    assert r["mortgage_book"][0] == pytest.approx(100, abs=0.01) and r["mortgage_book"][50] == pytest.approx(100, abs=0.1)
    assert r["tier1_pct"][0] == pytest.approx(r["targets"]["tier1_pct"], abs=0.01) and r["ltf_pct"][0] == pytest.approx(100, abs=0.02)
    assert r["nsfr_pct"][0] == pytest.approx(r["targets"]["nsfr_pct"], abs=0.02) and r["firm_loans"][50] == pytest.approx(40, abs=0.05)
    assert r["price_index"][0] == pytest.approx(100, abs=0.05)  # at rest at t = 0 with the historical subsidy (which then moves)
    q = bn.simulate({"hist_subsidy": 0}, alm_on=False)
    assert q["price_index"][50] == pytest.approx(100, abs=0.1)   # without it, still at rest in year 5


def test_the_bank_passes_the_crisis_on():
    o = {"covid_scale": 0}  # the financial crisis on its own
    a, b, c = bn.simulate(o, alm_on=False), bn.simulate(o, housing_feedback=False), bn.simulate(o)
    assert all(x["ok"] for x in (a, b, c))
    assert b["summary"]["min_price_pct"] > -2                                           # without the bank, housing hardly notices
    # 26 Nov 2026, sourced shock (premium +1.9 pp, ECB FSR Dec 2008; central bank at policy rate + 1 pp): the bank's
    # lending cut carries the shock to housing (rates frozen: -3.5%); the desk softens it, as the bank's ratios improve
    # when it lends less and the desk lowers its rates (was: the desk passed the crisis on, -7.3%).
    assert a["summary"]["min_price_pct"] == pytest.approx(-3.5, abs=0.5)
    assert c["summary"]["min_price_pct"] == pytest.approx(-1.5, abs=0.5)
    assert c["summary"]["max_price_after_crisis_pct"] == pytest.approx(4.7, abs=0.7)     # and the rebound
    assert a["summary"]["min_tier1_pct"] < c["summary"]["min_tier1_pct"] - 0.3          # the desk still protects capital
    assert a["summary"]["mortgage_rate_range_pct"] == [3.7, 3.7]


def test_a_runaway_is_cut_and_valid_json():
    r = bn.simulate({"k_rate": 3000})  # with the DNB risk weight (24 Nov 2026) the loop runs away only from about 3000
    assert not r["ok"] and 10 < r["breakdown_year"] < 20 and r["price_index"][-1] is None
    json.dumps(r, allow_nan=False)


def test_government_step_moves_the_price():
    r = bn.simulate({"gov_step": 10, "funding_cut": 0, "premium_pp": 0, "covid_scale": 0, "hist_subsidy": 0}, alm_on=False)
    assert r["subsidy"][-1] == pytest.approx(10) and 104 < r["price_index"][-1] < 108


def test_api_whitelists_and_clamps(tmp_path):
    c = TestClient(create_app(tmp_path / "t.sqlite3"))
    r = c.post("/api/bank/simulate", json={"overrides": {}, "alm_on": True, "housing_feedback": True})
    assert r.status_code == 200 and r.json()["summary"]["min_price_pct"] == pytest.approx(-1.5, abs=0.5)
    assert c.post("/api/bank/simulate", json={"overrides": {"E0": 5}}).status_code == 422
    assert c.post("/api/bank/simulate", json={"overrides": {}, "netlist": "x"}).status_code == 422
    big = c.post("/api/bank/simulate", json={"overrides": {"funding_cut": 9}}).json()
    assert big == c.post("/api/bank/simulate", json={"overrides": {"funding_cut": 1.0}}).json()


def test_covid_shock_stays_in():
    on, off = bn.simulate(), bn.simulate({"covid_scale": 0})
    assert max(on["covid"]) == pytest.approx(80) and max(off["covid"]) == 0
    assert on["summary"]["min_price_pct"] == pytest.approx(off["summary"]["min_price_pct"], abs=0.1)  # Covid comes after the crisis
    assert on["summary"]["max_price_after_crisis_pct"] > off["summary"]["max_price_after_crisis_pct"] + 4  # Covid house-price boom


def test_menkveld_rate_definitions():
    """Menkveld (2025) eq. 3-4 and 3-8: FTP = (loan rate + savings rate)/2 and spread = loan rate - savings rate."""
    r = bn.simulate()
    for i in (0, 120, 200, 280):
        rm, rs = r["mortgage_rate_pct"][i], r["savings_rate_pct"][i]
        assert (rm + rs) / 2 == pytest.approx(r["ftp_pct"][i], abs=1e-3) and rm - rs == pytest.approx(r["spread_pct"][i], abs=1e-3)


def test_firm_loans_and_nsfr():
    """The firm-loan port is live: a short book (1.3 years) that shrinks in the credit crunch and takes losses; the FTP
    loop tracks the NSFR (Basel III factors), which starts at its target."""
    r = bn.simulate({"covid_scale": 0})
    assert r["targets"]["nsfr_pct"] == pytest.approx(126.47, abs=0.05)  # Basel: interbank < 6 months counts 0%
    assert 30 < min(x for x in r["firm_loans"] if x is not None) < 38                     # calibrated: about -15%, no collapse
    off = bn.simulate({"covid_scale": 0}, alm_on=False)
    # the desk protects capital (gap 0.56 pp since 26 Nov 2026: no firm-loan losses, sourced premium; was > 2)
    assert off["summary"]["min_tier1_pct"] < r["summary"]["min_tier1_pct"] - 0.3


def test_historical_subsidy_is_a_disturbance():
    on, off = bn.simulate({"covid_scale": 0}, alm_on=False), bn.simulate({"covid_scale": 0, "hist_subsidy": 0}, alm_on=False)
    assert on["subsidy_hist"][0] == pytest.approx(24.0, abs=0.1) and max(abs(x) for x in off["subsidy_hist"]) == 0
    assert on["price_index"][0] == pytest.approx(100, abs=0.05) and off["price_index"][0] == pytest.approx(100, abs=0.05)


def test_ledger_balances_and_gives_the_controlled_ratios():
    """ALM Reporting (25 Nov 2026): the statements balance, equity reconciles with the income statement, and the key
    figures on the sheet are the ratios the ALM Desk controls."""
    r = bn.simulate()
    L = r["ledger"]
    V = L["values"]
    assert max(abs(x) for x in V["balance_check"]) < 1e-6
    assert max(abs(x) for x in V["equity_check"]) < 0.01
    assert max(abs(a - b) for a, b in zip(V["tier1"], r["tier1_pct"])) < 1e-3
    assert max(abs(a - b) for a, b in zip(V["nsfr"], r["nsfr_pct"])) < 1e-3
    assert all(x == 0 for x in V["current_accounts"])  # on the sheet, not yet connected
    for g in L["groups"]:
        for s in g["sections"]:
            for a in s["accounts"]:
                assert a in L["accounts"] and a in V and all(i in L["accounts"] for i in L["accounts"][a]["inputs"])


@pytest.mark.parametrize("ov, alm, fb", [({}, True, True), ({}, False, True), ({}, True, False),
                                         ({"funding_cut": 1.0, "premium_pp": 4.0}, True, True), ({"funding_cut": 1.0, "premium_pp": 4.0}, False, True)])
def test_cash_flow_statement_reconciles(ov, alm, fb):
    """Cash flow statement (M. Mendel, 26 Nov 2026): operating + investing + financing = the change in cash, also in a
    severe financial crisis. The derivatives come from the solver's own time steps, so the check stays below 0.01 a year."""
    r = bn.simulate(ov, alm, fb)
    V = r["ledger"]["values"]
    assert max(abs(x) for x in V["cf_check"] if x is not None) < 0.01
    assert r["ledger"]["groups"][-1]["label"] == "Metrics"


def test_crisis_starts_at_the_other_banks_only():
    """26 Nov 2026: no shock at the firms; the bank cuts new firm lending by credit_supply % per 1% funding lost."""
    o = {"covid_scale": 0}
    c, n = bn.simulate(o), bn.simulate({**o, "credit_supply": 0.0})
    lines = bn.lines({**bn.BANK_DEFAULTS, **o})[0]
    assert not any("loss_firm" in l or "firm_link" in l for l in lines)
    firm = next(l for l in lines if l.startswith("B§Firm_loans "))
    lsf = next(l for l in lines if l.startswith("B§bk_lsf "))
    assert "I(bk_Dep)+I(bk_W)" in lsf and "I(bk_lsf)" in firm and "Crisis_timing" not in firm
    assert any(l.startswith("B§Credit_conditions 0 N007 ") and "I(bk_lsfm)" in l for l in lines)  # market-weighted; = lsf without the competitor
    assert min(c["firm_new_loans"]) < min(n["firm_new_loans"]) - 1   # the bank lends less to firms when it loses funding
    assert bn.BANK_DEFAULTS["credit_supply"] == 0.6                   # Khwaja & Mian (2008)


def test_credit_channel_matches_dnb():
    """26 Nov 2026: a permanent 10% cut in lending supply, rates frozen, gives ~0.75% lower price per 1% less mortgage debt
    at the end of the run (DNB Occasional Studies 13-2, 2015: debt -6%, price -4 to -5% for a lower LTV limit)."""
    orig = bn.lines
    def cut(b, alm_on=True, housing_feedback=True):
        out, e = orig(b, alm_on, housing_feedback)
        t0 = bn.T0 + 6 * 5
        return [l.replace("I=max(", f"I=(1-0.1*min(max((time-{t0})/6,0),1))*max(", 1) if l.startswith("B§bk_lsf ") else l for l in out], e
    o = {"funding_cut": 0, "premium_pp": 0, "covid_scale": 0, "hist_subsidy": 0}
    base = bn.simulate(o, alm_on=False)
    bn.lines = cut
    try:
        c = bn.simulate(o, alm_on=False)
    finally:
        bn.lines = orig
    dM = c["mortgage_book"][-1] / base["mortgage_book"][-1] - 1
    dP = c["price_index"][-1] / base["price_index"][-1] - 1
    assert dM < -0.08 and dP / dM == pytest.approx(0.75, abs=0.05)


def test_dnb_thresholds_lcr_and_nim():
    """Feedback round 2 B1: DNB thresholds with primary sources, the simplified LCR and the NIM in the metrics."""
    r = bn.cached((), True, True)
    led = r["ledger"]
    th = {t["id"]: t for t in led["thresholds"]}
    assert th["tier1"]["value"] == 6.0 and th["nsfr"]["value"] == 100.0 and th["leverage"]["value"] == 3.0 and th["lcr"]["value"] == 100.0
    assert all(("CRR" in t["source"]) or ("DNB" in t["source"]) for t in th.values())
    acc = led["accounts"]
    assert acc["tier1"]["minimum"] == 6.0 and acc["lcr"]["minimum"] == 100.0 and "minimum" not in acc["roe"]
    v = led["values"]
    lcr0 = 100 * v["reserves"][0] / (0.10 * v["savings"][0])
    assert v["lcr"][0] == pytest.approx(lcr0, abs=0.01)
    assert v["nim"][0] == pytest.approx(100 * v["nii"][0] / v["assets"][0], abs=0.01)
    ratios = next(g for g in led["groups"] if g["id"] == "ratios")
    assert "lcr" in ratios["sections"][1]["accounts"] and "nim" in ratios["sections"][2]["accounts"]


def test_competitor_bank():
    """Feedback round 2 B3: off by default (one-bank results unchanged). On, it starts at 20% and prices on its own (fixed
    rate 0.3 pp below the bank's start rate). Without a crisis it gains share and stays above 6% Tier 1 (desk on or off);
    the crisis pushes it below 6% while the bank stays above. Numbers reported, not tuned."""
    off = bn.simulate({})
    assert max(abs(x or 0) for x in off["comp_book"]) < 1e-6 and off["summary"]["min_price_pct"] == pytest.approx(-1.51, abs=0.05)
    for alm in (True, False):
        calm = bn.simulate({"competitor": 1, "funding_cut": 0, "premium_pp": 0}, alm_on=alm)
        crisis = bn.simulate({"competitor": 1}, alm_on=alm)
        assert calm["comp_share_pct"][0] == pytest.approx(20, abs=0.5) and calm["comp_share_pct"][-1] > 22
        assert min(calm["comp_tier1_pct"]) > 6
        assert min(crisis["comp_tier1_pct"]) < 6 and crisis["summary"]["min_tier1_pct"] > 6
