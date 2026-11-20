"""Bank steers (experimental, 20 Nov 2026): the ALM desk on a separate copy of the housing netlist (bank_netlist.py).
Numbers are the demo defaults chosen 20 Nov 2026 (rate-channel gain 130, half the wholesale funding withdrawn)."""
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
    assert r["mortgage_book"][0] == pytest.approx(100, abs=0.01) and r["mortgage_book"][50] == pytest.approx(100, abs=0.01)
    assert r["tier1_pct"][0] == pytest.approx(r["targets"]["tier1_pct"], abs=0.01) and r["ltf_pct"][0] == pytest.approx(100, abs=0.01)


def test_the_bank_passes_the_crisis_on():
    o = {"covid_scale": 0}  # the financial crisis on its own
    a, b, c = bn.simulate(o, alm_on=False), bn.simulate(o, housing_feedback=False), bn.simulate(o)
    assert all(x["ok"] for x in (a, b, c))
    assert a["summary"]["min_price_pct"] > -2 and b["summary"]["min_price_pct"] > -2  # housing hardly notices
    assert a["summary"]["min_tier1_pct"] < c["summary"]["min_tier1_pct"] - 0.8          # ...but the bank takes the hit
    assert c["summary"]["min_price_pct"] == pytest.approx(-23.0, abs=0.5)                # the desk passes it on
    assert c["summary"]["max_price_after_crisis_pct"] == pytest.approx(6.9, abs=0.5)     # and the rebound
    assert c["summary"]["mortgage_rate_range_pct"][1] > 5.0 and a["summary"]["mortgage_rate_range_pct"] == [3.7, 3.7]


def test_a_runaway_is_cut_and_valid_json():
    r = bn.simulate({"k_rate": 300})
    assert not r["ok"] and 10 < r["breakdown_year"] < 20 and r["price_index"][-1] is None
    json.dumps(r, allow_nan=False)


def test_government_step_moves_the_price():
    r = bn.simulate({"gov_step": 10, "funding_cut": 0, "premium_pp": 0, "covid_scale": 0}, alm_on=False)
    assert r["subsidy"][-1] == pytest.approx(10) and 104 < r["price_index"][-1] < 108


def test_api_whitelists_and_clamps(tmp_path):
    c = TestClient(create_app(tmp_path / "t.sqlite3"))
    r = c.post("/api/bank/simulate", json={"overrides": {}, "alm_on": True, "housing_feedback": True})
    assert r.status_code == 200 and r.json()["summary"]["min_price_pct"] == pytest.approx(-23.0, abs=0.5)
    assert c.post("/api/bank/simulate", json={"overrides": {"E0": 5}}).status_code == 422
    assert c.post("/api/bank/simulate", json={"overrides": {}, "netlist": "x"}).status_code == 422
    big = c.post("/api/bank/simulate", json={"overrides": {"funding_cut": 9}}).json()
    assert big == c.post("/api/bank/simulate", json={"overrides": {"funding_cut": 1.0}}).json()


def test_covid_shock_stays_in():
    on, off = bn.simulate(), bn.simulate({"covid_scale": 0})
    assert max(on["covid"]) == pytest.approx(80) and max(off["covid"]) == 0
    assert on["summary"]["min_price_pct"] == pytest.approx(off["summary"]["min_price_pct"], abs=0.1)  # Covid comes after the crisis
    assert on["summary"]["max_price_after_crisis_pct"] > off["summary"]["max_price_after_crisis_pct"] + 8  # Covid house-price boom


def test_menkveld_rate_definitions():
    """Menkveld (2025) eq. 3-4 and 3-8: FTP = (loan rate + savings rate)/2 and spread = loan rate - savings rate."""
    r = bn.simulate()
    for i in (0, 120, 200, 280):
        rm, rs = r["mortgage_rate_pct"][i], r["savings_rate_pct"][i]
        assert (rm + rs) / 2 == pytest.approx(r["ftp_pct"][i], abs=1e-3) and rm - rs == pytest.approx(r["spread_pct"][i], abs=1e-3)
