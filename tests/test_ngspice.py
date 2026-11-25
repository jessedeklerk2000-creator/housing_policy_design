"""ngspice translation: syntax rules, and the same results as LTspice where LTspice is installed."""
import sys
import tempfile
from pathlib import Path
import numpy as np
import pytest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from housing import ltspice, netlist as nl, ngspice as ng
from housing.scenario import Scenario, build, equilibrium_subsidy, yoy_from_price

needs_ng = pytest.mark.skipif(not ng.available(), reason="libngspice not available")
needs_lt = pytest.mark.skipif(not Path(ltspice.BINARY).exists(), reason="LTspice not installed")


def test_ltspice_pulse_edges():
    assert ng._ltspice_pulse("PULSE(00 80 150 0 50 15 2000)") == "PULSE(00 80 150 1.5 50 15 2000)"
    assert ng._ltspice_pulse("PULSE(4 0 160 0 0 1000 1000)") == "PULSE(4 0 160 1e-06 1e-06 1000 1000)"
    assert ng._ltspice_pulse("PULSE(00 -50 90 10 20 35 200)") == "PULSE(00 -50 90 10 20 35 200)"


def test_calls_are_rewritten():
    T = ng._Translator(); T.signal["a"] = "s_a"
    e = T.expr("limit(I(a),-60,600)+if(time<0.01,0,I(a))")
    assert e == "min(max(v(s_a),-60),600)+((time<0.01) ? (0) : (v(s_a)))"
    assert T.expr("I(a)**0.6") == "max(v(s_a),1e-6)**0.6"


def _both(s: Scenario):
    eq = equilibrium_subsidy(s) if s.feedback and s.equilibrium_start else None
    lines = build(s, u_start=eq["u_start"] if eq else None)
    with tempfile.TemporaryDirectory() as d:
        p = Path(d) / "r.net"; nl.write_netlist(lines, p); a = ltspice.run(p)
    return a, ng.run_lines(lines)


@needs_ng
@needs_lt
@pytest.mark.parametrize("s", [Scenario(feedback=False), Scenario(feedback=True, controller="zn"),
                               Scenario(feedback=True, controller="netlist", equilibrium_start=False),
                               Scenario(feedback=False, bank=False, crisis_scale=0, covid_scale=0, income_path="stable", rental_subsidy=False)],
                         ids=["open", "zn", "netlist-soft", "no-bank"])
def test_ngspice_matches_ltspice(s):
    a, b = _both(s)
    t = np.arange(0, 173.9, 0.6)
    pa, pb = (np.interp(t, x["time"], x["I(Construction_cost)"]) for x in (a, b))
    assert np.abs(pa - pb).max() < 0.1
    assert np.abs(yoy_from_price(a, t) - yoy_from_price(b, t))[10:].max() < 0.1
    assert set(a) - set(b) <= {k for k in a if k.startswith("V(")}  # every current LTspice reports is there


@needs_lt
def test_stored_b4_point_is_the_ltspice_value():
    from housing.scenario import B4_POINT, SECONDS_PER_YEAR, YEAR_AT_RAW_ZERO
    lines = build(Scenario(feedback=False), b4="nonlinear")
    with tempfile.TemporaryDirectory() as d:
        p = Path(d) / "b4.net"; nl.write_netlist(lines, p); tr = ltspice.run(p)
    t = (2015.0 - YEAR_AT_RAW_ZERO) * SECONDS_PER_YEAR
    for k, v in B4_POINT.items():
        assert np.interp(t, tr["time"], tr[k]) == pytest.approx(v, rel=1e-6), k


@needs_ng
@pytest.mark.parametrize("options", [".options reltol=1e-4", ".options reltol=1e-5", ".options reltol=1e-4 trtol=1"])
@pytest.mark.parametrize("s", [Scenario(), Scenario(feedback=True, controller="hinf"), Scenario(feedback=True, controller="zn"),
                               Scenario(feedback=True, controller="netlist"),
                               Scenario(feedback=True, controller="zn", bank=False, rental_subsidy=False),
                               Scenario(feedback=True, controller="hinf", share_control=True)],
                         ids=["open", "hinf", "zn", "netlist-pid", "nobank-zn", "hinf-share"])
def test_runs_with_strict_tolerances(monkeypatch, s, options):
    """Stricter settings than the default reproduce the 'timestep too small' stops seen with the Windows ngspice DLL:
    trapezoidal ringing at the inductor-only node N019 (fixed by the parallel resistors on the inductors), and at the
    equilibrium start round-off noise in the PID's integrators against ngspice's chip-sized error floors (fixed by
    ABSTOL/CHGTOL; without them netlist-pid, nobank-zn and hinf-share stopped at t = 1e-4 s with reltol 1e-4)."""
    translate = ng.translate
    def strict(lines):
        text, names, tstart = translate(lines)
        return text.replace("\n.end", "\n" + options + "\n.end"), names, tstart
    monkeypatch.setattr(ng, "translate", strict)
    eq = equilibrium_subsidy(s) if s.feedback and s.equilibrium_start else None
    d = ng.run_lines(build(s, u_start=eq["u_start"] if eq else None))
    assert np.all(np.isfinite(d["I(Construction_cost)"]))


@needs_ng
@pytest.mark.parametrize("options", ["", ".options reltol=1e-4"])
@pytest.mark.parametrize("s", [Scenario(bank=False), Scenario(feedback=True, bank=False, controller="zn", rental_subsidy=False)],
                         ids=["nobank", "nobank-zn-norent"])
def test_no_bank_runs_finish(monkeypatch, s, options):
    """With 1 kOhm across the inductors these stopped at t = 178 (random-settings check, 6 Nov 2026)."""
    test_runs_with_strict_tolerances(monkeypatch, s, options or ".options reltol=1e-3")


@needs_ng
@pytest.mark.parametrize("s", [Scenario(controller="hinf"), Scenario(bank=False, controller="zn", rental_subsidy=False),
                               Scenario(interest_scale=1.8, income_path="stable")], ids=["hinf", "nobank-zn", "rate"])
@pytest.mark.parametrize("u", [0.0, 30.0, -40.0])
def test_operating_point_is_the_transient_start(s, u):
    """The equilibrium start uses a .op analysis (no time steps). It must equal the first point of the transient.
    The transient here uses the run's own step settings (0.01 s step); the old 0.01 s initialisation transient
    (.tran 0 0.01 0 0.005) hung on the Windows DLL for nobank-zn at u = 30 (GitHub Actions, 6 Nov 2026)."""
    lines = build(s.model_copy(update={"feedback": False, "share_control": False}))
    nl.set_constant_subsidy(lines, u)
    op = ng.operating_point(lines)["I(Construction_cost)"]
    nl.set_tran(lines, ".tran 0.01 1 0")
    tran = ng.run_lines(lines)["I(Construction_cost)"][0]
    assert abs(op - tran) < 1e-6


@needs_ng
def test_run_timeout_stops_and_recovers(monkeypatch):
    """A run longer than HOUSING_NGSPICE_TIMEOUT is halted with an error; the next run works again."""
    lines = build(Scenario(feedback=False))
    monkeypatch.setenv("HOUSING_NGSPICE_TIMEOUT", "0.02")
    with pytest.raises(RuntimeError, match="HOUSING_NGSPICE_TIMEOUT"):
        ng.run_lines(lines)
    monkeypatch.setenv("HOUSING_NGSPICE_TIMEOUT", "60")
    assert np.isfinite(ng.run_lines(lines)["I(Construction_cost)"][-1])
