import type { FindItResult } from "./commerceApi";
import type { DirectoryProduct, ProductCategory } from "../workspace/types";

export type MemberShippingForm = {
  shipping_phone: string;
  shipping_address_line1: string;
  shipping_address_line2: string;
  shipping_city: string;
  shipping_region: string;
  shipping_postal_code: string;
  shipping_country: string;
};

export const emptyMemberShipping: MemberShippingForm = {
  shipping_phone: "",
  shipping_address_line1: "",
  shipping_address_line2: "",
  shipping_city: "",
  shipping_region: "",
  shipping_postal_code: "",
  shipping_country: "",
};

export function memberShippingFromProfile(profile: Record<string, unknown>): MemberShippingForm {
  return Object.fromEntries(
    Object.keys(emptyMemberShipping).map((key) => [key, String(profile[key] || "")]),
  ) as MemberShippingForm;
}

export const memberCountryCodes =
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW".split(
    " ",
  );

export const memberCountryNames = new Intl.DisplayNames(["en"], { type: "region" });

export const memberCountryOptions = memberCountryCodes
  .map((code) => ({ code, name: memberCountryNames.of(code) || code }))
  .sort((a, b) => a.name.localeCompare(b.name));

export const memberDialCodes: Record<string, string> = {
  US: "+1",
  CA: "+1",
  GB: "+44",
  AU: "+61",
  NZ: "+64",
  IE: "+353",
  FR: "+33",
  DE: "+49",
  ES: "+34",
  IT: "+39",
  PT: "+351",
  NL: "+31",
  BE: "+32",
  CH: "+41",
  AT: "+43",
  SE: "+46",
  NO: "+47",
  DK: "+45",
  FI: "+358",
  IS: "+354",
  PL: "+48",
  CZ: "+420",
  SK: "+421",
  HU: "+36",
  RO: "+40",
  GR: "+30",
  TR: "+90",
  UA: "+380",
  RU: "+7",
  IL: "+972",
  AE: "+971",
  SA: "+966",
  IN: "+91",
  PK: "+92",
  BD: "+880",
  LK: "+94",
  NP: "+977",
  CN: "+86",
  HK: "+852",
  TW: "+886",
  JP: "+81",
  KR: "+82",
  SG: "+65",
  MY: "+60",
  TH: "+66",
  VN: "+84",
  ID: "+62",
  PH: "+63",
  BR: "+55",
  MX: "+52",
  AR: "+54",
  CL: "+56",
  CO: "+57",
  PE: "+51",
  ZA: "+27",
  NG: "+234",
  KE: "+254",
  EG: "+20",
  MA: "+212",
  GH: "+233",
  JM: "+1",
  PR: "+1",
  DO: "+1",
  TT: "+1",
  BB: "+1",
  BS: "+1",
  BZ: "+501",
  CR: "+506",
  PA: "+507",
  GT: "+502",
  HN: "+504",
  SV: "+503",
  NI: "+505",
  UY: "+598",
  PY: "+595",
  BO: "+591",
  EC: "+593",
  VE: "+58",
  ISL: "+354",
};

export const memberDialOptions = memberCountryOptions
  .map((country) => ({ ...country, dial: memberDialCodes[country.code] || "" }))
  .filter((country) => country.dial);

export function splitMemberPhone(value: string): { country: string; number: string } {
  const normalized = value.trim();
  if (!normalized) return { country: "US", number: "" };
  const match = memberDialOptions
    .map((option) => option.dial)
    .sort((a, b) => b.length - a.length)
    .find((dial) => normalized.startsWith(dial));
  return match
    ? {
        country:
          memberDialOptions.find((option) => option.dial === match && option.code === "US")?.code ||
          memberDialOptions.find((option) => option.dial === match)?.code ||
          "US",
        number: normalized.slice(match.length).trim(),
      }
    : { country: "INTL", number: normalized };
}

export function formatMemberTier(value: unknown): string {
  const tier = value === "standard" || value === "pro" ? value : "free";
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

export type MemberCatalogProduct = {
  id: string;
  name: string;
  category_ref: string;
  description: string;
  availability_status: DirectoryProduct["availability_status"];
  media_url?: string | null;
  media_type?: DirectoryProduct["media_type"];
  media_source?: DirectoryProduct["media_source"];
};

export type MemberCatalog = {
  products: MemberCatalogProduct[];
  saved_product_ids: string[];
  categories: ProductCategory[];
};

export type MemberChat = {
  id: string;
  title: string;
  linked_request_id?: string | null;
  retention_hold: boolean;
  support_work_item_id?: string | null;
  support_status?: string | null;
  last_activity_at: string;
  created_at: string;
  /** Archived chats are kept as the record but leave the chat list (docs/MEMBER_DASHBOARD_UX_PLAN.md §1). */
  archived_at?: string | null;
  archived_by?: "member" | "auto" | null;
};

export type MemberChatMessage = {
  id: string;
  sender_type: "member" | "assistant" | "worker";
  content: string;
  related_product_ids: string[];
  created_at: string;
  /** Find It result for a pasted link or search: exact match, closest alternatives, Source it. */
  find_it?: FindItResult | null;
  /** The product the member asked about from a product page. */
  product_ref?: string | null;
  /** First name and photo of the FayFort team member who wrote a "worker" message. */
  staff?: { first_name: string; photo_url: string | null } | null;
};

export type MemberOwnedRequest = {
  id: string;
  conversation_id?: string | null;
  request_title: string;
  request_description?: string | null;
  product_name_snapshot?: string | null;
  created_at?: string;
  events: {
    id?: string;
    sequence_no?: number;
    stage: string;
    member_note?: string | null;
    details?: { carrier_name?: string; tracking_number?: string; tracking_url?: string };
    created_at?: string;
  }[];
};
