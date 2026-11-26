# Questions: bank view, feedback round 2 (26 Nov 2026)

Answer with "1: yes, 2: …". Each line: question · assumption used · where it matters in the code.

1. Tile name: "Bank" (your rename in 141b1bd) or "My Bank" (README 2)? · Kept "Bank". · `BankBusView.tsx` Block label.
2. A2: keep a button when Play no longer jitters? · Kept as "Rebuild layout" (re-measures the boxes, fits the view). · `BankBusView.tsx` Inner tools.
3. A4: "dashed lines" = the dashed org connectors inside the bank? · Yes; they became signal wires from the chiefs. The dashed return conductors of port pairs stay. · `BankBusView.tsx` org section.
4. A5: Accounting & Reporting under Treasury or under the CEO? · Under Treasury. · geometry `fin` frame.
5. A6: control-loop view colours too? · No, bank (bus) view only. · `style.css` bus rules.
6. A8: "the corners must be different" = square corners (radius 2) on frames and boxes? · Yes; wire bends unchanged. · `style.css` `.bus-diagram` radius rules.
7. B1: DNB and the central bank as one block? · One block "DNB / central bank". Note: a large Dutch bank is supervised directly by the ECB (SSM) with DNB in the joint supervisory team. · Financial sector in `BankBusView.tsx`.
8. B2: how should the yield curve move in the scenarios? · Static, parallel shift with r_mkt; mortgage spread re-based so the start mortgage rate is unchanged. · `bank_netlist.py` term premia.
9. B3: competitor as a full second breadboard or a balance-sheet model? · Balance-sheet model in B-sources (stocks, profit, Tier 1, NSFR); one household mortgage flow split by a logit on the rate gap. · `bank_netlist.py` desk rows.
10. B3 parameters (0.3 pp sharper, more wholesale, thinner buffer, 10% share per 0.1 pp) are Max's / the README's, not sourced. · Labelled as such on the page; not tuned. · `BANK_DEFAULTS`.
11. Earlier: should the ALM desk see liquidity (cash or central-bank borrowing) so it raises rates in a run? · Not changed. · `bank_netlist.py` desk.
12. Pushing: ad11711 and the round-2 commits stay local until you say push. · Local only.
13. B1 LCR: with HQLA = cash only (the model bank holds no securities), the simplified LCR starts at about 77% (cash 8.5 ÷ 10% of savings 110), so it shows red against the 100% minimum from the start. Add a securities (HQLA) buffer to the balance sheet, or leave it? · Left as is, with a note on the line. · `bank_ledger.py` lcr.
14. B1 thresholds: sourced from the CRR article texts as I know them (Art. 92(1)(b) and (d), 412(1), 428b(1); Delegated Reg. 2015/61 Art. 4(1)); not re-fetched online today. · Shown. · `bank_ledger.py` THRESHOLDS.
