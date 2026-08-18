# tests/test_cad_backend/test_measure.py
import math
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "preset/ai-cad-dsh/preset/python"))

from measure import measure, verify


def test_measure_box(tmp_path):
    import build123d as b
    box = b.Box(0.1, 0.1, 0.1, align=(b.Align.MIN, b.Align.MIN, b.Align.MIN))
    step_path = tmp_path / "box.step"
    b.export_step(box, str(step_path), unit=b.Unit.M)
    m = measure(str(step_path))
    assert m["bodies"] == 1
    assert abs(m["volume_m3"] - 0.001) < 1e-12
    assert abs(m["surface_area_m2"] - 0.06) < 1e-9
    assert m["watertight"] is True
    c = m["centroid_m"]
    assert abs(c[0] - 0.05) < 1e-6 and abs(c[1] - 0.05) < 1e-6 and abs(c[2] - 0.05) < 1e-6
    assert m["step"] == str(step_path)


def test_verify_pass_and_mismatch(tmp_path):
    import build123d as b
    box = b.Box(0.1, 0.1, 0.1)
    p = tmp_path / "b.step"
    b.export_step(box, str(p), unit=b.Unit.M)
    r = verify([str(p)], {"bodies": 1, "volume_m3": 0.001, "surface_area_m2": 0.06})
    assert r["verdict"] == "PASS" and r["passed"] is True
    bad = verify([str(p)], {"bodies": 1, "volume_m3": 9.9})
    assert bad["verdict"] == "GEOMETRY_MISMATCH" and bad["passed"] is False


def test_verify_empty_contract_is_unverified(tmp_path):
    import build123d as b
    box = b.Box(0.1, 0.1, 0.1)
    p = tmp_path / "b.step"
    b.export_step(box, str(p), unit=b.Unit.M)
    r = verify([str(p)], {})
    assert r["verdict"] == "GEOMETRY_UNVERIFIED" and r["passed"] is False
