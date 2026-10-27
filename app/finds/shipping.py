"""Landed-cost estimates for any country (owner decision 2026-10-26: global). Each country belongs to a shipping zone;
an administrator keeps one air rate per kilo (and an optional handling cost per unit) per zone in find_shipping_rates.
A zone without a rate shows no estimate rather than a made-up one."""
from __future__ import annotations

from typing import Any

ZONES: dict[str, set[str]] = {
    "west_africa": set("NG GH SN CI BJ TG BF ML NE GM GN GW SL LR CV MR".split()),
    "rest_of_africa": set(("ZA KE TZ UG RW ET EG MA DZ TN LY SD SS SO DJ ER CM GA CG CD CF TD GQ AO ZM ZW MW MZ NA BW LS "
                           "SZ MG MU SC KM BI ST EH RE YT SH").split()),
    "uk_europe": set(("GB IE FR DE ES PT IT NL BE LU CH AT DK SE NO FI IS PL CZ SK HU RO BG GR HR SI RS BA ME MK AL EE LV "
                      "LT UA MD BY CY MT LI MC SM AD VA XK FO GI GG JE IM AX GL").split()),
    "north_america": set("US CA PM BM".split()),
    "middle_east": set("AE SA QA KW BH OM YE JO LB SY IQ IR IL PS TR".split()),
    "latin_america": set(("MX BR AR CL CO PE VE EC BO PY UY GY SR GF GT HN SV NI CR PA CU DO HT JM TT BB BS BZ PR AG DM GD "
                          "KN LC VC AW CW SX BQ KY TC VG VI AI MS GP MQ BL MF FK").split()),
}
ASIA_PACIFIC = set(("AU NZ JP KR KP SG MY ID PH TH VN KH LA MM BN TL IN PK BD LK NP BT MV AF CN HK MO TW MN KZ UZ KG TJ "
                    "TM AZ AM GE RU FJ PG SB VU NC PF WS TO KI TV NR MH FM PW GU MP AS CK NU NF TK WF IO CC CX").split())
COUNTRIES = sorted(set().union(*ZONES.values(), ASIA_PACIFIC))


def zone_for(country: str | None) -> str | None:
    code = (country or "").strip().upper()
    if len(code) != 2 or not code.isalpha():
        return None
    for zone, members in ZONES.items():
        if code in members:
            return zone
    return "asia_pacific"


def unit_price_for(breaks: list[dict], quantity: int) -> float | None:
    """The FayFort price per unit at a quantity: the highest break the quantity reaches."""
    price = None
    for step in sorted(breaks, key=lambda b: int(b["min_qty"])):
        if quantity >= int(step["min_qty"]):
            price = float(step["price"])
    return price


def landed(breaks: list[dict], weight_kg: Any, rate: dict | None) -> list[dict]:
    """Per price break: product price + air freight by weight + handling, per unit. Empty without a rate or weight."""
    if not breaks or not weight_kg or not rate or rate.get("air_per_kg") in (None, ""):
        return []
    freight = float(weight_kg) * float(rate["air_per_kg"]) + float(rate.get("handling_per_unit") or 0)
    return [{"min_qty": int(b["min_qty"]), "unit_price": round(float(b["price"]), 2),
             "freight_per_unit": round(freight, 2), "landed_per_unit": round(float(b["price"]) + freight, 2)}
            for b in sorted(breaks, key=lambda b: int(b["min_qty"]))]
