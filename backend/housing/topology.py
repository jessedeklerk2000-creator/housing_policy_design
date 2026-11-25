"""Layered model map: control loop, agents and flows, circuit inside each agent.

Elements and nodes come from the netlist. Each agent's circuit is a hand-laid drawing with
ports on its border; tests check every drawn wire against the netlist, node by node, and that
any node shared by two agents is a declared port. The government is the controller, outside
the system. The subsidy sources sit inside Households, where the subsidies enter.
"""
from __future__ import annotations
from functools import lru_cache
from pathlib import Path
import re
from .netlist import MODEL, read_model

SCHEMATIC = MODEL.with_suffix(".asc")
SYMBOL_LABEL = {"res": "Friction (resistor)", "ind": "Inertia (inductor)", "ind2": "Inertia (inductor)", "cap": "Buffer (capacitor)", "current": "Flow source", "voltage": "Incentive source", "bi": "Behavioural flow", "bi2": "Behavioural flow", "bv": "Behavioural incentive"}

AGENTS = {
    "households": {"label": "Households", "summary": "Housing services and consumption under a budget", "description": "Utility maximisation under a budget constraint. The subsidy sources are here: the subsidies enter between the household price and the investor receipt."},
    "investors": {"label": "Investors", "summary": "Own the housing stock and price it", "description": "The house price is the present value of future net rents. Investors receive rents, pay maintenance and construction, and supply housing services."},
    "constructors": {"label": "Constructors", "summary": "Build in response to the house price", "description": "New construction responds to the house price with a delay of one year."},
    "firms": {"label": "Firms", "summary": "Income, goods and services", "description": "The budget side of the household: income, consumption and goods. The crisis and Covid shocks enter here. F Consumption and F loans are coupled (K = -1)."},
    "bank": {"label": "Bank", "summary": "Mortgages, loans, savings, interest", "description": "The financial sector. Mortgage lending and interest rates are historical inputs."},
}
CONTROLLER = {"label": "Controller", "description": "The government, outside the system. In closed loop the PID sets the owner-occupied subsidy from the price error. In open loop the historical paths apply. The rental subsidy path is historical in both modes. Filtered controllers add one more element, B§PID_F, which filters the derivative."}

MONEY, REAL, POLICY = "money", "real", "policy"
FLOWS = [
    {"id": "rent", "label": "Rent", "short": "Rent", "source": "households", "target": "investors", "signal": "I(Rent)", "unit": "€/year", "kind": MONEY, "chain": ["R5", "L§Rent", "R3", "L§Gross_rent"], "port": {"node": "N029", "ret": "0"}, "description": "Paid by renting households. The rental subsidy source adds to it at N029, inside Households, so investors receive more than households pay."},
    {"id": "imputed_rent", "label": "Imputed rent", "short": "Imputed rent", "source": "households", "target": "investors", "signal": "I(Imputed_rent)", "unit": "€/year", "kind": MONEY, "chain": ["R4", "L§Imputed_rent", "R6", "L§Gross_imputed_rent"], "port": {"node": "N031", "ret": "0"}, "description": "Imputed rent of owner-occupiers. The owner-occupied subsidy source adds to it at N031, inside Households."},
    {"id": "rental_services", "label": "Rental housing services", "short": "Rental services", "source": "investors", "target": "households", "signal": "I(Supply_rent)", "unit": "m²", "kind": REAL, "chain": ["L10", "R20", "L§Supply_rent", "L§Demand_rent"], "port": {"node": "N021", "ret": "0"}, "description": "Share of the housing stock used by renters."},
    {"id": "owner_services", "label": "Owner-occupied housing services", "short": "Owner services", "source": "investors", "target": "households", "signal": "I(Supply_owner_occupied)", "unit": "m²", "kind": REAL, "chain": ["L10", "R21", "L§Supply_owner_occupied", "L§Demand_owner_occupied"], "port": {"node": "N025", "ret": "0"}, "description": "Share of the housing stock used by owner-occupiers."},
    {"id": "construction_cost", "label": "Construction cost", "short": "Construction cost", "source": "investors", "target": "constructors", "signal": "I(Construction_cost)", "unit": "€/year", "kind": MONEY, "chain": ["R13", "L2", "V§Construction_cost"], "port": {"node": "P005", "ret": "0"}, "description": "Payment for construction. This current is what the sensor measures and the controller acts on."},
    {"id": "houses", "label": "Houses", "short": "Houses", "source": "constructors", "target": "investors", "signal": "I(Construction)", "unit": "#/year", "kind": REAL, "chain": ["B§Construction", "L4"], "port": {"node": "N034", "ret": "N035"}, "description": "New houses, 0.002 × delay(construction cost^0.6, 1 year). A separate loop; B§Housing_services reads its value and accumulates it."},
    {"id": "consumption", "label": "Consumption cost", "short": "Consumption", "source": "households", "target": "firms", "signal": "I(Consumption)", "unit": "€/year", "kind": MONEY, "chain": ["R12", "L§Consumption", "L14", "L§F_Consumption"], "port": {"node": "N037", "ret": "0"}, "description": "Household spending on goods and services."},
    {"id": "income", "label": "Income", "short": "Income", "source": "firms", "target": "households", "signal": "I(Income)", "unit": "€/year", "kind": MONEY, "chain": ["Incomeactual", "L§Income"], "port": {"node": "N041", "ret": "0"}, "description": "Historical income path."},
    {"id": "goods", "label": "Goods and services", "short": "Goods", "source": "firms", "target": "households", "signal": "I(L11)", "unit": "#/year", "kind": REAL, "chain": ["L§Supply_consumption", "L11", "L§Demand_consumption"], "port": {"node": "N040", "ret": "0"}, "description": "Quantity of goods and services sold."},
    {"id": "mortgages", "label": "Mortgages", "short": "Mortgages", "source": "bank", "target": "investors", "signal": "I(Mortgages)", "unit": "€/year", "kind": MONEY, "chain": ["I§Mortgages"], "port": {"node": "N007", "ret": "0"}, "description": "Historical new mortgage lending. Can be negative when repayments exceed lending."},
    {"id": "mortgage_interest", "label": "Mortgage interest", "short": "Mortgage interest", "source": "investors", "target": "bank", "signal": "I(Mortgage_interest)", "unit": "€/year", "kind": MONEY, "chain": ["B§Mortgage_interest"], "port": {"node": "N007", "ret": "0"}, "description": "Mortgage debt × interest rate."},
    {"id": "savings", "label": "Savings", "short": "Savings", "source": "households", "target": "bank", "signal": "I(L8)", "unit": "€/year", "kind": MONEY, "chain": ["R18", "L8"], "port": {"node": "N015", "ret": "0"}, "description": "Household saving."},
    {"id": "savings_interest", "label": "Savings interest", "short": "Savings interest", "source": "bank", "target": "households", "signal": "I(L15)", "unit": "€/year", "kind": MONEY, "chain": ["B2", "L15", "R2"], "port": {"node": "N012", "ret": "0"}, "description": "Interest on savings."},
    {"id": "loans", "label": "Loans", "short": "Loans", "source": "bank", "target": "firms", "signal": "I(L7)", "unit": "€/year", "kind": MONEY, "chain": ["I8", "L7", "R17", "L§F_loans"], "port": {"node": "N009", "ret": "0"}, "description": "Lending to firms."},
    {"id": "loan_interest", "label": "Loan interest", "short": "Loan interest", "source": "firms", "target": "bank", "signal": "I(L5)", "unit": "€/year", "kind": MONEY, "chain": ["L12", "B5", "L5", "R16"], "port": {"node": "N001", "ret": "0"}, "description": "Interest paid by firms."},
    {"id": "rental_subsidy", "label": "Rental subsidies", "short": "u1 Rental", "source": "controller", "target": "households", "signal": "rental_subsidy", "unit": "€/year", "kind": POLICY, "chain": ["I§Rental_subsidies1"], "port": None, "description": "Controller signal u1. It sets the source inside Households that adds to rent at N029. A historical path; with the rental share loop on, the money that loop moves is added."},
    {"id": "owner_subsidy", "label": "Owner-occupied subsidies", "short": "u2 Owner", "source": "controller", "target": "households", "signal": "owner_subsidy", "unit": "€/year", "kind": POLICY, "chain": ["I§Owner_occupied_subsidies", "B§PID"], "port": None, "description": "Controller signal u2. It sets the source inside Households that adds to imputed rent at N031. Historical path in open loop, PID output in closed loop."},
]
DISTURBANCES = [
    {"id": "d_income", "label": "Income", "signal": "I(Incomeactual)", "unit": "€/year", "target": "firms", "element": "Incomeactual"},
    {"id": "d_covid", "label": "Covid shock", "signal": "V(n046,n042)", "unit": "Incentive", "target": "firms", "element": "V§Shock_covid"},
    {"id": "d_crisis", "label": "Financial crisis shock", "signal": "V(n042,0)", "unit": "Incentive", "target": "firms", "element": "V§Shock_financialcrisis"},
    {"id": "d_mortgages", "label": "Mortgage lending", "signal": "I(Mortgages)", "unit": "€/year", "target": "bank", "element": "I§Mortgages"},
    {"id": "d_interest", "label": "Mortgage interest rate", "signal": "I(Interest_rates)", "unit": "Per 2 months", "target": "bank", "element": "Interest_Rates"},
    {"id": "d_loans", "label": "Financial crisis shock (loans to firms)", "signal": "I(I8)", "unit": "€/year", "target": "bank", "element": "I8"},
]
OUTPUTS = [
    {"id": "y_price", "label": "House price", "signal": "I(Construction_cost)", "unit": "Model units", "element": "V§Construction_cost"},
    {"id": "y_yoy", "label": "Yearly price change", "signal": "yoy", "unit": "% a year", "element": "B§Year_on_year_change1"},
    {"id": "y_house", "label": "Price of a house", "signal": "I(B3)", "unit": "€/m²", "element": "B3"},
    {"id": "y_net_rent", "label": "Net housing cost, rent", "signal": "I(Net_housing_rent1)", "unit": "€/m²year", "element": "B§Net_housing_Rent1"},
    {"id": "y_net_owner", "label": "Net housing cost, owner", "signal": "I(Net_housing1)", "unit": "€/m²year", "element": "B§Net_housing1"},
    {"id": "y_gross_rent", "label": "Gross housing cost, rent", "signal": "I(Gross_housing_rent1)", "unit": "€/m²year", "element": "B§Gross_housing_rent1"},
    {"id": "y_gross_owner", "label": "Gross housing cost, owner", "signal": "I(Gross_housing1)", "unit": "€/m²year", "element": "B§Gross_housing1"},
    {"id": "y_debt", "label": "Mortgage debt", "signal": "I(Mortgage_debt)", "unit": "€", "element": "B§Mortgage_Debt"},
    {"id": "y_unit", "label": "Price per unit of goods", "signal": "I(Consumptiongraph)", "unit": "€/#", "element": "B§Consumptiongraph"},
    {"id": "y_reference", "label": "Target path", "signal": "I(Reference)", "unit": "Model units", "element": "B§Reference"},
    {"id": "y_error", "label": "Price error", "signal": "I(Error)", "unit": "Model units", "element": "B§Error"},
]


def _e(a: tuple[int, int], b: tuple[int, int]) -> list[list[int]]:
    return [list(a), list(b)]


# Pin order follows the netlist: first pin is the element's first node.
# Multiport style: each port enters as a pair, flow rail plus return rail (24 units apart,
# on the +x side for top/bottom ports and +y side for left/right ports; Bank's bottom ports use -x).
# Shunt components sit across a pair; series components sit on the flow rail. "return_wires" are
# return-rail wires: part of node 0 (or N035 for the houses pair), drawn lighter. "common_returns"
# join the returns of one circuit inside the agent (circuits that touch only through ground stay
# separate). A ground symbol remains only where a circuit has no port to return through.
LAYOUTS = {
    "households": {"size": [1200, 760], "elements": {
        "L§Demand_rent": _e((120, 140), (220, 140)), "L§Demand_owner_occupied": _e((360, 100), (360, 180)), "B4": _e((360, 220), (460, 220)),
        "I§Rental_subsidies1": _e((700, 140), (600, 140)), "L§Rent": _e((600, 280), (600, 180)), "R5": _e((600, 400), (600, 300)),
        "I§Owner_occupied_subsidies": _e((940, 140), (840, 140)), "B§PID": _e((940, 140), (840, 140)), "L§Imputed_rent": _e((840, 280), (840, 180)), "R4": _e((840, 400), (840, 300)),
        "C6": _e((520, 400), (520, 480)), "L§Consumption": _e((240, 400), (140, 400)), "R12": _e((360, 400), (260, 400)),
        "L§Income": _e((140, 520), (240, 520)), "L11": _e((140, 640), (240, 640)), "L§Demand_consumption": _e((300, 640), (300, 740)),
        "R18": _e((1000, 420), (1100, 420)), "R2": _e((1100, 520), (1000, 520)),
    }, "wires": [
        [120, 0, 120, 140], [360, 0, 360, 100], [360, 180, 360, 220], [600, 0, 600, 180], [600, 280, 600, 300], [840, 0, 840, 180], [840, 280, 840, 300],
        [360, 400, 1000, 400], [1000, 400, 1000, 520], [0, 400, 140, 400], [240, 400, 260, 400], [0, 520, 140, 520], [240, 520, 440, 520], [440, 520, 440, 400],
        [0, 640, 140, 640], [240, 640, 300, 640], [1100, 420, 1200, 420], [1200, 520, 1100, 520],
    ], "return_wires": [
        [144, 0, 144, 20], [144, 20, 220, 20], [220, 20, 220, 140], [384, 0, 384, 20], [384, 20, 460, 20], [460, 20, 460, 220],
        [624, 0, 624, 20], [624, 20, 700, 20], [700, 20, 700, 140], [864, 0, 864, 20], [864, 20, 940, 20], [940, 20, 940, 140],
        [0, 424, 340, 424], [0, 544, 420, 544], [0, 664, 30, 664], [30, 664, 30, 740], [30, 740, 300, 740], [1200, 444, 1160, 444], [1200, 544, 1160, 544],
    ], "common_returns": [
        [220, 20, 384, 20],
        [340, 480, 1160, 480], [340, 424, 340, 480], [420, 480, 420, 544], [700, 140, 700, 480], [940, 140, 940, 480], [1160, 444, 1160, 544],
    ], "grounds": [], "signals": [
        {"flow": "rental_subsidy", "path": [[760, 0], [760, 190], [650, 190], [650, 159]]}, {"flow": "owner_subsidy", "path": [[1000, 0], [1000, 190], [890, 190], [890, 159]]},
    ], "ports": {"rental_services": [120, 0], "owner_services": [360, 0], "rent": [600, 0], "imputed_rent": [840, 0], "consumption": [0, 400], "income": [0, 520], "goods": [0, 640], "savings": [1200, 420], "savings_interest": [1200, 520]},
        "returns": {"rental_services": [144, 0], "owner_services": [384, 0], "rent": [624, 0], "imputed_rent": [864, 0], "consumption": [0, 424], "income": [0, 544], "goods": [0, 664], "savings": [1200, 444], "savings_interest": [1200, 544]},
        "not_drawn": ["I5", "L3", "B7"]},
    "investors": {"size": [1200, 760], "elements": {
        "R13": _e((300, 120), (200, 120)), "L4": _e((100, 260), (100, 340)), "C4": _e((480, 200), (480, 260)), "R8": _e((480, 340), (480, 280)),
        "L1": _e((640, 200), (640, 300)), "R9": _e((640, 320), (640, 420)), "V§Maintenance_costs": _e((640, 440), (640, 540)),
        "L§Gross_rent": _e((720, 480), (720, 380)), "R3": _e((720, 660), (720, 560)), "C3": _e((820, 520), (720, 520)),
        "L§Gross_imputed_rent": _e((880, 480), (880, 380)), "R6": _e((880, 660), (880, 560)), "C2": _e((980, 520), (880, 520)),
        "B§Housing_services": _e((60, 500), (60, 420)), "R22": _e((140, 500), (140, 420)), "C7": _e((140, 600), (140, 520)), "L10": _e((200, 420), (300, 420)),
        "R20": _e((400, 420), (400, 500)), "L§Supply_rent": _e((400, 520), (400, 620)), "R21": _e((560, 420), (560, 500)), "L§Supply_owner_occupied": _e((560, 520), (560, 620)),
    }, "wires": [
        [0, 120, 200, 120], [300, 120, 300, 200], [300, 200, 1120, 200], [1120, 140, 1120, 260], [1120, 140, 1200, 140], [1120, 260, 1200, 260],
        [0, 260, 100, 260], [480, 260, 480, 280], [640, 300, 640, 320], [640, 420, 640, 440],
        [720, 760, 720, 660], [720, 560, 720, 480], [720, 380, 720, 200], [880, 760, 880, 660], [880, 560, 880, 480], [880, 380, 880, 200],
        [60, 420, 200, 420], [140, 500, 140, 520], [300, 420, 560, 420], [400, 500, 400, 520], [400, 620, 400, 760], [560, 500, 560, 520], [560, 620, 560, 760],
    ], "return_wires": [
        [0, 144, 180, 144], [1200, 164, 1140, 164], [1200, 284, 1140, 284], [0, 284, 30, 284], [30, 284, 30, 340], [30, 340, 100, 340],
        [744, 760, 744, 740], [744, 740, 820, 740], [820, 740, 820, 520], [904, 760, 904, 740], [904, 740, 980, 740], [980, 740, 980, 520],
        [424, 760, 424, 640], [584, 760, 584, 640],
    ], "common_returns": [
        [180, 144, 180, 164], [180, 164, 1140, 164], [1140, 164, 1140, 700], [640, 700, 820, 700], [820, 700, 980, 700], [980, 700, 1140, 700],
        [640, 540, 640, 700], [480, 340, 600, 340], [600, 340, 600, 700], [600, 700, 640, 700],
        [60, 500, 60, 640], [140, 600, 140, 640], [60, 640, 424, 640], [424, 640, 584, 640],
    ], "grounds": [], "signals": [],
        "ports": {"construction_cost": [0, 120], "houses": [0, 260], "rental_services": [400, 760], "owner_services": [560, 760], "rent": [720, 760], "imputed_rent": [880, 760], "mortgages": [1200, 140], "mortgage_interest": [1200, 260]},
        "returns": {"construction_cost": [0, 144], "houses": [0, 284], "rental_services": [424, 760], "owner_services": [584, 760], "rent": [744, 760], "imputed_rent": [904, 760], "mortgages": [1200, 164], "mortgage_interest": [1200, 284]},
        "not_drawn": []},
    "constructors": {"size": [800, 380], "elements": {
        "L2": _e((600, 100), (500, 100)), "V§Construction_cost": _e((300, 100), (300, 200)), "B§Construction": _e((400, 320), (400, 220)),
    }, "wires": [[800, 100, 600, 100], [500, 100, 300, 100], [800, 220, 400, 220]],
        "return_wires": [[800, 124, 780, 124], [780, 124, 780, 200], [780, 200, 300, 200], [800, 244, 780, 244], [780, 244, 780, 320], [780, 320, 400, 320]],
        "common_returns": [], "grounds": [], "signals": [], "ports": {"construction_cost": [800, 100], "houses": [800, 220]}, "returns": {"construction_cost": [800, 124], "houses": [800, 244]}, "not_drawn": []},
    "firms": {"size": [1100, 640], "elements": {
        "L14": _e((1000, 100), (900, 100)), "L§F_Consumption": _e((880, 100), (780, 100)), "V§Shock_covid": _e((760, 100), (660, 100)), "V§Shock_financialcrisis": _e((640, 100), (540, 100)),
        "Incomeactual": _e((700, 220), (800, 220)), "R7": _e((600, 220), (680, 220)),
        "L§Supply_consumption": _e((800, 340), (900, 340)), "R11": _e((600, 340), (700, 340)), "C5": _e((500, 340), (580, 340)), "B11": _e((750, 440), (750, 340)),
        "R17": _e((700, 560), (700, 480)), "L§F_loans": _e((780, 480), (780, 600)), "R1": _e((840, 480), (840, 530)), "C1": _e((840, 540), (840, 600)), "L12": _e((1000, 520), (900, 520)),
    }, "wires": [
        [1100, 100, 1000, 100], [900, 100, 880, 100], [780, 100, 760, 100], [660, 100, 640, 100], [800, 220, 1100, 220], [680, 220, 700, 220],
        [900, 340, 1100, 340], [700, 340, 800, 340], [580, 340, 600, 340], [700, 640, 700, 560], [700, 480, 840, 480], [840, 530, 840, 540], [900, 640, 900, 520],
    ], "return_wires": [
        [1100, 124, 520, 124], [520, 124, 520, 100], [520, 100, 540, 100], [1100, 244, 580, 244], [580, 244, 580, 220], [580, 220, 600, 220],
        [1100, 364, 1080, 364], [1080, 364, 1080, 440], [1080, 440, 480, 440], [480, 440, 480, 340], [480, 340, 500, 340],
        [724, 640, 724, 600], [724, 600, 840, 600], [924, 640, 924, 620], [924, 620, 1000, 620], [1000, 620, 1000, 520],
    ], "common_returns": [[1060, 124, 1060, 244]], "grounds": [], "signals": [],
        "ports": {"consumption": [1100, 100], "income": [1100, 220], "goods": [1100, 340], "loans": [700, 640], "loan_interest": [900, 640]},
        "returns": {"consumption": [1100, 124], "income": [1100, 244], "goods": [1100, 364], "loans": [724, 640], "loan_interest": [924, 640]}, "not_drawn": ["B§Salary", "I2"]},
    "bank": {"size": [1100, 700], "elements": {
        "I§Mortgages": _e((160, 180), (160, 80)), "B§Mortgage_interest": _e((200, 240), (200, 340)), "Interest_Rates": _e((700, 180), (700, 100)), "L9": _e((800, 100), (800, 180)),
        "L8": _e((140, 400), (240, 400)), "V4": _e((260, 400), (360, 400)), "L15": _e((240, 560), (140, 560)), "B2": _e((360, 560), (260, 560)),
        "L7": _e((600, 500), (600, 600)), "I8": _e((500, 460), (600, 460)), "B5": _e((800, 640), (800, 560)), "L5": _e((800, 540), (800, 460)), "R16": _e((800, 460), (700, 460)),
    }, "wires": [
        [0, 80, 160, 80], [160, 80, 240, 80], [240, 80, 240, 240], [0, 240, 240, 240], [700, 100, 800, 100],
        [0, 400, 140, 400], [240, 400, 260, 400], [0, 560, 140, 560], [240, 560, 260, 560],
        [600, 700, 600, 600], [600, 500, 600, 460], [800, 700, 800, 640], [800, 560, 800, 540],
    ], "return_wires": [
        [0, 104, 20, 104], [20, 104, 20, 180], [20, 180, 160, 180], [0, 264, 20, 264], [20, 264, 20, 340], [20, 340, 200, 340], [700, 180, 800, 180],
        [0, 424, 380, 424], [380, 424, 380, 400], [380, 400, 360, 400], [0, 584, 380, 584], [380, 584, 380, 560], [380, 560, 360, 560],
        [576, 700, 576, 680], [576, 680, 500, 680], [500, 680, 500, 460], [776, 700, 776, 680], [776, 680, 700, 680], [700, 680, 700, 460],
    ], "common_returns": [[20, 180, 20, 264], [20, 340, 20, 424], [20, 424, 20, 584]], "grounds": [[750, 180]], "signals": [],
        "ports": {"mortgages": [0, 80], "mortgage_interest": [0, 240], "savings": [0, 400], "savings_interest": [0, 560], "loans": [600, 700], "loan_interest": [800, 700]},
        "returns": {"mortgages": [0, 104], "mortgage_interest": [0, 264], "savings": [0, 424], "savings_interest": [0, 584], "loans": [576, 700], "loan_interest": [776, 700]},
        "not_drawn": ["I4", "I§Mortgagesold", "I1", "B§Mortgage_Debt"]},
}
CONTROLLER_LAYOUT = {"size": [1100, 480], "elements": {
    "B§Reference": _e((60, 120), (160, 120)), "B§Error": _e((300, 220), (400, 220)), "B§PID_P": _e((560, 100), (660, 100)), "B§PID_I_Robust": _e((560, 220), (660, 220)), "B§PID_D": _e((560, 340), (660, 340)),
}, "paths": [
    [[160, 120], [350, 120], [350, 196]], [[350, 480], [350, 244]], [[400, 220], [480, 220], [480, 100], [560, 100]], [[480, 220], [560, 220]], [[480, 220], [480, 340], [560, 340]],
    [[660, 100], [800, 100], [800, 196]], [[660, 220], [776, 220]], [[660, 340], [800, 340], [800, 244]], [[824, 220], [1100, 220]],
], "sums": [[800, 220]], "labels": [[360, 470, "House price y"], [850, 205, "u2 to Households"]], "not_drawn": ["B§PID_I", "B§PID_dist", "I3"]}
NOT_IN_CIRCUIT = ["I6", "I7"]


def parse_schematic(path: Path = SCHEMATIC) -> dict:
    data = path.read_bytes()
    text = data.decode("utf-16") if data[:2] in (b"\xff\xfe", b"\xfe\xff") else data.decode("utf-16-le") if data[1] == 0 else data.decode("latin-1")
    symbols, wires, grounds, current = [], [], [], None
    for line in text.splitlines():
        parts = line.split()
        if not parts:
            continue
        if parts[0] == "WIRE":
            wires.append([int(v) for v in parts[1:5]])
        elif parts[0] == "FLAG" and parts[3] == "0":
            grounds.append([int(parts[1]), int(parts[2])])
        elif parts[0] == "SYMBOL":
            current = {"type": parts[1], "x": int(parts[2]), "y": int(parts[3]), "rotation": parts[4]}
            symbols.append(current)
        elif parts[0] == "SYMATTR" and parts[1] == "InstName" and current:
            current["inst"] = parts[2]
    return {"symbols": symbols, "wires": wires, "grounds": grounds}


def parse_netlist(lines: list[str]) -> list[dict]:
    out = []
    for line in lines[1:]:
        if not line.strip() or line[0] in "*." or line.startswith("K "):
            continue
        name, a, b, *value = line.split()
        out.append({"name": name, "a": a, "b": b, "value": " ".join(value)})
    return out


def _state(elements: list[dict]) -> None:
    """active: in the circuit. readout: computes a signal only.
    signal: separate from the circuit, but its value is read by another source. unused: neither."""
    parent: dict[str, str] = {}

    def find(n):
        parent.setdefault(n, n)
        while parent[n] != n:
            parent[n] = parent[parent[n]]
            n = parent[n]
        return n
    for e in elements:
        if e["a"] != e["b"]:
            parent[find(e["a"])] = find(e["b"])
    ground = find("0")
    islands: dict[str, list[dict]] = {}
    for e in elements:
        if e["a"] == e["b"]:
            e["state"] = "readout" if e["name"][0] == "B" else "unused"
        elif find(e["a"]) == ground and not e["a"].startswith("NC_"):
            e["state"] = "active"
        else:
            e["state"] = "unused"
            islands.setdefault(find(e["a"]), []).append(e)
    changed = True
    while changed:  # an island counts only if something in use reads it
        changed = False
        text = " ".join(e["value"] for e in elements if e["name"][0] == "B" and e["state"] != "unused").lower()
        for members in islands.values():
            read = any(re.search(rf"\bi\({re.escape(m['name'].split('§')[-1].lower())}\)", text) for m in members)
            if read and members[0]["state"] == "unused":
                for m in members:
                    m["state"] = "signal"
                changed = True


def return_dots(layout: dict) -> list[list[int]]:
    """Junction dots on the return wires: points where three or more wire ends meet,
    or a wire ends on the middle of another. Crossings without a dot are not connected."""
    segs = layout["return_wires"] + layout.get("common_returns", [])
    ends = [(w[0], w[1]) for w in segs] + [(w[2], w[3]) for w in segs]
    dots = []
    for p in sorted(set(ends)):
        count = ends.count(p)
        for x0, y0, x1, y1 in segs:
            inside = (x0 == x1 == p[0] and min(y0, y1) < p[1] < max(y0, y1)) or (y0 == y1 == p[1] and min(x0, x1) < p[0] < max(x0, x1))
            count += 2 * inside
        if count >= 3:
            dots.append(list(p))
    return dots


@lru_cache(maxsize=1)
def model_map() -> dict:
    sheet = parse_schematic()
    elements = parse_netlist(read_model())
    _state(elements)
    by_inst = {s["inst"].lower(): s for s in sheet["symbols"]}
    placed = {name: (agent, pins) for agent, layout in LAYOUTS.items() for name, pins in layout["elements"].items()}
    controller = CONTROLLER_LAYOUT["elements"]
    flow_of: dict[str, list[str]] = {}
    for flow in FLOWS:
        for name in flow["chain"]:
            flow_of.setdefault(name, []).append(flow["id"])
    for e in elements:
        symbol = by_inst.get(e["name"].split("§")[-1].lower())
        if symbol is None:
            raise ValueError(f"{e['name']} is in the netlist but not in the schematic")
        if e["name"] == "I§Owner_occupied_subsidies":  # the open-loop wiring: same place as B§PID
            e["a"], e["b"] = "0", "N031"
        agent, pins = placed.get(e["name"], (None, None))
        if e["name"] in controller:
            agent, pins = "controller", controller[e["name"]]
        e.update(type=symbol["type"], role=SYMBOL_LABEL[symbol["type"]], pins=pins or [], agent=agent, flows=flow_of.get(e["name"], []),
                 trace=f"I({e['name'].split('§')[-1]})", netlist=f"{e['name']} {e['a']} {e['b']} {e['value']}")
    return {"agents": AGENTS, "controller": CONTROLLER, "flows": FLOWS, "disturbances": DISTURBANCES, "outputs": OUTPUTS, "elements": elements,
            "layouts": {k: {**{key: v[key] for key in v if key != "elements"}, "dots": return_dots(v)} for k, v in LAYOUTS.items()},
            "controller_layout": {k: v for k, v in CONTROLLER_LAYOUT.items() if k != "elements"}}
