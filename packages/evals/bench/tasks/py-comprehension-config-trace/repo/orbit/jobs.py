"""Job queue (unrelated to configuration resolution)."""

from collections import deque


class JobQueue:
    def __init__(self, max_workers: int):
        self.max_workers = max_workers
        self._jobs: deque = deque()

    def push(self, job) -> None:
        self._jobs.append(job)

    def drain(self) -> list:
        out = []
        while self._jobs:
            out.append(self._jobs.popleft()())
        return out
