"""Website copy of Thesis/sot_multiport/sot.py (26 Nov 2026), plus report() for the bank view.

Supervisory Outlier Test (SOT) for IRRBB with behaviour from the multiport bank-housing model (prototype, 26 Nov 2026).

Rules: Commission Delegated Regulation (EU) 2024/856 (RTS on SOTs). Six EVE scenarios (Art. 1-2, Annex Part A sizes),
post-shock floor (Art. 3(7)), run-off balance sheet (Art. 3(6)), CET1 excluded (Art. 3(3)), behaviour that changes with
the scenario (Art. 3(2)(c)), risk-free discounting (Art. 3(9)). NII test (Art. 4-5): one year, constant balance sheet,
parallel up and down. Outlier flags: dEVE/Tier 1 < -15%, dNII/Tier 1 < -5%.

Behaviour (what the RTS leaves to the bank) comes from the multiport model (Jesse's thesis):
  - prepayment = movers (theta, lower when underwater; house price from the CPB housing plant) + refinancing;
  - non-maturity deposits = an RC pair: client rate follows the market with a lag, volume leaves when the market pays more.
Time in years, monthly steps, 50-year horizon. Amounts in EUR bn, illustrative only (no bank is modelled).
All parameter values are the handoff's (SOT_MULTIPORT_HANDOFF.md, 26 Nov 2026) unless marked "Claude's choice".
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field, replace
from pathlib import Path

import numpy as np
from scipy import signal
from scipy.stats import norm

HERE = Path(__file__).resolve().parent
# the thesis copy (../website_handoff) or the website's copy next to this module (backend/housing)
PLANT_JSON = next((q for q in (HERE / "sot_plant_tf_years.json", HERE.parent / "website_handoff" / "plant_tf_years.json") if q.exists()), HERE / "sot_plant_tf_years.json")

DT = 1 / 12            # monthly steps
T_END = 50.0           # horizon of the EVE cash flows (years)
T_GRID = 62.0          # forwards are needed 10 years past the horizon (r_mm is a 10-year forward average)

SCENARIOS = ["parallel_up", "parallel_down", "steepener", "flattener", "short_up", "short_down"]
# EUR shock sizes (R_par, R_short, R_long) in decimals
SIZES = {
    "EU RTS 2024/856": (0.0200, 0.0250, 0.0100),      # Annex, Part A (EUR)
    "BCBS d578 (2024)": (0.0225, 0.0350, 0.0200),     # recalibration, applies from 1 Jan 2026 (EUR); not in EU law yet
}


# ---------------------------------------------------------------------------------------------------------- curve
def z_base(t: np.ndarray) -> np.ndarray:
    """Base zero curve (continuous compounding): 2.2% + 0.8% (1 - e^(-t/5))."""
    return 0.022 + 0.008 * (1 - np.exp(-np.asarray(t, float) / 5))


def shock(name: str, t: np.ndarray, sizes: tuple[float, float, float]) -> np.ndarray:
    """Zero-rate shock dR(t), RTS 2024/856 Art. 2 (t = maturity in years)."""
    par, sh, lo = sizes
    t = np.asarray(t, float)
    S, L = sh * np.exp(-t / 4), lo * (1 - np.exp(-t / 4))
    return {
        "none": 0 * t,
        "parallel_up": par + 0 * t, "parallel_down": -par + 0 * t,
        "short_up": S, "short_down": -S,
        "steepener": -0.65 * np.abs(S) + 0.9 * np.abs(L),
        "flattener": 0.8 * np.abs(S) - 0.6 * np.abs(L),
    }[name]


def floor(t: np.ndarray) -> np.ndarray:
    """Post-shock floor, Art. 3(7): -150 bp at maturity 0, +3 bp per year, 0% from 50 years."""
    return np.minimum(-0.015 + 0.0003 * np.asarray(t, float), 0.0)


def shocked(z0: np.ndarray, dR: np.ndarray, t: np.ndarray) -> np.ndarray:
    """Shocked zero curve with the floor; where the observed rate is already below the floor, the observed rate stays."""
    return np.maximum(z0 + dR, np.minimum(floor(t), z0))


def forward(z: np.ndarray, t: np.ndarray) -> np.ndarray:
    """Instantaneous forward f(t) = d(z t)/dt."""
    return np.gradient(z * t, t)


# ---------------------------------------------------------------------------------------------------------- plant
@dataclass
class Plant:
    sys: signal.lti
    G0: float

    @classmethod
    def load(cls, path: Path = PLANT_JSON) -> "Plant":
        d = json.loads(Path(path).read_text())
        return cls(signal.lti(d["num"], d["den"]), d["num"][-1] / d["den"][-1])

    def response(self, u: np.ndarray, t: np.ndarray) -> np.ndarray:
        """Output for input u(t) (pp), normalised so that a 1 pp step settles at 1."""
        if not np.any(u):
            return 0 * u
        _, y, _ = signal.lsim(self.sys, u, t)
        return y / self.G0


# ---------------------------------------------------------------------------------------------------------- bank
@dataclass
class Bank:
    """Bank A (Dutch retail style, close to bank_housing.py). EUR bn."""
    mortgages: float = 200.0
    mort_rate: float = 0.036          # contract rate
    mort_term: float = 30.0           # annuity term (all loans taken as new: Claude's choice)
    mort_fix_max: float = 10.0        # fixed periods spread evenly over 0-10 years; principal returns at reset
    firm_loans: float = 80.0
    firm_reprice: float = 0.25        # floating, repricing every 3 months
    firm_margin: float = 0.015        # Claude's choice
    savings: float = 220.0
    wholesale: float = 60.0
    wholesale_rate: float = 0.030
    wholesale_T: float = 5.0          # bullet
    tier1: float = 17.0
    # ---- behaviour (multiport)
    theta0: float | None = None       # movers per year; None: calibrated to the base CPR target
    cpr_target: float = 0.06
    uw_mobility: float = 0.22         # Van Veldhuizen et al., ESB 2017 (as bank_housing.py)
    sigma_ltv: float = 0.45
    ltv0: float = 0.725               # book LTV at the start: bank_housing.py equilibrium (M0/V0)
    refi_max: float = 0.08
    refi_width: float = 0.004
    mort_margin_new: float = 0.012    # r_mm = 10-year forward average + 1.2%
    price_per_pp: float = 0.08        # house price per pp mortgage rate (bank_housing.py; CHECK vs CPB)
    housing: bool = True
    # deposits: client rate lag and volume
    r_s0: float = 0.015               # client rate at the start (bank_housing.py: ftp0 - s0/2): Claude's reading
    beta: float = 0.5                 # pass-through
    tau_beta: float = 1.0             # years
    runoff: float = 0.25              # 1/4 per year: average life 4 years
    kappa: float = 5.0                # 5% of volume per pp per year (= eta_dep), here per unit rate
    # dynamics switch (tests): fixed CPR, instant pass-through, no deposit chasing, no housing link
    dynamic: bool = True

    @property
    def cash(self) -> float:
        return self.savings + self.wholesale + self.tier1 - self.mortgages - self.firm_loans


@dataclass
class ScenarioPath:
    """Behaviour and cash flows of one scenario."""
    t: np.ndarray
    f: np.ndarray
    df: np.ndarray
    r_mm: np.ndarray
    P: np.ndarray
    uw: np.ndarray
    cpr: np.ndarray
    D: np.ndarray
    r_s: np.ndarray
    moves: np.ndarray | None = None       # CPR split: movers (theta) and refinancing, % a year as decimals
    refi: np.ndarray | None = None
    book: np.ndarray | None = None        # mortgage book over time (run-off)
    cf: dict = field(default_factory=dict)
    pv: dict = field(default_factory=dict)


def sigmoid(x):
    return 1 / (1 + np.exp(-x))


def calibrate_theta(b: Bank, r_mm0: float) -> float:
    """theta0 so that the base CPR at t = 0 is cpr_target."""
    uw0 = norm.cdf((np.log(b.ltv0) - b.sigma_ltv ** 2 / 2) / b.sigma_ltv)
    refi0 = b.refi_max * sigmoid((b.mort_rate - r_mm0) / b.refi_width)
    return (b.cpr_target - refi0) / (1 - b.uw_mobility * uw0)


class Engine:
    def __init__(self, bank: Bank = Bank(), plant: Plant | None = None, z0_fn=z_base):
        self.b = bank
        self.plant = plant or Plant.load()
        self.tg = np.arange(0, T_GRID + 1e-9, DT)          # grid incl. t = 0
        self.z0 = z0_fn(np.maximum(self.tg, 1e-9))
        self.f0 = forward(self.z0, self.tg)
        self.r_mm0 = self._r_mm(self.f0)
        th = calibrate_theta(bank, self.r_mm0[0])
        self.theta0 = bank.theta0 if bank.theta0 is not None else th

    # 10-year forward average + margin, at each t
    def _r_mm(self, f):
        n = int(round(10 / DT)); c = np.r_[0, np.cumsum(f * DT)]
        k = np.arange(f.size); hi = np.minimum(k + n, f.size)
        return (c[hi] - c[k]) / ((hi - k) * DT) + self.b.mort_margin_new

    def curve(self, scen: str, sizes) -> np.ndarray:
        t = np.maximum(self.tg, 1e-9)
        return shocked(self.z0, shock(scen, t, sizes), t)

    def behaviour(self, z: np.ndarray) -> ScenarioPath:
        b, tg = self.b, self.tg
        f = forward(z, tg)
        df = np.exp(-z * tg)
        dfw = f - self.f0
        r_mm = self._r_mm(f)
        n = int(round(T_END / DT)) + 1
        # house price: input u = -d r_mm (pp); plant normalised to 1 per pp in the long run
        if b.dynamic and b.housing:
            P = 1 + b.price_per_pp * self.plant.response(-(r_mm[:n] - self.r_mm0[:n]) * 100, tg[:n])
        else:
            P = np.ones(n)
        uw = norm.cdf((np.log(b.ltv0 / P) - b.sigma_ltv ** 2 / 2) / b.sigma_ltv)
        if b.dynamic:
            moves = self.theta0 * (1 - b.uw_mobility * uw); refi = b.refi_max * sigmoid((b.mort_rate - r_mm[:n]) / b.refi_width)
        else:
            moves = np.full(n, b.cpr_target); refi = np.zeros(n)
        cpr = moves + refi
        # deposits: RC pair (client-rate lag tau_beta, volume chasing the market against the base path)
        r_s, D = np.empty(n), np.empty(n)
        r_s[0], D[0] = b.r_s0 + (0 if b.dynamic else b.beta * dfw[0]), b.savings
        for k in range(n - 1):
            target = b.r_s0 + b.beta * dfw[k]
            if b.dynamic and b.tau_beta > 0:
                r_s[k + 1] = r_s[k] + DT * (target - r_s[k]) / b.tau_beta
            else:
                r_s[k + 1] = b.r_s0 + b.beta * dfw[k + 1]
            chase = b.kappa * (dfw[k] - (r_s[k] - b.r_s0)) if b.dynamic else 0.0
            D[k + 1] = D[k] * np.exp(-DT * (b.runoff + chase))
        return ScenarioPath(t=tg[:n], f=f[:n], df=df[:n], r_mm=r_mm[:n], P=P, uw=uw, cpr=cpr, D=D, r_s=r_s, moves=moves, refi=refi)

    # ------------------------------------------------------------------------------------------- run-off cash flows
    def cashflows(self, p: ScenarioPath, margins: bool) -> ScenarioPath:
        """Monthly cash flows at t_k = k DT (k = 1..N), run-off balance sheet (Art. 3(6))."""
        b, N = self.b, p.t.size - 1
        tk = p.t[1:]
        # mortgages: identical cohorts (same age), cohort j resets after j months (j = 1..120)
        nc = int(round(b.mort_fix_max / DT)); per = b.mortgages / nc
        i = b.mort_rate / 12; nT = int(round(b.mort_term * 12))
        ann = i / (1 - (1 + i) ** -nT)                        # payment per unit of original principal per month
        B = np.empty(N + 1); B[0] = 1.0                       # balance of one unit cohort (survivors of prepayment)
        sched, prepay, intr = np.zeros(N), np.zeros(N), np.zeros(N)
        # commercial margin (Art. 3(5)): contract rate over the base zero rate at the average fixed period (5 years)
        margin = b.mort_rate - self.z0[int(round(5 / DT))]
        coupon = b.mort_rate if margins else b.mort_rate - margin
        for k in range(N):
            pay_int = B[k] * i
            prin = min(B[k], ann * (B[k] / max(self._sched_balance(k, i, ann), 1e-12)) - pay_int) if B[k] > 0 else 0.0
            after = B[k] - prin
            q = 1 - np.exp(-p.cpr[k] * DT)
            pp = after * q
            sched[k], prepay[k], intr[k] = prin, pp, B[k] * coupon / 12
            B[k + 1] = after - pp
        alive = np.clip(nc - np.arange(N), 0, nc)              # cohorts still fixed during month k+1
        reset = np.zeros(N); reset[:nc] = B[1:nc + 1]           # cohort j returns its balance at month j
        cf_m = per * (alive * (sched + prepay + intr)) + per * reset
        p.book = per * np.r_[np.clip(nc - np.arange(N), 0, nc) * B[:N], 0.0]   # mortgage book at the start of each month
        # firm loans: floating, value to the next repricing date (3 months): principal + interest at the 3-month rate
        kf = int(round(b.firm_reprice / DT)); cf_f = np.zeros(N)
        z3 = self._z_from_df(p, kf)
        cf_f[kf - 1] = b.firm_loans * (1 + (np.expm1(z3 * b.firm_reprice) + (b.firm_margin * b.firm_reprice if margins else 0)))
        # savings: interest at the client rate (included) or the risk-free equivalent (excluded) + outflow
        rate = p.r_s if margins else p.r_s + (self.f0[:p.t.size] - b.r_s0)
        cf_d = p.D[:-1] * rate[:-1] * DT + (p.D[:-1] - p.D[1:])
        cf_d[-1] += p.D[-1]                                    # what is left at 50 years
        # wholesale: annual coupons, bullet at 5 years
        cf_w = np.zeros(N)
        for y in range(1, int(b.wholesale_T) + 1):
            cf_w[int(round(y / DT)) - 1] += b.wholesale * b.wholesale_rate
        cf_w[int(round(b.wholesale_T / DT)) - 1] += b.wholesale
        p.cf = dict(mortgages=cf_m, firm_loans=cf_f, savings=cf_d, wholesale=cf_w, t=tk)
        d = p.df[1:]
        p.pv = dict(mortgages=float(cf_m @ d), firm_loans=float(cf_f @ d), cash=b.cash, savings=float(cf_d @ d), wholesale=float(cf_w @ d))
        p.pv["eve"] = p.pv["mortgages"] + p.pv["firm_loans"] + p.pv["cash"] - p.pv["savings"] - p.pv["wholesale"]
        return p

    @staticmethod
    def _sched_balance(k, i, ann):
        """Scheduled balance after k months without prepayment (unit loan)."""
        return (1 + i) ** k - ann * ((1 + i) ** k - 1) / i

    @staticmethod
    def _z_from_df(p, k):
        return -np.log(p.df[k]) / p.t[k]

    def eve(self, scen: str, sizes, margins: bool = False) -> ScenarioPath:
        return self.cashflows(self.behaviour(self.curve(scen, sizes)), margins)

    # ----------------------------------------------------------------------------------------------------- NII
    def nii_path(self, scen: str, sizes, years: float = 1.0, parts: bool = False):
        """Monthly NII (EUR bn per month), constant balance sheet (Art. 4-5), margins included, instantaneous shock at t = 0.
        Maturing / prepaid mortgages are replaced at r_mm (fixed from then on), deposit outflows by wholesale at f + 0.5%,
        firm loans reprice quarterly at the 3-month rate + margin, cash earns the overnight rate; the 5-year wholesale bullet
        is replaced at f + 0.5% when it matures."""
        b = self.b
        p = self.behaviour(self.curve(scen, sizes))
        n = int(round(years / DT))
        f, r_mm, cpr = p.f[:n], p.r_mm[:n], p.cpr[:n]
        nc = int(round(b.mort_fix_max / DT))
        old = b.mortgages; new_rate_vol = 0.0; inc_m = np.zeros(n)
        i = b.mort_rate / 12; nT = int(round(b.mort_term * 12)); ann = i / (1 - (1 + i) ** -nT)
        for k in range(n):
            inc_m[k] = (old * b.mort_rate + new_rate_vol) * DT
            prin = old * (ann - i)                          # scheduled principal (young loans: ~ann - i per unit)
            resets = b.mortgages / nc if k < nc else 0.0    # one cohort reprices to par each month
            out = prin + (old - prin) * (1 - np.exp(-cpr[k] * DT)) + min(resets, old)
            out = min(out, old)
            old -= out; new_rate_vol += out * r_mm[k]          # replaced like for like at today's r_mm
        kq = int(round(b.firm_reprice / DT)); q = np.arange(n) // kq * kq
        inc_f = b.firm_loans * (f[q] + b.firm_margin) * DT
        inc_c = b.cash * f * DT
        D, r_s = p.D[:n], p.r_s[:n]
        exp_d = (D * r_s + (b.savings - D) * (f + 0.005)) * DT
        mw = np.arange(n) >= int(round(b.wholesale_T / DT))
        exp_w = b.wholesale * np.where(mw, f + 0.005, b.wholesale_rate) * DT
        if parts:  # by component (EUR bn per month; costs negative)
            return dict(mortgages=inc_m, firm_loans=inc_f, cash=inc_c, savings=-exp_d, wholesale=-exp_w)
        return inc_m + inc_f + inc_c - exp_d - exp_w

    def nii(self, scen: str, sizes) -> float:
        """One-year NII (the official NII test, Art. 4-5)."""
        return float(self.nii_path(scen, sizes, 1.0).sum())

    def eve_path(self, p: ScenarioPath, months: int) -> dict:
        """Value still ahead at t = 0..months (monthly), in today's money: the PV (scenario curve, discounted to 0) of the
        cash flows after t, per component. At t = 0 it is the official PV; it runs to 0 as the book runs off, and what is
        gone has been realised. (The handoff's version, cash received carried at the base rate and the rest discounted on
        the shocked curve, drifts with all behaviour switched off: parallel up -4.5% -> -52% of Tier 1 in 10 years, pure
        bookkeeping. Checked 26 Nov 2026.)"""
        df, out = p.df[: p.t.size], {}
        j = np.arange(months + 1)
        for k, sign in (("mortgages", 1), ("firm_loans", 1), ("savings", -1), ("wholesale", -1)):
            w = p.cf[k] * df[1:]
            tail = np.r_[np.cumsum(w[::-1])[::-1], 0.0]              # sum over the cash flows after t_j
            out[k] = sign * tail[j]
        out["cash"] = np.where(j == 0, self.b.cash, 0.0)              # overnight: realised at once
        out["eve"] = out["mortgages"] + out["firm_loans"] + out["cash"] + out["savings"] + out["wholesale"]
        return out

def run_sot(bank: Bank = Bank(), margins: bool = False) -> dict:
    """dEVE and dNII per scenario and shock-size set, as % of Tier 1, with the outlier flags."""
    eng = Engine(bank)
    base = eng.eve("none", (0, 0, 0), margins)
    out = {"base_eve": base.pv["eve"], "theta0": eng.theta0, "rows": []}
    nii0 = eng.nii("none", (0, 0, 0))
    for sname, sizes in SIZES.items():
        for sc in SCENARIOS:
            p = eng.eve(sc, sizes, margins)
            d_eve = p.pv["eve"] - base.pv["eve"]
            row = dict(sizes=sname, scenario=sc, d_eve=d_eve, d_eve_t1=100 * d_eve / bank.tier1, eve_outlier=100 * d_eve / bank.tier1 < -15)
            if sc in ("parallel_up", "parallel_down"):
                d_nii = eng.nii(sc, sizes) - nii0
                row.update(d_nii=d_nii, d_nii_t1=100 * d_nii / bank.tier1, nii_outlier=100 * d_nii / bank.tier1 < -5)
            out["rows"].append(row)
    out["nii_base"] = nii0
    return out


# ------------------------------------------------------------------------------------------- time profile (section 3b)
def time_profile(bank: Bank = Bank(), margins: bool = False, sizes=None, years: float = 5.0) -> dict:
    """How each scenario plays out over time next to the official SOT number (supplementary, never a replacement).
    dEVE is the one official number at t = 0 (today's value of the whole change). Over time the shock shows where it
    hits: net interest income (constant balance sheet, as the NII test), quarter by quarter, and the behaviour behind it.
    (A dEVE(t) path is not used: any split of dEVE over time mixes risk with the timing of principal; see eve_path.)"""
    sizes = sizes or SIZES["EU RTS 2024/856"]
    eng, eng_off = Engine(bank), Engine(replace(bank, housing=False))
    T1, n = bank.tier1, int(round(years / DT))
    off = run_sot(bank, margins)
    official = {r["scenario"]: r["d_eve_t1"] for r in off["rows"] if r["sizes"] == "EU RTS 2024/856"} if sizes == SIZES["EU RTS 2024/856"] else {}
    nb = eng.nii_path("none", (0, 0, 0), years, parts=True)
    base = eng.eve("none", (0, 0, 0), margins)
    out = {"t": eng.tg[: n + 1], "base": base, "scen": {}}
    for sc in SCENARIOS:
        p = eng.eve(sc, sizes, margins)
        npart = eng.nii_path(sc, sizes, years, parts=True)
        d = {k: npart[k] - nb[k] for k in npart}
        dm = sum(d.values())                                           # dNII per month
        q = 100 * dm.reshape(-1, 3).sum(1) / T1                        # % of Tier 1 per quarter
        cum = 100 * np.cumsum(dm) / T1                                 # cumulative dNII, % of Tier 1
        qw = int(np.argmin(q)); worst = float(q[qw])
        half = None
        if worst < 0:
            rec = np.nonzero(q[qw:] >= worst / 2)[0]
            half = float(rec[0] * 0.25) if rec.size else None
        dq = {k: float(100 * v.reshape(-1, 3).sum(1)[qw] / T1) for k, v in d.items()}
        driver = min(dq, key=dq.get) if worst < 0 else max(dq, key=dq.get)
        out["scen"][sc] = dict(path=p, book_off=eng_off.eve(sc, sizes, margins).book, nii_q=q, nii_cum=cum, nii_1y=float(cum[11]),
                               official=official.get(sc), nii_worst_q=worst, nii_worst_when=float((qw + 1) * 0.25), half_life=half,
                               below5=float(np.sum(cum < -5) * DT), parts_at_worst=dq, driver=driver)
    return out


# ---------------------------------------------------------------------------------------------------- website report
from functools import lru_cache

NAMES = {"parallel_up": "Parallel up", "parallel_down": "Parallel down", "steepener": "Steepener", "flattener": "Flattener",
         "short_up": "Short up", "short_down": "Short down"}


@lru_cache(maxsize=4)
def report(margins: bool = False) -> dict:
    """For the bank view: dEVE and dNII as % of Tier 1 per scenario and size set; with the EU sizes the shocked curves
    (0-30 years) and the behaviour paths (0-15 years) per scenario. Bank A = My Bank's balance sheet x 2, so the
    percentages of Tier 1 are those of My Bank."""
    eng = Engine(Bank())
    res = run_sot(Bank(), margins)
    EU = SIZES["EU RTS 2024/856"]
    m = np.arange(0, 30.01, 0.5); im = np.round(m / DT).astype(int)
    tp = np.arange(0, 15.01, 0.25); ip = np.round(tp / DT).astype(int)
    r4 = lambda a: [round(float(x), 4) for x in a]
    curves, paths = {"base": r4(100 * eng.z0[im])}, {}
    for sc in ["none"] + SCENARIOS:
        if sc != "none":
            curves[sc] = r4(100 * eng.curve(sc, EU)[im])
        p = eng.behaviour(eng.curve(sc, EU))
        paths["base" if sc == "none" else sc] = dict(price=r4(100 * p.P[ip]), cpr=r4(100 * p.cpr[ip]), deposits=r4(p.D[ip] / 2),
                                                     client_rate=r4(100 * p.r_s[ip]), mortgage_rate=r4(100 * p.r_mm[ip]))
    tpr = time_profile(Bank(), margins)
    tq = r4(np.arange(1, 21) * 0.25)
    time = {sc: dict(nii_cum=r4(tpr["scen"][sc]["nii_cum"][2::3]), nii_q=r4(tpr["scen"][sc]["nii_q"]), below5=tpr["scen"][sc]["below5"],
                     worst_q=round(tpr["scen"][sc]["nii_worst_q"], 2), worst_when=tpr["scen"][sc]["nii_worst_when"], driver=tpr["scen"][sc]["driver"]) for sc in SCENARIOS}
    rows = [dict(sizes=r["sizes"], scenario=r["scenario"], name=NAMES[r["scenario"]], d_eve_pct_t1=round(r["d_eve_t1"], 2), eve_outlier=bool(r["eve_outlier"]),
                 **({"d_nii_pct_t1": round(r["d_nii_t1"], 2), "nii_outlier": bool(r["nii_outlier"])} if "d_nii" in r else {})) for r in res["rows"]]
    return dict(margins="included" if margins else "excluded", rows=rows, t_quarters=tq, time=time, maturities=r4(m), curves=curves, t_years=r4(tp), paths=paths,
                sizes={k: [round(100 * x, 2) for x in v] for k, v in SIZES.items()}, theta0=round(res["theta0"], 4),
                rules="Delegated Regulation (EU) 2024/856: run-off balance sheet, CET1 excluded, risk-free discounting, post-shock floor; "
                      "outlier if dEVE < -15% or dNII < -5% of Tier 1. ALM desk off (no management action).")
