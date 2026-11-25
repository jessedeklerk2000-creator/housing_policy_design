# Element names (display layer)

Netlist ids are unchanged; these names are shown on the canvas, in menus and in figures.
Scheme: SPICE type letter + short English subscript. Claude's reading of the netlist (25 Nov 2026), **check: Jesse**.

| Agent | Netlist id | New name | Type | Value | Meaning |
|---|---|---|---|---|---|
| bank | `B2` | B<sub>sav. int.</sub> | bi2 | `I=5+0.000*idt(I(V4))` | savings interest |
| bank | `B5` | B<sub>firm book</sub> | bi2 | `I=10+0.001*idt(I(I1))` | firm credit: 10 + 0.001·∫ I1 |
| bank | `B§Mortgage_interest` | B<sub>mort. int.</sub> | bi2 | `I=I(Mortgage_debt)*I(interest_rates)` | mortgage interest = debt × rate |
| bank | `I8` | I<sub>firm loans</sub> | current | `PULSE(30 10 70 0 10 30 10000)` | firm lending (crisis pulse) |
| bank | `Interest_Rates` | I<sub>mort. rate</sub> | current | `PWL(0 0.01033 2 0.01033 4 0.01033 6 0.01` | historical mortgage rate |
| bank | `I§Mortgages` | I<sub>mortgages</sub> | current | `PWL(6 4.400 7 4.801 8 5.176 9 5.5121 10 ` | historical new mortgage lending |
| bank | `L15` | L<sub>sav. int.</sub> | ind | `1` | savings-interest inertia |
| bank | `L5` | L<sub>loan int.</sub> | ind | `1` | loan-interest inertia |
| bank | `L7` | L<sub>loans</sub> | ind2 | `5` | loans to firms |
| bank | `L8` | L<sub>savings</sub> | ind2 | `1.9` | savings deposits |
| bank | `L9` | L<sub>mort. rate</sub> | ind | `1` | mortgage-rate inertia |
| bank | `R16` | R<sub>lending</sub> | res | `3` | lending friction |
| bank | `V4` | V<sub>deposits</sub> | voltage | `PULSE(-60 -60 40 10 0 100 10000)` | deposit incentive |
| constructors | `B§Construction` | B<sub>constr.</sub> | bi2 | `I=0.002*delay(I(construction_cost)**0.6,` | new houses: 0.002·delay(cost^0.6, 1 yr) |
| constructors | `L2` | L<sub>constr.</sub> | ind2 | `2` | construction payment inertia |
| constructors | `V§Construction_cost` | V<sub>constr.</sub> | voltage | `0` | construction payment (incentive) |
| controller | `B§Error` | B<sub>error</sub> | bi2 | `I=I(Reference)-I(construction_cost)` | control error e = r − y |
| controller | `B§PID_D` | B<sub>D</sub> | bi2 | `I=ddt(I(Error))` | derivative action |
| controller | `B§PID_I_Robust` | B<sub>I robust</sub> | bi2 | `I=idt(I(Error),-51.38)` | integral action (robust tuning) |
| controller | `B§PID_P` | B<sub>P</sub> | bi2 | `I=I(Error)` | proportional action |
| controller | `B§Reference` | B<sub>ref.</sub> | bi | `I=80*1.025**(time/6)` | reference r |
| firms | `B11` | B<sub>loan int.</sub> | bi2 | `I=I(F_consumption)*0.02` | loan interest: 2% of consumption revenue |
| firms | `C1` | C<sub>f. cash</sub> | cap | `1` | firms cash buffer |
| firms | `C5` | C<sub>f. goods</sub> | cap | `1` | firms goods buffer |
| firms | `Incomeactual` | I<sub>income</sub> | current | `PWL(0 259.056 6 269.936 12 279.384 18 28` | historical income path |
| firms | `L12` | L<sub>f. loans</sub> | ind2 | `1` | firms loan inertia |
| firms | `L14` | L<sub>f. revenue</sub> | ind2 | `1` | consumption payment into firms |
| firms | `L§F_Consumption` | L<sub>f. cons.</sub> | ind2 | `2 Rser=1u` | consumption revenue (firms) |
| firms | `L§F_loans` | L<sub>f. credit</sub> | ind2 | `1` | loans received (firms) |
| firms | `L§Supply_consumption` | L<sub>sup. goods</sub> | ind2 | `1` | goods supply |
| firms | `R1` | R<sub>f. cash</sub> | res | `1` | firms cash friction |
| firms | `R11` | R<sub>f. goods</sub> | res | `1` | firms goods friction |
| firms | `R17` | R<sub>f. loans</sub> | res | `1` | firms loan friction |
| firms | `R7` | R<sub>shock</sub> | res | `0.001` | shock injection resistor (0.001) |
| firms | `V§Shock_covid` | V<sub>covid</sub> | voltage | `PULSE(00 80 150 0 50 15 2000)` | Covid shock |
| firms | `V§Shock_financialcrisis` | V<sub>fin.crisis</sub> | voltage | `PULSE(00 -50 90 10 20 35 200)` | financial-crisis shock (firms) |
| households | `B4` | B<sub>own</sub> | bv | `V=-1*(I(net_housing_rent1)-I(net_housing` | owning versus renting: net imputed rent − net rent per unit |
| households | `B§PID` | B<sub>PID</sub> | bi2 | `I=-29.29*(1-min(time/5,1))+if(time<0,24,` | subsidy from the controller (closed loop) |
| households | `C6` | C<sub>income</sub> | cap | `1` | household budget buffer |
| households | `I§Owner_occupied_subsidies` | I<sub>subs. own</sub> | current | `PWL(0 23.00 6 24.01 12 24.01 12.1 24.56 ` | owner-occupied subsidy s_k (input u₂) |
| households | `I§Rental_subsidies1` | I<sub>subs. rent</sub> | current | `PULSE(4 0 160 0 0 1000 1000)` | rental subsidy s_h (input u₁) |
| households | `L11` | L<sub>goods</sub> | ind2 | `1` | goods received and demanded (x); drawn together with L§Demand_consumption (1 H + 1 H in series) |
| households | `L§Consumption` | L<sub>cons.</sub> | ind2 | `1 Rser=1u` | consumption spending |
| households | `L§Demand_consumption` | L<sub>x</sub> | ind2 | `1` | demand for goods; 1 H in series with L goods, drawn as part of L goods |
| households | `L§Demand_owner_occupied` | L<sub>owner</sub> | ind2 | `2` | owner-occupied housing demand h_k |
| households | `L§Demand_rent` | L<sub>rent</sub> | ind2 | `2` | rental housing demand h_h |
| households | `L§Imputed_rent` | L<sub>imp. pay</sub> | ind2 | `3 Rser=1u` | imputed rent paid |
| households | `L§Income` | L<sub>income</sub> | ind2 | `1 Rser=1u` | income received |
| households | `L§Rent` | L<sub>rent pay</sub> | ind2 | `3` | rent paid |
| households | `R12` | R<sub>cons.</sub> | res | `3` | consumption friction |
| households | `R18` | R<sub>savings</sub> | res | `15` | savings friction |
| households | `R2` | R<sub>sav. int.</sub> | res | `3` | savings-interest friction |
| households | `R4` | R<sub>imp.</sub> | res | `1.933` | imputed-rent friction, households side (resistor basis) |
| households | `R5` | R<sub>rent</sub> | res | `6.698` | rent friction, households side (resistor basis) |
| investors | `B§Housing_services` | B<sub>stock</sub> | bi2 | `I=48+idt(I(Construction))` | housing stock: 48 + ∫ new houses |
| investors | `C2` | C<sub>gross imp.</sub> | cap | `1` | imputed-rent buffer (investors) |
| investors | `C3` | C<sub>gross rent</sub> | cap | `1` | rent buffer (investors) |
| investors | `C4` | C<sub>inv. node</sub> | cap | `0.5` | investors node buffer |
| investors | `C7` | C<sub>services</sub> | cap | `0.5` | housing-services buffer |
| investors | `L1` | L<sub>maint.</sub> | ind2 | `5` | maintenance path inertia |
| investors | `L10` | L<sub>supply</sub> | ind2 | `10` | housing services to households |
| investors | `L4` | L<sub>houses</sub> | ind2 | `1` | new houses arriving at the investors |
| investors | `L§Gross_imputed_rent` | L<sub>gross imp.</sub> | ind2 | `3 Rser=1u` | gross imputed rent received (w*, owned) |
| investors | `L§Gross_rent` | L<sub>gross rent</sub> | ind2 | `3` | gross rent received (w*, rental) |
| investors | `L§Supply_owner_occupied` | L<sub>sup. owner</sub> | ind2 | `1` | owner-occupied housing supply |
| investors | `L§Supply_rent` | L<sub>sup. rent</sub> | ind2 | `1` | rental housing supply |
| investors | `R13` | R<sub>constr.</sub> | res | `1` | construction payment friction (investors) |
| investors | `R20` | R<sub>sup. rent</sub> | res | `6` | rental supply friction |
| investors | `R21` | R<sub>sup. owner</sub> | res | `1.5` | owner-occupied supply friction |
| investors | `R22` | R<sub>services</sub> | res | `1` | housing-services friction |
| investors | `R3` | R<sub>inv. rent</sub> | res | `4.465` | rent friction, investors side (resistor basis) |
| investors | `R6` | R<sub>inv. imp.</sub> | res | `1.289` | imputed-rent friction, investors side (resistor basis) |
| investors | `R8` | R<sub>inv. node</sub> | res | `1` | investors node damping |
| investors | `R9` | R<sub>maint.</sub> | res | `3` | maintenance path friction |
| investors | `V§Maintenance_costs` | V<sub>maint.</sub> | voltage | `PULSE(30 30 0 160 00 10)` | maintenance cost κ |
| (not drawn) | `B3` | B<sub>cost/house</sub> | bi2 | `I=I(construction_cost)/I(construction)` | read-out: construction cost per house |
| (not drawn) | `B7` | B<sub>serv. gap</sub> | bv | `V=20*(I(L10)-I(I5))` | housing-services gap 20·(I(L10) − I5) |
| (not drawn) | `B§Consumptiongraph` | B<sub>cons. rat.</sub> | bi2 | `I=I(F_Consumption)/I(Demand_consumption)` | read-out: consumption ratio |
| (not drawn) | `B§Gross_housing1` | B<sub>gross i.</sub> | bi2 | `I=I(Gross_imputed_rent)/I(Demand_owner_o` | read-out: gross imputed rent per unit |
| (not drawn) | `B§Gross_housing_rent1` | B<sub>gross r.</sub> | bi2 | `I=I(gross_rent)/I(Demand_rent)` | read-out: gross rent per unit |
| (not drawn) | `B§Mortgage_Debt` | B<sub>mort. debt</sub> | bi2 | `I=idt(I(Mortgages))+100` | mortgage debt: 100 + ∫ mortgages |
| (not drawn) | `B§Net_housing1` | B<sub>net imp.</sub> | bi2 | `I=I(Imputed_rent)/I(Demand_owner_occupie` | read-out: imputed rent per unit of owned housing |
| (not drawn) | `B§Net_housing_Rent1` | B<sub>net rent</sub> | bi2 | `I=I(Rent)/I(Demand_rent)` | read-out: rent per unit of rental housing |
| (not drawn) | `B§PID_I` | B<sub>I</sub> | bi2 | `I=idt(I(Error),-7.707)` | integral action |
| (not drawn) | `B§PID_dist` | B<sub>PID dist.</sub> | bi2 | `I=-29.29*(1-min(time/5,1))+limit(10.3*I(` | PID with disturbance path |
| (not drawn) | `B§Salary` | B<sub>salary</sub> | bi2 | `I=200*(1.00**(time/6))` | salary path (not connected) |
| (not drawn) | `B§Year_on_year_change1` | B<sub>yoy</sub> | bi2 | `I = if(time<0.01, 0, I(Construction_cost` | read-out: year-on-year change |
| (not drawn) | `I1` | I<sub>crisis</sub> | current | `PULSE(3 10 70 0 10 30 10000)` | crisis pulse |
| (not drawn) | `I2` | I<sub>path 2</sub> | current | `PWL(0 205.600 1 207.119 2 208.608 3 210.` | input path (PWL), use to check |
| (not drawn) | `I3` | I<sub>path 3</sub> | current | `PWL(0 24 5.9 24 6 23 11.91 23 12 22 17.9` | input path (PWL), use to check |
| (not drawn) | `I4` | I<sub>path 4</sub> | current | `PWL(0 4.005 1 4.02 2 5.174 3 5.5081 4 5.` | input path (PWL), use to check |
| (not drawn) | `I5` | I<sub>serv. ref.</sub> | current | `PULSE(48 80 0 180 0 0 180)` | housing-services reference |
| (not drawn) | `I6` | I<sub>zero</sub> | current | `0` | zero source |
| (not drawn) | `I7` | I<sub>const.</sub> | current | `2` | constant source (2) |
| (not drawn) | `I§Mortgagesold` | I<sub>mort. old</sub> | current | `PWL(0 4.400 6 6.167 12 6.550 18 5.832 24` | older mortgage path (not connected) |
| (not drawn) | `L3` | L<sub>aux</sub> | ind | `1` | auxiliary inductor |
