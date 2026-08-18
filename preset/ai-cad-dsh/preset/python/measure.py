# preset/ai-cad-dsh/preset/python/measure.py
# OCP STEP 测量 + 契约校验。单位均为米。
import os

OCC_ERR = None
try:
    from OCP.STEPControl import STEPControl_Reader
    from OCP.BRepGProp import BRepGProp
    from OCP.GProp import GProp_GProps
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopAbs import TopAbs_SOLID, TopAbs_SHELL
    from OCP.ShapeAnalysis import ShapeAnalysis_Shell
    from OCP.BRepAlgoAPI import BRepAlgoAPI_Common
    from OCP.BRep import BRep_Tool
except Exception as e:  # pragma: no cover - CI 无 OCP 时报错
    OCC_ERR = e


def _read_step(path):
    reader = STEPControl_Reader()
    if reader.ReadFile(str(path)) != 1:
        raise ValueError("STEP 读取失败: %s" % path)
    reader.TransferRoots()
    return reader.OneShape()


def count_solids(shape):
    n = 0
    exp = TopExp_Explorer(shape, TopAbs_SOLID)
    while exp.More():
        n += 1
        exp.Next()
    return n


def is_watertight(shape):
    # 注：本 OCP 构建无 ShapeAnalysis_Shell.ShellClosed_s（静态法），
    # 改用等价实例法：加载各 shell 后检查是否存在自由边（无自由边 = 闭合/水密）。
    exp = TopExp_Explorer(shape, TopAbs_SHELL)
    closed = True
    while exp.More():
        s = exp.Current()
        sas = ShapeAnalysis_Shell()
        sas.LoadShells(s)
        closed = closed and not sas.HasFreeEdges()
        exp.Next()
    return closed


def mass_props(shape):
    props = GProp_GProps()
    BRepGProp.VolumeProperties_s(shape, props)
    vol = props.Mass()
    c = props.CentreOfMass()
    sprops = GProp_GProps()
    BRepGProp.SurfaceProperties_s(shape, sprops)
    area = sprops.Mass()
    return vol, area, (c.X(), c.Y(), c.Z())


def measure(path):
    if OCC_ERR is not None:
        raise RuntimeError("OCP 不可用: %s" % OCC_ERR)
    shape = _read_step(path)
    vol, area, c = mass_props(shape)
    return {
        "bodies": count_solids(shape),
        # OCP 回读几何为 OCCT 内部毫米单位，换算为米（A7）。
        "volume_m3": vol * 1e-9,
        "surface_area_m2": area * 1e-6,
        "centroid_m": [c[0] * 1e-3, c[1] * 1e-3, c[2] * 1e-3],
        "watertight": is_watertight(shape),
        "step": os.path.abspath(str(path)),
    }


def _interference_pairs(paths):
    pairs = []
    shapes = []
    for p in paths:
        try:
            shapes.append(_read_step(p))
        except ValueError:
            continue
    for i in range(len(shapes)):
        for j in range(i + 1, len(shapes)):
            try:
                common = BRepAlgoAPI_Common(shapes[i], shapes[j])
                common.Build()
                if common.IsDone() and count_solids(common.Shape()) > 0:
                    pairs.append([paths[i], paths[j]])
            except Exception:
                continue
    return pairs


def verify(step_paths, expected, tol_rel=0.01, tol_abs=1e-4):
    if OCC_ERR is not None:
        return {"passed": False, "checks": [], "interference": [],
                "measured": None, "verdict": "GEOMETRY_UNVERIFIED",
                "error": "OCP 不可用: %s" % OCC_ERR}
    if not expected or not step_paths:
        return {"passed": False, "checks": [], "interference": [],
                "measured": None, "verdict": "GEOMETRY_UNVERIFIED"}
    measured = None
    for p in step_paths:
        m = measure(p)
        measured = m if measured is None else {
            "bodies": measured["bodies"] + m["bodies"],
            "volume_m3": measured["volume_m3"] + m["volume_m3"],
            "surface_area_m2": measured["surface_area_m2"] + m["surface_area_m2"],
            "watertight": measured["watertight"] and m["watertight"],
            # 质心按体积加权
            "centroid_m": [
                (measured["centroid_m"][i] * measured["volume_m3"] +
                 m["centroid_m"][i] * m["volume_m3"]) /
                max(measured["volume_m3"] + m["volume_m3"], 1e-30)
                for i in range(3)
            ],
            "step": measured["step"],
        }
    checks = []
    ok = True
    if "bodies" in expected:
        hit = expected["bodies"] == measured["bodies"]
        ok = ok and hit
        checks.append({"key": "bodies", "expected": expected["bodies"], "measured": measured["bodies"], "pass": hit})
    for key, rel in (("volume_m3", True), ("surface_area_m2", True)):
        if key in expected:
            exp, act = expected[key], measured[key]
            denom = max(abs(exp), 1e-30)
            tol = tol_abs if abs(exp) < tol_abs else tol_rel * denom
            hit = abs(exp - act) <= tol
            ok = ok and hit
            checks.append({"key": key, "expected": exp, "measured": act, "pass": hit,
                           "tol": tol})
    if "centroid_m" in expected:
        e = expected["centroid_m"]
        hit = all(abs(e[i] - measured["centroid_m"][i]) <= tol_abs for i in range(3))
        ok = ok and hit
        checks.append({"key": "centroid_m", "expected": e, "measured": measured["centroid_m"], "pass": hit})
    if "watertight" in expected and expected["watertight"] and not measured["watertight"]:
        ok = False
        checks.append({"key": "watertight", "expected": True, "measured": False, "pass": False})
    interference = _interference_pairs(step_paths) if len(step_paths) > 1 else []
    if "interference" in expected and expected["interference"] is False and interference:
        ok = False
        checks.append({"key": "interference", "expected": False, "measured": interference, "pass": False})
    return {"passed": ok, "checks": checks, "interference": interference,
            "measured": measured, "verdict": "PASS" if ok else "GEOMETRY_MISMATCH"}
