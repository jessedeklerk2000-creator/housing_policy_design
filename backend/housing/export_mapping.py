"""Element display names and the formula-symbol mapping for thesis figures (handoff FIGURE_LABELS_NAMING, 25 Nov 2026).

The tables live in frontend/src/data (element_names.json, figure_terms.json) and are shared with the frontend, so the
web page and this script give the same names. They are a display layer only: the netlist ids are unchanged.
Both tables are Claude's reading of the netlist, for Jesse to check.

    python -m housing.export_mapping [outdir]      writes figure_mapping.csv, figure_mapping.tex,
                                                   docs/element_names.md and docs/storage_elements.md
"""
from __future__ import annotations

import csv
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "frontend" / "src" / "data"


def names() -> dict:
    return json.loads((DATA / "element_names.json").read_text(encoding="utf-8"))


def terms() -> list:
    return json.loads((DATA / "figure_terms.json").read_text(encoding="utf-8"))


def plain(eid: str, n: dict | None = None) -> str:
    n = n or names()
    e = n.get(eid)
    return f"{e['letter']} {e['sub']}" if e else eid


def rows() -> list[dict]:
    n = names()
    out = [{"agent": (n.get(t["element"]) or {}).get("agent") or "", "netlist_id": t["element"], "element": plain(t["element"], n),
            "symbol": t["symbol"], "meaning": t["meaning"], "equation": f"{f['title']} ({f['no']})"} for f in terms() for t in f["terms"]]
    return sorted(out, key=lambda r: r["agent"])


def _esc(s: str) -> str:
    return "".join("\\" + c if c in "&%#_" else c for c in s)


def tex_table() -> str:
    n, rs = names(), rows()
    blocks = []
    for agent in dict.fromkeys(r["agent"] for r in rs):
        lines = [f"\\multicolumn{{4}}{{l}}{{\\textit{{{agent.capitalize()}}}}}\\\\"]
        for r in (r for r in rs if r["agent"] == agent):
            e = n.get(r["netlist_id"])
            name = f"${e['letter']}_{{\\text{{{_esc(e['sub'])}}}}}$" if e else _esc(r["netlist_id"])
            lines.append(f"{name} & {('$' + r['symbol'] + '$') if r['symbol'] else '--'} & {_esc(r['meaning'])} & {_esc(r['equation'])}\\\\")
        blocks.append("\n".join(lines))
    return "\\begin{tabular}{llll}\n\\toprule\nElement & Symbol & Meaning & Equation\\\\\n\\midrule\n" + "\n\\midrule\n".join(blocks) + "\n\\bottomrule\n\\end{tabular}\n"


def names_md() -> str:
    n = names()
    out = ["# Element names (display layer)", "", "Netlist ids are unchanged; these names are shown on the canvas, in menus and in figures.",
           "Scheme: SPICE type letter + short English subscript. Claude's reading of the netlist (25 Nov 2026), **check: Jesse**.", "",
           "| Agent | Netlist id | New name | Type | Value | Meaning |", "|---|---|---|---|---|---|"]
    for eid, e in sorted(n.items(), key=lambda kv: (kv[1]["agent"] or "~", kv[0])):
        out.append(f"| {e['agent'] or '(not drawn)'} | `{eid}` | {e['letter']}<sub>{e['sub']}</sub> | {e['type']} | `{str(e['value'])[:40]}` | {e['meaning']} |")
    return "\n".join(out) + "\n"


def storage_md() -> str:
    """Every inductor and capacitor, with its term in the CPB equations (if any) and a suggested role (Claude's)."""
    n, used = names(), {t["element"]: f"{f['title']} ({f['no']}): {t['symbol'] or t['meaning']}" for f in terms() for t in f["terms"]}
    out = ["# Storage elements (L and C)", "",
           "One row per inductor and capacitor. **Role** is Claude's first reading, for Jesse to decide: `CPB dynamics` (needed to reproduce a CPB",
           "adjustment), `friction` (added on top of the CPB model), `numerical` (only there so SPICE solves, e.g. 1 H with Rser=1u between sources).",
           "Nothing in the model is changed by this list.", "",
           "| Agent | Netlist id | Name | Value | Equation / term | Role (suggested) |", "|---|---|---|---|---|---|"]
    for eid, e in sorted(n.items(), key=lambda kv: (kv[1]["agent"] or "~", kv[0])):
        if e["type"] not in ("ind", "ind2", "cap"):
            continue
        v = str(e["value"])
        role = "numerical?" if "Rser=1u" in v or e["agent"] is None else "friction?" if e["type"] == "cap" else "to decide"
        out.append(f"| {e['agent'] or '(not drawn)'} | `{eid}` | {e['letter']}<sub>{e['sub']}</sub> | `{v}` | {used.get(eid, '')} | {role} |")
    return "\n".join(out) + "\n"


def main(outdir: str = ".") -> None:
    d = Path(outdir)
    d.mkdir(parents=True, exist_ok=True)
    with (d / "figure_mapping.csv").open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=["agent", "netlist_id", "element", "symbol", "meaning", "equation"])
        w.writeheader()
        w.writerows(rows())
    (d / "figure_mapping.tex").write_text(tex_table(), encoding="utf-8")
    (ROOT / "docs").mkdir(exist_ok=True)
    (ROOT / "docs" / "element_names.md").write_text(names_md(), encoding="utf-8")
    (ROOT / "docs" / "storage_elements.md").write_text(storage_md(), encoding="utf-8")
    print(f"wrote {d / 'figure_mapping.csv'}, {d / 'figure_mapping.tex'}, docs/element_names.md, docs/storage_elements.md")


if __name__ == "__main__":
    main(*sys.argv[1:2])
