# Storage elements (L and C)

One row per inductor and capacitor. **Role** is Claude's first reading, for Jesse to decide: `CPB dynamics` (needed to reproduce a CPB
adjustment), `friction` (added on top of the CPB model), `numerical` (only there so SPICE solves, e.g. 1 H with Rser=1u between sources).
Nothing in the model is changed by this list.

| Agent | Netlist id | Name | Value | Equation / term | Role (suggested) |
|---|---|---|---|---|---|
| bank | `L15` | L<sub>sav. int.</sub> | `1` |  | to decide |
| bank | `L5` | L<sub>loan int.</sub> | `1` |  | to decide |
| bank | `L7` | L<sub>loans</sub> | `5` |  | to decide |
| bank | `L8` | L<sub>savings</sub> | `1.9` |  | to decide |
| bank | `L9` | L<sub>mort. rate</sub> | `1` |  | to decide |
| constructors | `L2` | L<sub>constr.</sub> | `2` | New construction (2.14): numerical | to decide |
| firms | `C1` | C<sub>f. cash</sub> | `1` |  | friction? |
| firms | `C5` | C<sub>f. goods</sub> | `1` |  | friction? |
| firms | `L12` | L<sub>f. loans</sub> | `1` |  | to decide |
| firms | `L14` | L<sub>f. revenue</sub> | `1` |  | to decide |
| firms | `L§F_Consumption` | L<sub>f. cons.</sub> | `2 Rser=1u` |  | numerical? |
| firms | `L§F_loans` | L<sub>f. credit</sub> | `1` |  | to decide |
| firms | `L§Supply_consumption` | L<sub>sup. goods</sub> | `1` |  | to decide |
| households | `C6` | C<sub>income</sub> | `1` |  | friction? |
| households | `L11` | L<sub>goods</sub> | `1` |  | to decide |
| households | `L§Consumption` | L<sub>cons.</sub> | `1 Rser=1u` | Utility and budget (2.1): p_x x | numerical? |
| households | `L§Demand_consumption` | L<sub>x</sub> | `1` | Utility and budget (2.1): x | to decide |
| households | `L§Demand_owner_occupied` | L<sub>owner</sub> | `2` | Utility and budget (2.1): h_k | to decide |
| households | `L§Demand_rent` | L<sub>rent</sub> | `2` | Utility and budget (2.1): h_h | to decide |
| households | `L§Imputed_rent` | L<sub>imp. pay</sub> | `3 Rser=1u` | Utility and budget (2.1): w_k h_k | numerical? |
| households | `L§Income` | L<sub>income</sub> | `1 Rser=1u` | Utility and budget (2.1): b | numerical? |
| households | `L§Rent` | L<sub>rent pay</sub> | `3` | Utility and budget (2.1): w_h h_h | to decide |
| investors | `C2` | C<sub>gross imp.</sub> | `1` |  | friction? |
| investors | `C3` | C<sub>gross rent</sub> | `1` |  | friction? |
| investors | `C4` | C<sub>inv. node</sub> | `0.5` |  | friction? |
| investors | `C7` | C<sub>services</sub> | `0.5` |  | friction? |
| investors | `L1` | L<sub>maint.</sub> | `5` | Market price of a house (2.17): numerical | to decide |
| investors | `L10` | L<sub>supply</sub> | `10` |  | to decide |
| investors | `L4` | L<sub>houses</sub> | `1` | New construction (2.14): numerical | to decide |
| investors | `L§Gross_imputed_rent` | L<sub>gross imp.</sub> | `3 Rser=1u` | Market price of a house (2.17): w^{*}_k | numerical? |
| investors | `L§Gross_rent` | L<sub>gross rent</sub> | `3` | Market price of a house (2.17): w^{*}_h | to decide |
| investors | `L§Supply_owner_occupied` | L<sub>sup. owner</sub> | `1` |  | to decide |
| investors | `L§Supply_rent` | L<sub>sup. rent</sub> | `1` |  | to decide |
| (not drawn) | `L3` | L<sub>aux</sub> | `1` |  | numerical? |
