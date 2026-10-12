"""
Tests for awesome-link review helpers.
"""

import importlib.util
import sys
from pathlib import Path

PYTHON_ROOT = Path(__file__).resolve().parent.parent


def load_script_module(module_name: str, script_path: Path):
    spec = importlib.util.spec_from_file_location(module_name, script_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


review_script = load_script_module(
    "review_awesome_prompt_injection_links",
    PYTHON_ROOT / "scripts" / "data-prep" / "review_awesome_prompt_injection_links.py",
)


def test_parse_markdown_links_tracks_sections():
    text = """
# Title

## Tools
- [InjectLab](https://github.com/ahow2004/injectlab)

## Research Papers
- [Paper](https://arxiv.org/abs/1234.5678)
""".strip()

    links = review_script.parse_markdown_links(text)

    assert len(links) == 2
    assert links[0]["section"] == "Tools"
    assert links[0]["label"] == "InjectLab"
    assert links[1]["section"] == "Research Papers"
    assert review_script.classify_url(links[1]["url"]) == "paper"
