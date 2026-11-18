import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import numpy as np
import pytest
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from housing import engine, ltspice, netlist as nl
from housing.raw import read_raw
from housing.scenario import Scenario, build, run, yoy_from_price
SAVED = ROOT / "model" / "reference" / "19okt_saved_closed_loop.raw"


def changed(a, b):
    return [(x, y) for x, y in zip(a, b) if x != y]


def test_default_closed_loop_netlist_is_the_original():
    assert build(Scenario(feedback=True, controller="netlist"), b4="original") == nl.read_model()


def test_site_changes_only_b4():
    a, b = nl.read_model(), build(Scenario(feedback=True, controller="netlist"))
    diff = changed(a, b)
    assert len(a) == len(b) and len(diff) == 1 and diff[0][0] == nl.B4_OLD and diff[0][1].startswith("B4 N027 0 V=-10*(")


def test_open_loop_changes_only_the_two_wiring_lines():
    a, b = nl.read_model(), build(Scenario(feedback=False), b4="original")
    assert len(a) == len(b)
    diff = changed(a, b)
    assert len(diff) == 2
    assert b[[i for i, l in enumerate(b) if l.startswith("I§Owner_occupied_subsidies")][0]].startswith("I§Owner_occupied_subsidies 0 N031 PWL(")
    assert not any(l.startswith("B§PID 0 N031") for l in b)


def test_batch_run_reproduces_saved_ltspice_result(tmp_path):
    p = tmp_path / "m.net"
    new, old = engine.simulate(build(Scenario(feedback=True, controller="netlist"), b4="original")), read_raw(SAVED)
    # LTspice reproduces its own saved run closely; ngspice (another solver) to within its validation level.
    tol = {"I(Construction_cost)": 0.02, "I(Pid)": 0.02, "yoy": 0.01} if engine.name() == "ltspice" else \
          {"I(Construction_cost)": 0.05, "I(Pid)": 0.2, "yoy": 0.05}
    for name in ("I(Construction_cost)", "I(Pid)"):
        gap = np.abs(np.interp(new["time"], old["time"], old[name]) - new[name])
        assert gap.max() < tol[name], name
    t = np.arange(0, 173.9, .1)
    assert np.abs(yoy_from_price(new, t)[t >= 6] - yoy_from_price(old, t)[t >= 6]).max() < tol["yoy"]


def test_time_shift_income_reaches_final_pwl_value(tmp_path):
    p = tmp_path / "m.net"
    d = engine.simulate(build(Scenario()))
    assert d["time"][-1] == pytest.approx(173.99, abs=1e-3)
    assert d["I(Incomeactual)"][-1] == pytest.approx(408.24, abs=1e-2)


def test_open_loop_applies_historical_subsidy():
    r = run(Scenario(feedback=False))
    assert r["kpis"]["subsidy_min"] == pytest.approx(20.98, abs=.01)
    assert r["kpis"]["subsidy_max"] == pytest.approx(29.34, abs=.01)


def test_feedback_changes_price_and_tracks_reference():
    closed, opened = run(Scenario(feedback=True)), run(Scenario(feedback=False))
    assert abs(closed["kpis"]["price_gap_final_pct"]) < 2
    assert abs(opened["kpis"]["price_gap_final_pct"]) > 2
    assert closed["kpis"]["yoy_std"] < opened["kpis"]["yoy_std"]


def test_derivative_filter_obeys_its_equation(tmp_path):
    p = tmp_path / "m.net"
    d = engine.simulate(build(Scenario(feedback=True, controller="hinf")))
    t = np.linspace(20, 170, 3000)
    x, dx = np.interp(t, d["time"], d["I(Pid_f)"]), np.interp(t, d["time"], d["I(Pid_d)"])
    numeric = np.gradient(x, t)
    assert np.abs(numeric - dx).max() < 0.05 * max(np.abs(dx).max(), 1)


@pytest.mark.parametrize("field,value", [("interest_scale", 1.5), ("income_scale", 1.1), ("mortgage_scale", .5), ("crisis_scale", 0), ("covid_scale", 0), ("subsidy_scale", .5)])
def test_each_input_changes_open_loop_result(field, value):
    base, other = run(Scenario()), run(Scenario(**{field: value}))
    assert base["netlist_sha256"] != other["netlist_sha256"]
    assert np.abs(np.array(base["series"]["price"]) - np.array(other["series"]["price"])).max() > .01


def test_target_growth_moves_closed_loop():
    k = run(Scenario(feedback=True, target_growth_pct=1.5))["kpis"]
    assert k["price_gap_final_pct"] == pytest.approx(0, abs=2)


def test_presets_cannot_be_overridden_and_bounds_hold():
    s = Scenario(feedback=True, controller="zn", kp=1)
    assert (s.kp, s.ki, s.kd, s.derivative_filter) == (8.18, 3.54, 4.72, True)
    with pytest.raises(ValueError):
        Scenario(ki=0)
    with pytest.raises(ValueError):
        Scenario(extra_line=".include evil")


def test_parallel_runs_do_not_mix():
    with ThreadPoolExecutor(4) as pool:
        a = list(pool.map(run, [Scenario(feedback=bool(i % 2)) for i in range(8)]))
    finals = [round(r["kpis"]["price_final"], 2) for r in a]
    assert len(set(finals[0::2])) == 1 and len(set(finals[1::2])) == 1 and finals[0] != finals[1]


def test_share_loop_holds_rental_share_and_leaves_price():
    a = run(Scenario(feedback=True, controller="hinf"))
    b = run(Scenario(feedback=True, controller="hinf", share_control=True))
    year, sa, sb = np.array(a["year"]), np.array(a["series"]["rental_share"]), np.array(b["series"]["rental_share"])
    late = year >= 2000
    assert np.abs(sb[late] - 20.5).max() < 1.0          # held near its target (largest gap 0.51, during a shock)
    assert np.abs(sa[late] - 20.5).max() > 3            # drifts without the loop
    assert np.abs(np.array(a["series"]["price"]) - np.array(b["series"]["price"])).max() < 0.5


def test_no_bank_zeroes_every_bank_port():
    from housing.scenario import Scenario, build
    lines = build(Scenario(bank=False))
    one = lambda p: next(l for l in lines if l.startswith(p))
    assert one("B§Mortgage_interest ").endswith("I=0") and one("B2 ").endswith("I=0") and one("B5 ").endswith("I=0")
    assert one("I8 0 N008 ") == "I8 0 N008 0" and not any(l.startswith("V4 ") for l in lines)
    for p in ("I§Mortgages 0 N007 ", "Interest_Rates 0 N005 "):
        vals = one(p).split("PWL(")[1].rstrip(")").split()[1::2]
        assert all(float(v) == 0 for v in vals)


def test_stable_income_path_grows_at_the_set_rate():
    from housing.scenario import Scenario, build
    line = next(l for l in build(Scenario(income_path="stable", income_growth_pct=2.0)) if l.startswith("Incomeactual "))
    n = [float(x) for x in line.split("PWL(")[1].rstrip(")").split()]
    t, v = n[0::2], n[1::2]
    assert abs(v[0] - 259.056) < 1e-3 and abs(v[-1] / v[0] - 1.02 ** (t[-1] / 6)) < 1e-4


def test_shift_pwl_moves_the_path_in_time():
    from housing import netlist as nl
    lines = ["I§X 0 N1 PWL(0 1 6 2 12 3)"]
    nl.shift_pwl(lines, "I§X ", 6.0)
    assert lines[0] == "I§X 0 N1 PWL(6 1 12 2 18 3)"
    lines = ["I§X 0 N1 PWL(0 1 6 2 12 3)"]
    nl.shift_pwl(lines, "I§X ", -3.0)
    assert lines[0] == "I§X 0 N1 PWL(0 1.5 3 2 9 3)"


def test_interest_blend_round_trips_the_netlist_path():
    import re
    from housing import netlist as nl
    from housing.scenario import Scenario, build
    vals = lambda lines: [float(x) for x in re.search(r"PWL\(([^)]*)\)", next(l for l in lines if l.startswith("Interest_Rates ")))[1].split()][1::2]
    base = vals(build(Scenario()))
    lines = build(Scenario()); nl.set_interest_blend(lines, 0.1 + 1e-6)
    assert max(abs(a - b) for a, b in zip(vals(lines), base)) < 1e-6   # a = 0.1 rebuilds the netlist path
    fast = vals(build(Scenario(interest_new_share=1.0)))
    assert fast[0] == base[0] and fast != base


def test_rental_subsidy_can_be_switched_off():
    from housing.scenario import Scenario, build
    line = next(l for l in build(Scenario(rental_subsidy=False)) if l.startswith("I§Rental_subsidies1 "))
    assert line == "I§Rental_subsidies1 0 N029 0"
    assert "PULSE(4 0 160" in next(l for l in build(Scenario()) if l.startswith("I§Rental_subsidies1 "))


def test_crisis_w_pwl():
    from housing import scenario as sc
    line = next(x for x in sc.build(sc.Scenario(crisis_w=True, crisis_w_start_yr=sc.YEAR_AT_RAW_ZERO + 10, crisis_w_scale=0.5, crisis_w_on_yr=1))
                if x.startswith("V§Shock_financialcrisis "))
    assert line == "V§Shock_financialcrisis N042 0 PWL(0 0 60 0 66 -25 72 -25 78 0 90 0 100 -50 135 -50 155 0)"


def test_equilibrium_start_on_reference():
    from housing import scenario as sc
    s = Scenario(feedback=True, controller="hinf", mortgage_scale=4.86, reference_base=120, target_growth_pct=0.9)
    eq = sc.equilibrium_subsidy(s)
    assert abs(eq["price0"] - 120) < 1e-3 and not eq["clipped"]
    line = next(x for x in build(s, u_start=eq["u_start"]) if x.startswith("B§PID 0 N031 "))
    assert line.startswith(f"B§PID 0 N031 I=if(time<=0,{eq['u_start']:.8g},limit(")


def _pwl(line):
    import re
    n = [float(x) for x in re.search(r"PWL\(([^)]*)\)", line)[1].split()]
    return n[0::2], n[1::2]


def test_crisis_mortgage_cut_is_off_by_default_and_adds_the_w():
    # Financial crisis in the bank's mortgage lending (18 Nov 2026): 0 leaves the netlist as before; 15 adds the W.
    from housing import scenario as sc
    W = dict(bank=True, crisis_w=True, crisis_w_start_yr=2007.8, crisis_w_fall_yr=0.8, crisis_w_scale=1, crisis_w_on_yr=0.8, crisis_w_recovery_yr=0.8, crisis_start_yr=2011.1)
    a, b = build(Scenario(**W)), build(Scenario(**W, crisis_mortgage_cut=15))
    assert changed(a, b) and all(x.startswith("I§Mortgages ") for x, _ in changed(a, b))
    (ta, va), (tb, vb) = _pwl(next(x for x in a if x.startswith("I§Mortgages "))), _pwl(next(x for x in b if x.startswith("I§Mortgages ")))
    yr = lambda y: (y - sc.YEAR_AT_RAW_ZERO) * sc.SECONDS_PER_YEAR
    for y, cut in [(2005, 0), (2008.9, 15), (2010.3, 0), (2013, 15), (2020, 0)]:   # both dips at full depth, before, between, after
        assert abs(np.interp(yr(y), tb, vb) - (np.interp(yr(y), ta, va) - cut)) < 1e-3, y
    assert build(Scenario(**{**W, "bank": False}, crisis_mortgage_cut=15)) == build(Scenario(**{**W, "bank": False}))


def test_flat_interest_holds_the_first_value():
    t, v = _pwl(next(x for x in build(Scenario(interest_path="flat", interest_scale=0.5)) if x.startswith("Interest_Rates ")))
    t0, v0 = _pwl(next(x for x in nl.read_model() if x.startswith("Interest_Rates ")))
    assert len(set(v)) == 1 and abs(v[0] - 0.5 * v0[0]) < 1e-9


def test_financial_crisis_alone_drops_the_price_about_21_percent():
    # The guided tour's crisis-only setup (Guide.tsx, CRISIS): bank on, everything else held still.
    s = Scenario(bank=True, mortgage_scale=0, interest_path="flat", crisis_mortgage_cut=15, crisis_scale=2, crisis_w=True, crisis_w_start_yr=2007.8,
                 crisis_w_fall_yr=0.8, crisis_w_scale=1, crisis_w_on_yr=0.8, crisis_w_recovery_yr=0.8, crisis_start_yr=2011.1, covid_scale=0,
                 income_path="stable", income_growth_pct=0, subsidy_scale=0, rental_subsidy=False, feedback=False)
    p = np.array(run(s)["series"]["price"])
    assert 20 < 100 * (90.64 - p.min()) / 90.64 < 23
