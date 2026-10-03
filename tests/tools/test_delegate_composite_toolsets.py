"""Tests for composite toolset expansion in delegate_task intersection."""

import unittest

from tools.delegate_tool import _expand_parent_toolsets, _strip_blocked_tools


class TestExpandParentToolsets(unittest.TestCase):
    """Verify _expand_parent_toolsets recognises individual toolsets within composites."""

    def test_composite_akramcode_cli_expands_web(self):
        """akramcode-cli includes web_search/web_extract → 'web' should be in expansion."""
        expanded = _expand_parent_toolsets({"akramcode-cli"})
        self.assertIn("web", expanded)
        self.assertIn("terminal", expanded)
        self.assertIn("browser", expanded)
        # Original composite is preserved
        self.assertIn("akramcode-cli", expanded)



    def test_included_toolsets_of_composite_parent_are_grantable(self):
        """A composite parent holds its ``includes`` too (#111700): ``debugging`` = terminal/process_manage +
        includes web/file, so a child may request ``web``/``file`` — but never a toolset the parent lacks."""
        expanded = _expand_parent_toolsets({"debugging"})
        self.assertTrue({"debugging", "terminal", "web", "file"} <= expanded)
        self.assertNotIn("browser", expanded)
        self.assertNotIn("akramcode-cli", expanded)

    def test_composites_with_allowed_included_tools_are_not_stripped(self):
        toolsets = ["safe", "akramcode-gateway", "akramcode-cli", "delegation", "kanban"]

        self.assertEqual(
            _strip_blocked_tools(toolsets),
            ["safe", "akramcode-gateway", "akramcode-cli"],
        )


if __name__ == "__main__":
    unittest.main()
