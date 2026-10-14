"""CSP headers: strict app policy + hashed debug policy."""
from server import csp


def test_app_csp_forbids_inline_scripts():
    assert "script-src 'self'" in csp.CSP_APP
    assert "'unsafe-inline'" not in csp.CSP_APP.split("style-src")[0]  # not on script-src
    assert "default-src 'self'" in csp.CSP_APP
    assert "frame-ancestors 'none'" in csp.CSP_APP


def test_debug_csp_hashes_inline_blocks():
    html = "<style>.a{color:red}</style><script>var x=1;</script>"
    policy = csp.build_csp_for_html(html)
    assert "script-src 'sha256-" in policy
    assert "style-src 'sha256-" in policy
    # hashes must match the exact byte content
    assert csp.sha256_b64("var x=1;") in policy
    assert csp.sha256_b64(".a{color:red}") in policy


def test_debug_csp_none_when_no_inline():
    policy = csp.build_csp_for_html("<p>hi</p>")
    assert "script-src 'none'" in policy and "style-src 'none'" in policy
