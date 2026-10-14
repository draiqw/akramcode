import time
import unittest

from retrying import retry
from retrying.client import TransientError, fetch_config


class Flaky:
    def __init__(self, failures, exc=OSError):
        self.failures = failures
        self.exc = exc
        self.calls = []
        self.raised = []

    def __call__(self, *args, **kwargs):
        self.calls.append((args, kwargs))
        if len(self.calls) <= self.failures:
            err = self.exc(f"fail {len(self.calls)}")
            self.raised.append(err)
            raise err
        return "ok"


class HiddenRetry(unittest.TestCase):
    def test_backoff_delays(self):
        sleeps = []
        flaky = Flaky(3)
        wrapped = retry(max_attempts=5, base_delay=0.5, factor=3, sleep=sleeps.append)(flaky)
        self.assertEqual(wrapped(1, x=2), "ok")
        self.assertEqual(sleeps, [0.5, 1.5, 4.5])
        self.assertEqual(flaky.calls, [((1,), {"x": 2})] * 4)
        self.assertEqual(wrapped.last_attempts, 4)

    def test_max_delay_cap(self):
        sleeps = []
        wrapped = retry(max_attempts=5, base_delay=1, factor=2, max_delay=3, sleep=sleeps.append)(Flaky(4))
        self.assertEqual(wrapped(), "ok")
        self.assertEqual(sleeps, [1, 2, 3, 3])

    def test_reraises_last_exception(self):
        sleeps = []
        flaky = Flaky(10)
        wrapped = retry(max_attempts=3, base_delay=0.1, sleep=sleeps.append)(flaky)
        with self.assertRaises(OSError) as ctx:
            wrapped()
        self.assertIs(ctx.exception, flaky.raised[-1])
        self.assertEqual(len(flaky.calls), 3)
        self.assertEqual(sleeps, [0.1, 0.2])
        self.assertEqual(wrapped.last_attempts, 3)

    def test_non_matching_exception_propagates_immediately(self):
        sleeps = []
        flaky = Flaky(5, exc=KeyError)
        wrapped = retry(max_attempts=4, exceptions=(OSError,), sleep=sleeps.append)(flaky)
        with self.assertRaises(KeyError):
            wrapped()
        self.assertEqual(len(flaky.calls), 1)
        self.assertEqual(sleeps, [])
        self.assertEqual(wrapped.last_attempts, 1)

    def test_single_exception_class(self):
        sleeps = []
        wrapped = retry(max_attempts=2, exceptions=ValueError, sleep=sleeps.append)(Flaky(1, exc=ValueError))
        self.assertEqual(wrapped(), "ok")
        self.assertEqual(sleeps, [0.1])

    def test_subclass_is_retried(self):
        wrapped = retry(max_attempts=2, exceptions=(OSError,), sleep=lambda s: None)(Flaky(1, exc=TimeoutError))
        self.assertEqual(wrapped(), "ok")

    def test_single_attempt(self):
        sleeps = []
        flaky = Flaky(1)
        wrapped = retry(max_attempts=1, sleep=sleeps.append)(flaky)
        with self.assertRaises(OSError):
            wrapped()
        self.assertEqual(sleeps, [])

    def test_last_attempts_resets(self):
        flaky = Flaky(2)
        wrapped = retry(max_attempts=3, sleep=lambda s: None)(flaky)
        self.assertEqual(wrapped.last_attempts, 0)
        wrapped()
        self.assertEqual(wrapped.last_attempts, 3)
        wrapped()
        self.assertEqual(wrapped.last_attempts, 1)

    def test_wraps(self):
        @retry()
        def documented():
            """Docs here."""
            return 1

        self.assertEqual(documented.__name__, "documented")
        self.assertEqual(documented.__doc__, "Docs here.")

    def test_validation(self):
        for kwargs in (
            {"max_attempts": 0},
            {"max_attempts": -1},
            {"max_attempts": 1.5},
            {"base_delay": -0.1},
            {"factor": 0.5},
            {"max_delay": -1},
        ):
            with self.assertRaises(ValueError, msg=str(kwargs)):
                retry(**kwargs)

    def test_default_sleep_is_time_sleep_looked_up_at_call(self):
        sleeps = []
        original = time.sleep
        wrapped = retry(max_attempts=2, base_delay=0.25)(Flaky(1))
        time.sleep = sleeps.append
        try:
            self.assertEqual(wrapped(), "ok")
        finally:
            time.sleep = original
        self.assertEqual(sleeps, [0.25])

    def test_client(self):
        attempts = []

        def transport(path):
            attempts.append(path)
            if len(attempts) < 2:
                raise TransientError("try again")
            return '{"debug": true}'

        original = time.sleep
        time.sleep = lambda s: None
        try:
            self.assertEqual(fetch_config(transport, "/cfg"), {"debug": True})
        finally:
            time.sleep = original
        self.assertEqual(attempts, ["/cfg", "/cfg"])


if __name__ == "__main__":
    unittest.main()
