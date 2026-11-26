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
15. B2 term premia: +0.44 pp (5 yr) and +1.02 pp (10 yr) = average 5y-1y and 10y-1y spread on the ECB euro-area AAA curve, 6 Sep 2004 - 25 Nov 2026 (ECB Data Portal, YC.B.U2.EUR.4F.G_N_A.SV_C_YM; computed by Claude). The curve is shown and the mortgage margin over the 10-yr point is in the Metrics; the netlist's rates are not driven by it. Should the FTP of mortgages be the 10-yr point (a model change)? · Not done. · `bank_netlist.py` tp5/tp10, `bank_ledger.py` margin10.
16. B3 competitor is OFF by default (switch under Other banks in the Scenario panel), so today's one-bank results and the demo stay as they were. Default on instead? · Off. · `BANK_DEFAULTS["competitor"]`.
17. B3 result, reported, not tuned (competitor on, sizes: book 25 of a 125 market, savings 8, other banks 17, equity 0.62):
    - ALM desk OFF (bank's rates frozen): no crisis: share 20% -> 57% by year 28, its Tier 1 stays above 6% (lowest 7.6%). Crisis: its Tier 1 falls to -5.5% (breach), the bank's lowest Tier 1 12.7%. This is Max's story.
    - ALM desk ON (default): the competitor breaches even WITHOUT a crisis (Tier 1 below 0 by year ~5). The bank loses book, so its Tier 1 and NSFR rise above target and the desk lowers its rates; the competitor prices 0.3 pp below and ends up lending below its wholesale cost (price war; mortgage rate 3.7% -> 0.8%, savings rate negative, house prices up strongly through k_rate). Should the bank's desk see market share or lending volume (the CEO's 0 signal), so it does not answer a lost share with lower rates? · Not changed. · `bank_netlist.py` desk.
18. B3 modelling choices to check: the competitor has no ALM desk of its own (rate = the bank's rate - gap), keeps its savings constant, funds its growth with deposits of other banks, has no firm loans, pays out the same share of equity as the bank. The netlist's mortgage debt is the market (an index, 100 = 125 bank units) and households pay the share-weighted rate. · As listed. · `bank_netlist.py` competitor rows.

## Answered by Jesse (26 Nov 2026, afternoon)
- 2: no Rebuild button (removed). 3: signals from the chiefs stay, but no dots on signals. 6: the corners were not meant; Banking Operations and Treasury are boxes, one level down. Colours: the whole bank on one blue ramp, lighter per level; statement bars green/red. Equity statement removed. No text in the boxes; smaller Bank and Housing Market tiles.
- 4: Accounting stays under Treasury (Treasury opens into Accounting, ALCO, ALM Desk).
- New, open: the full organisational chart (Banking Operations' sub-units; other divisions such as Risk / CRO, Finance / CFO) is to be decided with M. Mendel.
