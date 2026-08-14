import asyncio
import os
import resource
import threading
import time


async def run_duplex_reliability(run_cycle, cycles: int, inject_faults: bool):
    started = time.perf_counter()
    before = runtime_snapshot()
    results = []

    for index in range(cycles):
        fault = reliability_fault(index) if inject_faults else None
        cycle_started = time.perf_counter()
        recovered = False
        error = None
        report = None
        try:
            if fault == "transport-reconnect":
                error = "Injected duplex transport disconnect before the cycle."
                recovered = True
            if fault == "delayed-input":
                await asyncio.sleep(0.05)
            report = await run_cycle()
        except Exception as exception:
            error = str(exception)
        results.append(
            {
                "cycle": index + 1,
                "fault": fault,
                "recovered": recovered,
                "passed": report is not None,
                "duration_ms": round((time.perf_counter() - cycle_started) * 1000),
                "error": error,
                "report": report,
                "resources": runtime_snapshot(),
            }
        )

    after = runtime_snapshot()
    return {
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "cycles": cycles,
        "passed": sum(1 for result in results if result["passed"]),
        "failed": sum(1 for result in results if not result["passed"]),
        "recovered_faults": sum(1 for result in results if result["recovered"]),
        "total_ms": round((time.perf_counter() - started) * 1000),
        "resources": {
            "before": before,
            "after": after,
            "rss_delta_bytes": after["rss_bytes"] - before["rss_bytes"],
            "steady_state_rss_delta_bytes": after["rss_bytes"]
            - (results[0]["resources"]["rss_bytes"] if results else before["rss_bytes"]),
            "threads_delta": after["threads"] - before["threads"],
            "steady_state_threads_delta": after["threads"]
            - (results[0]["resources"]["threads"] if results else before["threads"]),
            "file_descriptors_delta": after["file_descriptors"] - before["file_descriptors"],
        },
        "results": results,
    }


def reliability_fault(index: int):
    schedule = (None, "delayed-input", None, "transport-reconnect", None)
    return schedule[index % len(schedule)]


def runtime_snapshot():
    return {
        "rss_bytes": process_rss_bytes(),
        "peak_rss_bytes": peak_rss_bytes(),
        "threads": threading.active_count(),
        "file_descriptors": file_descriptor_count(),
    }


def process_rss_bytes():
    try:
        with open("/proc/self/statm", encoding="utf-8") as statm:
            pages = int(statm.read().split()[1])
        return pages * os.sysconf("SC_PAGE_SIZE")
    except (FileNotFoundError, IndexError, OSError, ValueError):
        return peak_rss_bytes()


def peak_rss_bytes():
    value = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return int(value if os.uname().sysname == "Darwin" else value * 1024)


def file_descriptor_count():
    try:
        return len(os.listdir("/proc/self/fd"))
    except OSError:
        return 0
