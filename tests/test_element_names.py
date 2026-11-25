"""Display-name layer (handoff FIGURE_LABELS_NAMING): every netlist element has a unique display name, and every element
named in a formula's terms exists in the netlist. Names are display-only; the solver keeps the netlist ids."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from housing.export_mapping import names, terms
from housing.topology import model_map


def test_every_netlist_element_has_a_unique_display_name():
    ids = {e["name"] for e in model_map()["elements"]}
    n = names()
    assert ids - set(n) == set(), f"no display name for {sorted(ids - set(n))}"
    full = [f"{v['letter']}_{v['sub']}" for v in n.values()]
    assert len(full) == len(set(full)), "display names must be unique"
    assert all(len(v["sub"]) <= 10 for v in n.values())


def test_formula_terms_refer_to_netlist_elements():
    ids = {e["name"] for e in model_map()["elements"]}
    missing = [t["element"] for f in terms() for t in f["terms"] if t["element"] not in ids]
    assert not missing, missing
