"""FastAPI backend: simulation runs, saved scenarios, static front end."""
from __future__ import annotations
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sqlite3
import threading
import uuid
from fastapi import FastAPI, HTTPException
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, field_validator
from functools import lru_cache
import math
from typing import Literal
from .topology import model_map
from . import analysis
from .scenario import MODEL_VERSION, PRESETS, SECONDS_PER_YEAR, TRAN_START, YEAR_AT_RAW_ZERO, Scenario, run

ROOT = Path(__file__).resolve().parents[2]
DIST = ROOT / "frontend" / "dist"
SLOTS = threading.BoundedSemaphore(4)


class SaveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    scenario: Scenario
    result: dict | None = Field(None)


class Store:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        with self._db() as db:
            db.execute("create table if not exists scenarios (id text primary key, name text, created_at text, scenario text, result text)")

    def _db(self):
        return sqlite3.connect(self.path)

    def save(self, name: str, scenario: dict, result: dict | None) -> dict:
        row = {"id": uuid.uuid4().hex, "name": name, "created_at": datetime.now(timezone.utc).isoformat()}
        with self._db() as db:
            db.execute("insert into scenarios values (?,?,?,?,?)", (row["id"], name, row["created_at"], json.dumps(scenario), json.dumps(result) if result else None))
        return row

    def list(self) -> list[dict]:
        with self._db() as db:
            rows = db.execute("select id,name,created_at,scenario,result is not null from scenarios order by created_at desc").fetchall()
        return [{"id": r[0], "name": r[1], "created_at": r[2], "feedback": json.loads(r[3])["feedback"], "has_result": bool(r[4])} for r in rows]

    def get(self, id: str) -> dict | None:
        with self._db() as db:
            r = db.execute("select id,name,created_at,scenario,result from scenarios where id=?", (id,)).fetchone()
        return r and {"id": r[0], "name": r[1], "created_at": r[2], "scenario": json.loads(r[3]), "result": json.loads(r[4]) if r[4] else None}


class Gains(BaseModel):
    model_config = ConfigDict(extra="forbid")
    K: list[float] = Field(min_length=3, max_length=3)
    filtered: bool = True

    def gains(self):
        if not all(0 <= k <= 60 for k in self.K):
            raise HTTPException(422, "Gains must lie between 0 and 60.")
        return self.K


class EvaluateRequest(Gains):
    settling_yr: float = Field(4.0, ge=0.5, le=30)
    overshoot_pct: float = Field(25.0, ge=1, le=90)
    min_cycle_yr: float | None = Field(None, ge=0.2, le=30)  # shortest allowed cycle; None: no limit


class Pick(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["flow", "signal", "element", "effort"]
    id: str = Field(max_length=80)


def _check_scale(scale: dict[str, float]) -> dict[str, float]:
    for name, f in scale.items():
        if name == "NO_BANK":
            continue  # the original CPB model without the bank (analysis.NO_BANK)
        if name[:1] not in "RLC" or not (0.05 <= f <= 20):
            raise HTTPException(422, f"Model parameter {name} x{f}: only R, L, C values, factor 0.05-20.")
    return scale


class TransferRequest(Gains):
    input: Pick
    output: Pick
    feedback: bool = False
    scale: dict[str, float] = Field(default_factory=dict, max_length=60)


class IdentifyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    scale: dict[str, float] = Field(default_factory=dict, max_length=60)


class PolePathRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    start: dict[str, float] = Field(default_factory=dict, max_length=60)
    end: dict[str, float] = Field(default_factory=dict, max_length=60)


class DesignParamsRequest(IdentifyRequest):
    adjust_yr: float = Field(ge=0.3, le=40)
    cycle_yr: float | None = Field(None, ge=0.5, le=40)
    elements: list[str] = Field(min_length=1, max_length=12)
    lo: float = Field(0.2, ge=0.05, le=1)
    hi: float = Field(5.0, ge=1, le=20)


class StepsRequest(Gains):
    input: Pick
    outputs: list[Pick] = Field(max_length=20)
    feedback: bool = True
    scale: dict[str, float] = Field(default_factory=dict, max_length=60)


class FitCpbRequest(BaseModel):
    scenario: Scenario
    cpb_scale: float = Field(1.0, gt=0, le=3)


class FitRequest(BaseModel):
    scenario: Scenario
    inflation_pct: float | None = Field(None, ge=0, le=5)  # None: solved as the mean gap


class MonteCarloRequest(Gains):
    perturb: float = Field(0.2, ge=0.0, le=0.6)
    n: int = Field(100, ge=10, le=300)


class TuneRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    settling_yr: float = Field(4.0, ge=0.5, le=30)
    overshoot_pct: float = Field(25.0, ge=1, le=90)
    with_S: bool = False
    filtered: bool = True
    min_cycle_yr: float | None = Field(None, ge=0.2, le=30)


# Bank controls (experimental, 20 Nov 2026): the ALM desk as controller of a separate bank + housing netlist
# (housing/bank_netlist.py). Only the model choices in bank_netlist.RANGES can be changed, clamped to their ranges.
class BankRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    overrides: dict[str, float] = Field(default_factory=dict)
    alm_on: bool = True
    housing_feedback: bool = True
    full: bool = False  # also the run in the housing-run format, for the model canvas

    @field_validator("overrides")
    @classmethod
    def _whitelist(cls, v: dict[str, float]) -> dict[str, float]:
        from .bank_netlist import clamp
        return clamp(v)


def bank_run(r: BankRequest) -> dict:
    from .bank_netlist import cached
    return cached(tuple(sorted(r.overrides.items())), r.alm_on, r.housing_feedback, r.full)


def _warm_bank():  # the three default scenarios A, B, C (about 1 s together)
    from .bank_netlist import cached
    for alm, fb in ((False, True), (True, False), (True, True)):
        try:
            cached((), alm, fb, alm and fb)
        except Exception:  # a failed warm-up must not stop the server; the request will show the error
            pass

def create_app(database: Path | None = None) -> FastAPI:
    app = FastAPI(title="Housing policy lab", version=MODEL_VERSION)
    app.add_middleware(GZipMiddleware, minimum_size=2000)
    threading.Thread(target=_warm_bank, daemon=True).start()
    store = Store(database or Path(os.environ.get("HOUSING_DB", ROOT / "data" / "housing.sqlite3")))

    @app.get("/api/catalogue")
    def catalogue():
        return {"defaults": Scenario().model_dump(), "presets": PRESETS, "schema": Scenario.model_json_schema(),
                "model_version": MODEL_VERSION, "time": {"seconds_per_year": SECONDS_PER_YEAR, "tran_start": TRAN_START, "year_at_raw_zero": YEAR_AT_RAW_ZERO}}

    @app.post("/api/fit")
    def fit_inputs(r: FitRequest):
        from . import fit
        return fit.fit(r.scenario, r.inflation_pct)

    @app.get("/api/data/cpb")
    def data_cpb():
        from . import cbs
        return cbs.cpb()

    @app.post("/api/fit_cpb")
    def fit_to_cpb(r: FitCpbRequest):
        from . import fit
        return fit.fit_cpb(r.scenario, r.cpb_scale)

    @app.get("/api/data/cbs")
    def data_cbs():
        from . import cbs
        return cbs.overlay()

    @app.get("/api/model/map")
    def map_of_model():
        return model_map()

    @app.post("/api/runs")
    def create_run(scenario: Scenario):  # FastAPI runs this in its thread pool
        with SLOTS:
            try:
                return run(scenario)
            except (RuntimeError, ValueError, OSError) as error:
                raise HTTPException(422, f"Simulation failed: {error}") from error

    @app.get("/api/analysis/overview")
    def analysis_overview():
        return analysis.overview()

    @app.post("/api/analysis/evaluate")
    def analysis_evaluate(r: EvaluateRequest):
        return analysis.evaluate(r.gains(), r.filtered, r.settling_yr, r.overshoot_pct, r.min_cycle_yr)

    @app.post("/api/analysis/nyquist")
    def analysis_nyquist(r: Gains):
        return analysis.nyquist(r.gains(), r.filtered)

    @app.post("/api/analysis/transfer")
    def analysis_transfer(r: TransferRequest):
        try:
            return analysis.transfer(r.input.model_dump(), r.output.model_dump(), r.feedback, r.gains(), r.filtered, _check_scale(r.scale))
        except (ValueError, KeyError, StopIteration) as error:
            raise HTTPException(422, str(error) or "This pair cannot be analysed.") from error

    @app.post("/api/analysis/steps")
    def analysis_steps(r: StepsRequest):
        try:
            return analysis.steps(r.input.model_dump(), [o.model_dump() for o in r.outputs], r.feedback, r.gains(), r.filtered, scale=_check_scale(r.scale))
        except (ValueError, KeyError, StopIteration) as error:
            raise HTTPException(422, str(error) or "This input cannot be used.") from error

    @app.post("/api/analysis/identify")
    def analysis_identify(r: IdentifyRequest):
        """Open loop, subsidy -> house price: poles, step response, adjustment time, cycle (system identification)."""
        return analysis.identify(_check_scale(r.scale))

    @app.post("/api/analysis/pole_path")
    def analysis_pole_path(r: PolePathRequest):
        return {"path": analysis.pole_path(_check_scale(r.start), _check_scale(r.end))}

    @app.post("/api/analysis/sensitivity")
    def analysis_sensitivity(r: IdentifyRequest):
        return {"rows": analysis.sensitivity(_check_scale(r.scale))}

    @app.post("/api/analysis/design_params")
    def analysis_design_params(r: DesignParamsRequest):
        try:
            return analysis.design_params(r.adjust_yr, r.cycle_yr, r.elements, _check_scale(r.scale), r.lo, r.hi)
        except ValueError as error:
            raise HTTPException(422, str(error)) from error

    @app.post("/api/analysis/montecarlo")
    def analysis_montecarlo(r: MonteCarloRequest):
        return analysis.monte_carlo(r.gains(), r.filtered, r.perturb, r.n)

    @app.post("/api/analysis/tune")
    def analysis_tune(r: TuneRequest):
        K, violation = analysis.tune(r.settling_yr, r.overshoot_pct, r.with_S, r.filtered, r.min_cycle_yr)
        return {"K": K, "violation": violation, "met": violation <= 0}

    @app.post("/api/bank/simulate")
    def bank_simulate(r: BankRequest):
        with SLOTS:
            return bank_run(r)

    @app.post("/api/scenarios", status_code=201)
    def save(request: SaveRequest):
        return store.save(request.scenario.name, request.scenario.model_dump(), request.result)

    @app.get("/api/scenarios")
    def scenarios():
        return store.list()

    @app.get("/api/scenarios/{id}")
    def scenario(id: str):
        found = store.get(id)
        if not found:
            raise HTTPException(404, "Scenario not found")
        return found

    if (DIST / "assets").exists():
        app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/")
    def index():
        if not (DIST / "index.html").exists():
            raise HTTPException(503, "Front end not built. Run npm run build in frontend/.")
        return FileResponse(DIST / "index.html")

    return app
