from __future__ import annotations

import unittest
from unittest.mock import patch

from app.database.directory.services import search_service_providers


class DirectorySearchTests(unittest.TestCase):
    @patch("app.database.directory.services.search_rows")
    def test_destination_request_only_returns_rows_that_name_the_destination(self, search_rows):
        search_rows.return_value = [
            {"service": "Global freight forwarder", "ships_to": "DHL, UPS, FedEx"},
            {"service": "West Africa consolidator", "ships_to": "Senegal and Mali"},
            {"service": "Multi-destination consolidator", "ships_to": "Senegal, Gambia, Guinea"},
        ]
        rows = search_service_providers("Find a freight forwarder that ships to Senegal.")
        self.assertEqual(len(rows), 2)
        self.assertTrue(all("senegal" in row["ships_to"].casefold() for row in rows))

    @patch("app.database.directory.services.search_rows")
    def test_destination_request_with_no_matching_destination_returns_no_rows(self, search_rows):
        search_rows.return_value = [
            {"service": "Global freight forwarder", "ships_to": "DHL, UPS, FedEx"},
        ]
        self.assertEqual(
            search_service_providers("Find a freight forwarder that ships to Senegal."),
            [],
        )


if __name__ == "__main__":
    unittest.main()
