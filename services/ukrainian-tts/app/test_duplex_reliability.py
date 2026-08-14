import unittest

from app.duplex_reliability import reliability_fault, run_duplex_reliability


class DuplexReliabilityTest(unittest.IsolatedAsyncioTestCase):
    async def test_runs_real_cycles_and_recovers_controlled_disconnects(self):
        calls = 0

        async def run_cycle():
            nonlocal calls
            calls += 1
            return {"scenarios": [{"id": "full-cycle"}]}

        report = await run_duplex_reliability(run_cycle, 10, True)

        self.assertEqual(report["passed"], 10)
        self.assertEqual(report["failed"], 0)
        self.assertEqual(report["recovered_faults"], 2)
        self.assertEqual(calls, 10)
        self.assertEqual(report["resources"]["threads_delta"], 0)
        self.assertEqual(len(report["results"]), 10)

    async def test_records_cycle_failure_without_aborting_the_suite(self):
        calls = 0

        async def run_cycle():
            nonlocal calls
            calls += 1
            if calls == 2:
                raise RuntimeError("STT failed")
            return {"scenarios": []}

        report = await run_duplex_reliability(run_cycle, 3, False)

        self.assertEqual(report["passed"], 2)
        self.assertEqual(report["failed"], 1)
        self.assertEqual(report["results"][1]["error"], "STT failed")

    def test_fault_schedule_is_deterministic(self):
        self.assertEqual(
            [reliability_fault(index) for index in range(10)],
            [None, "delayed-input", None, "transport-reconnect", None] * 2,
        )


if __name__ == "__main__":
    unittest.main()
