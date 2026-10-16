"""Working hours told to customers who ask for a person (Mon-Sat 9:30-18:30 China time)."""
import unittest
from datetime import datetime, timezone

from app.services import support_hours as hours

# China is UTC+8 all year.
def china(year, month, day, hour, minute=0):
    return datetime(year, month, day, hour - 8, minute, tzinfo=timezone.utc) if hour >= 8 else \
        datetime(year, month, day - 1, hour + 16, minute, tzinfo=timezone.utc)


class SupportHoursTests(unittest.TestCase):
    def test_label(self):
        self.assertEqual(hours.hours_label(), "Monday to Saturday, 9:30 to 18:30 China time")

    def test_open_on_a_weekday_afternoon(self):
        status = hours.support_status(china(2026, 10, 16, 14))  # Friday 14:00
        self.assertTrue(status.open)
        self.assertIn("within 30 minutes", hours.handoff_reply(china(2026, 10, 16, 14)))

    def test_saturday_evening_points_to_monday_morning(self):
        now = china(2026, 10, 17, 19)  # Saturday 19:00, closed; Sunday is a rest day
        status = hours.support_status(now)
        self.assertFalse(status.open)
        self.assertEqual(status.next_open_label(), "Monday at 9:30 China time")
        self.assertIn("Monday at 9:30 China time", hours.handoff_reply(now))

    def test_early_morning_opens_today(self):
        self.assertEqual(hours.support_status(china(2026, 10, 16, 8)).next_open_label(), "today at 9:30 China time")

    def test_ai_gets_the_time_in_china(self):
        self.assertIn("Now in China: Friday 14:00", hours.ai_time_context(china(2026, 10, 16, 14)))


if __name__ == "__main__":
    unittest.main()
