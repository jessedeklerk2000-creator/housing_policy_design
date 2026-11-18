"""Builds run netlists from the unchanged 19 Oct LTspice model.

The model file is never edited. Each option replaces exact, asserted element lines,
so a change in the source netlist fails loudly instead of silently altering the run.
"""
from __future__ import annotations
from dataclasses import dataclass
from pathlib import Path
import re

import numpy as np

MODEL = Path(__file__).resolve().parents[2] / "model" / "19okt_housing_market.net"
START_OFFSET = -29.29  # subsidy ramp offset already in B§PID
Y0_CLOSED = 80.30878   # I(Construction_cost) at t=0 measured with LTspice


def read_model(path: Path = MODEL) -> list[str]:
    return path.read_bytes().decode("utf-16-le").split("\n")


def write_netlist(lines: list[str], path: Path) -> None:
    path.write_bytes("\n".join(lines).encode("utf-16-le"))


def _index(lines: list[str], prefix: str) -> int:
    hits = [i for i, line in enumerate(lines) if line.startswith(prefix)]
    if len(hits) != 1:
        raise ValueError(f"expected one line starting {prefix!r}, found {len(hits)}")
    return hits[0]


def _sub_exact(line: str, old: str, new: str) -> str:
    if line.count(old) != 1:
        raise ValueError(f"expected {old!r} once in {line[:80]!r}")
    return line.replace(old, new)


def _scale_pwl(line: str, factor: float) -> str:
    match = re.search(r"PWL\(([^)]*)\)", line)
    numbers = match[1].split()
    numbers[1::2] = [f"{float(v) * factor:.6g}" for v in numbers[1::2]]
    return line[:match.start(1)] + " ".join(numbers) + line[match.end(1):]


@dataclass(frozen=True)
class Controller:
    kp: float
    ki: float
    kd: float
    filter_per_s: float | None = None  # derivative filter corner, rad per simulation second
    integrator_start: float | None = None  # None: START_OFFSET / ki, so the ramp hands over smoothly
    # Equilibrium start (thesis EQUILIBRIUM_INIT_HANDOFF.md): no 5-s soft start, the integrator is pre-charged with
    # u_ss / ki (integrator_start) and the derivative filter starts at zero error.
    equilibrium: bool = False


def set_open_loop(lines: list[str]) -> None:
    """Historical subsidy PWL drives N031. The PID is disconnected."""
    i = _index(lines, "I§Owner_occupied_subsidies NC_01 NC_02 ")
    lines[i] = _sub_exact(lines[i], " NC_01 NC_02 ", " 0 N031 ")
    i = _index(lines, "B§PID 0 N031 ")
    lines[i] = _sub_exact(lines[i], "B§PID 0 N031 ", "B§PID NC_PID1 NC_PID2 ")


PID_OLD = "B§PID 0 N031 I=-29.29*(1-min(time/5,1))+if(time<0,24,limit(2.06*i(PID_P)+0.55*I(PID_I_robust)+0.67*I(PID_D),-60,600)*min(time/5,1))"


def set_constant_subsidy(lines: list[str], u: float) -> None:
    """Open-loop netlist with the owner-occupied subsidy held at a constant u (for the equilibrium start)."""
    i = _index(lines, "I§Owner_occupied_subsidies 0 N031 ")
    lines[i] = f"I§Owner_occupied_subsidies 0 N031 {u:.8g}"


def set_subsidy_pwl(lines: list[str], points: list[tuple[float, float]]) -> None:
    """Open-loop netlist with the owner-occupied subsidy as a PWL of (circuit time s, value) points."""
    i = _index(lines, "I§Owner_occupied_subsidies 0 N031 ")
    lines[i] = "I§Owner_occupied_subsidies 0 N031 PWL(" + " ".join(f"{t:.6g} {v:.6g}" for t, v in points) + ")"


def set_tran(lines: list[str], tran: str) -> None:
    i = _index(lines, ".tran ")
    lines[i] = tran


def set_controller(lines: list[str], c: Controller, reference_base: float) -> None:
    """Feedback through B§PID, the element already wired to N031."""
    i = _index(lines, "B§PID 0 N031 ")
    gain = f"{c.kp:.6g}*i(PID_P)+{c.ki:.6g}*I(PID_I_robust)+{c.kd:.6g}*I(PID_D)"
    if c.equilibrium:
        if lines[i].rstrip("\r") != PID_OLD:
            raise ValueError(f"B§PID changed in the model: {lines[i]!r}")
        # Held at u_ss during the DC operating point (time = 0): there the loop with its limits has more than one
        # solution and LTspice can pick the saturated one. From then on the pre-charged PID gives the same u_ss.
        lines[i] = f"B§PID 0 N031 I=if(time<=0,{c.ki * c.integrator_start:.8g},limit({gain},-60,600))"
    else:
        lines[i] = _sub_exact(lines[i], "2.06*i(PID_P)+0.55*I(PID_I_robust)+0.67*I(PID_D)", gain)
    start = START_OFFSET / c.ki if c.integrator_start is None else c.integrator_start
    i = _index(lines, "B§PID_I_Robust 0 0 ")
    lines[i] = _sub_exact(lines[i], "-51.38", f"{start:.6g}")
    if c.filter_per_s is not None:
        n, e0 = f"{c.filter_per_s:.6g}", ("0" if c.equilibrium else f"{reference_base - Y0_CLOSED:.6g}")
        i = _index(lines, "B§PID_D 0 0 ")
        lines[i] = f"B§PID_D 0 0 I={n}*(I(Error)-I(PID_F))"
        lines.insert(i + 1, f"B§PID_F 0 0 I=idt({n}*(I(Error)-I(PID_F)),{e0})")


B4_OLD = "B4 N027 0 V=-1*(I(net_housing_rent1)-I(net_housing1))"
B4_GAIN = 10.0  # Jesse 2026-11-04: -10, as in the thesis, instead of the netlist's -1


def set_b4(lines: list[str], gain: float = B4_GAIN, point: dict[str, float] | None = None) -> None:
    """B4 couples the money side to the services side: V = -k (rent/h_rent - imputed/h_owner).
    Without a point: the non-linear source with gain k. With a point (rent, demand_rent, imputed,
    demand_owner): its first-order expansion there, R/D ~ R0/D0 + (R - R0)/D0 - R0 (D - D0)/D0^2."""
    i = _index(lines, "B4 N027 0 ")
    if lines[i].rstrip("\r") != B4_OLD:
        raise ValueError(f"B4 changed in the model: {lines[i]!r}")
    if point is None:
        lines[i] = f"B4 N027 0 V=-{gain:.6g}*(I(net_housing_rent1)-I(net_housing1))"
        return
    R0, Dr, I0, Do = point["I(Rent)"], point["I(Demand_rent)"], point["I(Imputed_rent)"], point["I(Demand_owner_occupied)"]
    rent = f"({R0 / Dr:.8g}+(I(Rent)-{R0:.8g})/{Dr:.8g}-{R0:.8g}*(I(Demand_rent)-{Dr:.8g})/{Dr ** 2:.8g})"
    own = f"({I0 / Do:.8g}+(I(Imputed_rent)-{I0:.8g})/{Do:.8g}-{I0:.8g}*(I(Demand_owner_occupied)-{Do:.8g})/{Do ** 2:.8g})"
    lines[i] = f"B4 N027 0 V=-{gain:.6g}*({rent}-{own})"


def set_share_controller(lines: list[str], c: Controller, target_pct: float) -> None:
    """Second loop: holds the rental share of housing services, 100 h_rent / (h_rent + h_owner).
    Its output moves money between the subsidies: + to the rental source (N029), - from the owner
    source (N031). Both subsidies move the price by the same amount, so the price loop is hardly disturbed."""
    n = c.filter_per_s
    gain = f"{c.kp:.6g}*I(SError)+{c.ki:.6g}*I(SPID_I)" + (f"+{c.kd:.6g}*I(SPID_D)" if c.kd else "")
    new = [
        "B§Share 0 0 I=100*I(Demand_rent)/(I(Demand_rent)+I(Demand_owner_occupied))",
        f"B§SError 0 0 I={target_pct:.6g}-I(Share)",
        "B§SPID_I 0 0 I=idt(I(SError))",
        (f"B§SPID_D 0 0 I={n:.6g}*(I(SError)-I(SPID_F))" if n else "B§SPID_D 0 0 I=ddt(I(SError))"),
        *( [f"B§SPID_F 0 0 I=idt({n:.6g}*(I(SError)-I(SPID_F)))"] if n else [] ),
        f"B§SPID 0 0 I=limit(({gain})*min(time/5,1),-60,60)",
        "B§Share_owner 0 N031 I=-I(SPID)",
        "B§Share_rent 0 N029 I=I(SPID)",
    ]
    i = _index(lines, "B§PID 0 N031 ")
    lines[i + 1:i + 1] = new


def set_reference(lines: list[str], base: float, growth_pct: float) -> None:
    i = _index(lines, "B§Reference 0 0 ")
    lines[i] = _sub_exact(lines[i], "I=80*1.025**(time/6)", f"I={base:.6g}*{1 + growth_pct / 100:.6g}**(time/6)")


def scale_source(lines: list[str], prefix: str, factor: float) -> None:
    """Scale the values of a PWL source, leaving its time points alone."""
    if factor != 1:
        i = _index(lines, prefix)
        lines[i] = _scale_pwl(lines[i], factor)


def set_pulse_amplitude(lines: list[str], prefix: str, old: str, factor: float) -> None:
    """Scale a shock's PULSE amplitude; old is the unchanged 'PULSE(v1 v2' text."""
    if factor != 1:
        i = _index(lines, prefix)
        head, amplitude = old.rsplit(" ", 1)
        lines[i] = _sub_exact(lines[i], old, f"{head} {float(amplitude) * factor:.6g}")


def set_no_bank(lines: list[str]) -> None:
    """The original CPB model has no bank: every bank port carries zero current.

    The three inputs into the bank (mortgage lending, mortgage interest rate, lending to firms) are zero,
    and the bank-side sources of the other ports are zero: mortgage interest, savings (V4 becomes a 0 A
    source, so no current flows in L8), savings interest (B2) and loan interest (B5).
    """
    for prefix in ("I§Mortgages 0 N007 ", "Interest_Rates 0 N005 "):
        i = _index(lines, prefix)
        lines[i] = _scale_pwl(lines[i], 0.0)
    for prefix, new in (("I8 0 N008 ", "I8 0 N008 0"), ("B§Mortgage_interest N007 0 ", "B§Mortgage_interest N007 0 I=0"),
                        ("B2 0 N011 ", "B2 0 N011 I=0"), ("B5 N001 N003 ", "B5 N001 N003 I=0"), ("V4 N014 0 ", "I§No_savings N014 0 0")):
        lines[_index(lines, prefix)] = new


def set_income_path(lines: list[str], growth_pct: float) -> None:
    """Replace the historical income PWL by a stable growth path from the same start value, same time points.
    6 simulation seconds = 1 year."""
    i = _index(lines, "Incomeactual ")
    match = re.search(r"PWL\(([^)]*)\)", lines[i])
    numbers = match[1].split()
    t, v0 = [float(x) for x in numbers[0::2]], float(numbers[1])
    numbers[1::2] = [f"{v0 * (1 + growth_pct / 100) ** (x / 6):.6g}" for x in t]
    lines[i] = lines[i][:match.start(1)] + " ".join(numbers) + lines[i][match.end(1):]


def shift_pwl(lines: list[str], prefix: str, shift_s: float) -> None:
    """Move a PWL source in time by shift_s simulation seconds (6 s = 1 year), keeping its values.
    Later (shift > 0): the first value holds until the shifted first point. Earlier: points before 0 are dropped
    and the value at 0 is interpolated."""
    if shift_s == 0:
        return
    i = _index(lines, prefix)
    match = re.search(r"PWL\(([^)]*)\)", lines[i])
    n = [float(x) for x in match[1].split()]
    t, v = [x + shift_s for x in n[0::2]], n[1::2]
    if t[0] < 0:
        keep = [k for k in range(len(t)) if t[k] > 0]
        v0 = float(np.interp(0.0, t, v)) if keep else v[-1]
        t, v = [0.0] + [t[k] for k in keep], [v0] + [v[k] for k in keep]
    body = " ".join(f"{a:.6g} {b:.6g}" for a, b in zip(t, v))
    lines[i] = lines[i][:match.start(1)] + body + lines[i][match.end(1):]


def set_interest_blend(lines: list[str], new_share: float, netlist_share: float = 0.1) -> None:
    """Re-blend the interest-rate path. The netlist path is an effective rate on outstanding mortgages built point by
    point as r[k] = (1 - a) r[k-1] + a * new[k] with a = 0.1 (Jesse's construction). Inverting that gives the rate on
    new loans, new[k]; rebuilding with a = new_share lets new rates pass through faster (a = 1: only the new rate)."""
    if abs(new_share - netlist_share) < 1e-9:
        return
    i = _index(lines, "Interest_Rates ")
    match = re.search(r"PWL\(([^)]*)\)", lines[i])
    n = [float(x) for x in match[1].split()]
    t, v = n[0::2], n[1::2]
    new = [v[0]] + [(v[k] - (1 - netlist_share) * v[k - 1]) / netlist_share for k in range(1, len(v))]
    r = [v[0]]
    for k in range(1, len(v)):
        r.append((1 - new_share) * r[-1] + new_share * new[k])
    body = " ".join(f"{a:.6g} {max(b, 0.0):.6g}" for a, b in zip(t, r))
    lines[i] = lines[i][:match.start(1)] + body + lines[i][match.end(1):]


COVID_PULSE = "PULSE(00 80 150 0 50 15 2000)"   # V1 V2 delay rise fall on period, simulation seconds


def set_covid_timing(lines: list[str], on_s: float, fall_s: float) -> None:
    """Change how long the Covid shock stays fully on and how long it takes to fade (simulation seconds).
    Netlist: on 15 s (2.5 years), fade 50 s (8.3 years). Its amplitude is set separately by the covid scale."""
    if on_s == 15 and fall_s == 50:
        return
    i = _index(lines, "V§Shock_covid ")
    lines[i] = _sub_exact(lines[i], COVID_PULSE, f"PULSE(00 80 150 0 {fall_s:.6g} {on_s:.6g} 2000)")


CRISIS_PULSE = "PULSE(00 -50 90 10 20 35 200)"   # V1 V2 delay rise fall on period, simulation seconds


def set_crisis_start(lines: list[str], delay_s: float) -> None:
    """Move the start of the financial crisis shock (netlist: 90 s, which is 2011.46). Amplitude is scaled separately."""
    if abs(delay_s - 90) < 1e-9:
        return
    i = _index(lines, "V§Shock_financialcrisis ")
    lines[i] = _sub_exact(lines[i], CRISIS_PULSE, f"PULSE(00 -50 {delay_s:.6g} 10 20 35 200)")


def _trapezoid(t: float, delay: float, amp: float, rise: float, fall: float, on: float) -> float:
    """Value of one PULSE(0 amp delay rise fall on) period at time t."""
    a, b, c, d = delay, delay + rise, delay + rise + on, delay + rise + on + fall
    if t <= a or t >= d:
        return 0.0
    if t < b:
        return amp * (t - a) / rise
    if t <= c:
        return amp
    return amp * (d - t) / fall


def set_crisis_pwl(lines: list[str], pulses: list[tuple[float, float, float, float, float]]) -> None:
    """Financial crisis as the sum of several trapezoids (delay, amp, rise, fall, on), all in simulation
    seconds, written as one PWL on the same source (same element, same nodes). Used for the W-shaped crisis."""
    corners = {0.0}
    for delay, _, rise, fall, on in pulses:
        corners |= {delay, delay + rise, delay + rise + on, delay + rise + on + fall}
    pts = " ".join(f"{t:.6g} {sum(_trapezoid(t, *p) for p in pulses):.6g}" for t in sorted(corners))
    i = _index(lines, "V§Shock_financialcrisis ")
    lines[i] = _sub_exact(lines[i], CRISIS_PULSE, f"PWL({pts})")


LOANS_PULSE = "PULSE(30 10 70 0 10 30 10000)"  # lending to firms: 30, down to 10 from 70 s (LTspice: zero rise = 10% of on = 3 s)


def add_pwl_pulses(lines: list[str], prefix: str, pulses: list[tuple[float, float, float, float, float]]) -> None:
    """Add trapezoids (delay, amp, rise, fall, on), in simulation seconds, to a PWL source: the corners of the path
    and of the trapezoids are kept and the values summed (the path held at its ends, as SPICE does)."""
    i = _index(lines, prefix)
    match = re.search(r"PWL\(([^)]*)\)", lines[i])
    n = [float(x) for x in match[1].split()]
    t0, v0 = n[0::2], n[1::2]
    corners = set(t0)
    for delay, _, rise, fall, on in pulses:
        corners |= {delay, delay + rise, delay + rise + on, delay + rise + on + fall}
    pts = " ".join(f"{t:.6g} {float(np.interp(t, t0, v0)) + sum(_trapezoid(t, *p) for p in pulses):.6g}" for t in sorted(corners))
    lines[i] = lines[i][:match.start(1)] + pts + lines[i][match.end(1):]


def hold_pwl(lines: list[str], prefix: str) -> None:
    """Hold a PWL source at its first value for the whole run."""
    i = _index(lines, prefix)
    match = re.search(r"PWL\(([^)]*)\)", lines[i])
    v = match[1].split()[1]
    lines[i] = lines[i][:match.start(1)] + f"0 {v} 1 {v}" + lines[i][match.end(1):]


def set_loans_pwl(lines: list[str], pulses: list[tuple[float, float, float, float, float]], base: float = 30.0) -> None:
    """Lending shock (I8) as base plus the sum of trapezoids (delay, amp, rise, fall, on) in simulation seconds,
    written as one PWL on the same source. Used for the W-shaped crisis on the lending side."""
    corners = {0.0}
    for delay, _, rise, fall, on in pulses:
        corners |= {delay, delay + rise, delay + rise + on, delay + rise + on + fall}
    pts = " ".join(f"{t:.6g} {base + sum(_trapezoid(t, *q) for q in pulses):.6g}" for t in sorted(corners))
    i = _index(lines, "I8 0 N008 ")
    lines[i] = _sub_exact(lines[i], LOANS_PULSE, f"PWL({pts})")


def scale_elements(lines: list[str], scale: dict[str, float]) -> None:
    """Multiply the value of R, L and C elements by name, e.g. {"C2": 1.3} (model parameters for the
    system-identification design). Keeps any Rser=... after the value."""
    for name, factor in scale.items():
        if factor == 1:
            continue
        if name[:1] not in "RLC":
            raise ValueError(f"only R, L and C values can be scaled, not {name}")
        i = _index(lines, name + " ")
        tok = lines[i].split()
        tok[3] = f"{float(tok[3]) * factor:.6g}"
        lines[i] = " ".join(tok)
