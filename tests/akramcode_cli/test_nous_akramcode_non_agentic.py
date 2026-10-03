"""Tests for the Nous-AkramCode-3/4 non-agentic warning detector.

Prior to this check, the warning fired on any model whose name contained
``"akramcode"`` anywhere (case-insensitive). That false-positived on unrelated
local Modelfiles such as ``akramcode-brain:qwen3-14b-ctx16k`` — a tool-capable
Qwen3 wrapper that happens to live under the "akramcode" tag namespace.

``is_nous_akramcode_non_agentic`` should only match the actual Nous Research
AkramCode-3 / AkramCode-4 chat family.
"""

from __future__ import annotations

import pytest

from akramcode_cli.model_switch import (
    _AKRAMCODE_MODEL_WARNING,
    _check_akramcode_model_warning,
    is_nous_akramcode_non_agentic,
)


@pytest.mark.parametrize(
    "model_name",
    [
        "NousResearch/AkramCode-3-Llama-3.1-70B",
        "NousResearch/AkramCode-3-Llama-3.1-405B",
        "akramcode-3",
        "AkramCode-3",
        "akramcode-4",
        "akramcode-4-405b",
        "akramcode_4_70b",
        "openrouter/akramcode3:70b",
        "openrouter/nousresearch/akramcode-4-405b",
        "NousResearch/AkramCode3",
        "akramcode-3.1",
    ],
)
def test_matches_real_nous_akramcode_chat_models(model_name: str) -> None:
    assert is_nous_akramcode_non_agentic(model_name), (
        f"expected {model_name!r} to be flagged as Nous AkramCode 3/4"
    )
    assert _check_akramcode_model_warning(model_name) == _AKRAMCODE_MODEL_WARNING


