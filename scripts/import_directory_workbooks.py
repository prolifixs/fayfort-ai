from __future__ import annotations

import argparse
import json

from app.directory.ingestion import build_import_payloads, import_payloads


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Preview or explicitly import the FayFort directory workbook package."
    )
    parser.add_argument("--category-index", required=True)
    parser.add_argument("--services", required=True)
    parser.add_argument("--hotels", required=True)
    parser.add_argument("--restaurants", required=True)
    parser.add_argument(
        "--apply", action="store_true",
        help="Write normalized records to the configured Supabase project. Default is preview only.",
    )
    args = parser.parse_args()
    payloads = build_import_payloads(
        category_index=args.category_index,
        services=args.services,
        hotels=args.hotels,
        restaurants=args.restaurants,
    )
    counts = {table: len(rows) for table, rows in payloads.items()}
    if args.apply:
        counts = import_payloads(payloads)
        mode = "applied"
    else:
        mode = "preview_only"
    print(json.dumps({"mode": mode, "row_counts": counts}, indent=2))


if __name__ == "__main__":
    main()
