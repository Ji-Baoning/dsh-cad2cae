# preset/ai-cad-dsh/preset/python/render_preview.py
# STEP → 静态预览 PNG：BRepMesh 三角化 + numpy 软件光栅化。
# 设计动机：OCP 的 GL 离屏渲染依赖 X/GLX（此环境 BadWindow 不稳定），改用纯 numpy
# 光栅化 —— 无 X/GL 依赖、输出字节确定性（可直接断言 PNG 签名/尺寸/哈希）。
# 变换契约与 viewer_manifest.build_manifest 一致：16 float 行主序 4×4，第 4 列 = 平移。
import struct
import zlib

import numpy as np

_OCP_ERR = None
try:
    from OCP.BRepBndLib import BRepBndLib
    from OCP.BRep import BRep_Tool
    from OCP.BRepMesh import BRepMesh_IncrementalMesh
    from OCP.Bnd import Bnd_Box
    from OCP.TopAbs import TopAbs_FACE
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopLoc import TopLoc_Location
    from OCP.TopoDS import TopoDS
except Exception as e:  # pragma: no cover - CI 无 OCP 时纯光栅化部分仍可测
    _OCP_ERR = e

# 默认视点：方位 45°、俯仰 35.264°（标准等轴测）。
_AZ, _EL = 45.0, 35.264
# 默认输出尺寸（像素）。
_SIZE = (640, 480)


def _transform_point(x, y, z, t):
    """16 float 行主序 4×4 变换：x' = m[0]x+m[4]y+m[8]z+m[12]（与 manifest transform 同语义）。"""
    return (
        t[0] * x + t[4] * y + t[8] * z + t[12],
        t[1] * x + t[5] * y + t[9] * z + t[13],
        t[2] * x + t[6] * y + t[10] * z + t[14],
    )


def triangulate_shape(shape, deflection=None):
    """对 shape 做 BRepMesh 细分，返回三角面列表（世界坐标，元组三元组 (3,) float）。

    无 OCP 时抛 RuntimeError；返回的三角形可被 render_triangles 消费。
    """
    if _OCP_ERR is not None:
        raise RuntimeError('OCP 不可用: %s' % _OCP_ERR)
    if deflection is None:
        box = Bnd_Box()
        BRepBndLib.Add_s(shape, box)
        cmin, cmax = box.CornerMin(), box.CornerMax()
        size = max(cmax.X() - cmin.X(), cmax.Y() - cmin.Y(), cmax.Z() - cmin.Z())
        deflection = max(size * 0.01, 1e-6)
    BRepMesh_IncrementalMesh(shape, deflection, False).Perform()
    tris = []
    exp = TopExp_Explorer(shape, TopAbs_FACE)
    while exp.More():
        face = TopoDS.Face_s(exp.Current())
        loc = TopLoc_Location()
        tri = BRep_Tool.Triangulation_s(face, loc)
        if tri is not None and tri.NbTriangles() > 0:
            trsf = loc.Transformation()
            nodes = []
            for i in range(1, tri.NbNodes() + 1):
                n = tri.Node(i)
                p = n.Transformed(trsf)
                nodes.append((p.X(), p.Y(), p.Z()))
            for j in range(1, tri.NbTriangles() + 1):
                i1, i2, i3 = tri.Triangle(j).Get()
                tris.append((nodes[i1 - 1], nodes[i2 - 1], nodes[i3 - 1]))
        exp.Next()
    return tris


def _transform_tris(tris, t):
    """把三角面按 16 float 变换；返回 list of np.ndarray (3,3)。"""
    out = []
    for a, b, c in tris:
        out.append(np.array([
            _transform_point(*a, t), _transform_point(*b, t), _transform_point(*c, t),
        ], dtype=np.float64))
    return out


def _shade(normals, light=(0.45, 0.8, 0.35)):
    """平面着色：ambient + diffuse*max(0, n·l)，返回 (R,G,B) uint8 数组（每面一色）。"""
    ln = np.linalg.norm(light)
    l = np.array(light, dtype=np.float64) / ln
    ns = np.array(normals, dtype=np.float64)
    ns /= np.maximum(np.linalg.norm(ns, axis=1, keepdims=True), 1e-12)
    diff = np.maximum(np.sum(ns * l, axis=1), 0.0)
    shade = 0.25 + 0.75 * diff  # ambient 0.25
    rgb = np.clip(shade[:, None] * np.array([224, 220, 208], dtype=np.float64), 0, 255)
    return rgb.astype(np.uint8)


def _project(tris, w, h):
    """等轴测正交投影 → 屏幕坐标 + 深度（每面一色，含平面法线着色）。"""
    if not tris:
        return []
    verts = np.vstack([t for t in tris])  # (N,3)
    lo, hi = verts.min(0), verts.max(0)
    center = (lo + hi) / 2.0
    extent = max(float(np.max(hi - lo)), 1e-9)
    scale = min(w, h) * 0.8 / extent

    a, e = np.radians(_AZ), np.radians(_EL)
    ca, sa, ce, se = np.cos(a), np.sin(a), np.cos(e), np.sin(e)
    right = np.array([ca, sa, 0.0])                 # 屏幕 +x
    up = np.array([-sa * ce, ca * ce, se])          # 屏幕 +y（向上）
    into = np.cross(right, up)                      # 朝向相机的深度轴
    into /= max(np.linalg.norm(into), 1e-12)

    normals = []
    for a_, b_, c_ in tris:
        n = np.cross(b_ - a_, c_ - a_)
        normals.append(n)
    colors = _shade(normals)

    win = []
    for k, (a_, b_, c_) in enumerate(tris):
        pts = []
        ds = []
        for v in (a_, b_, c_):
            d = v - center
            sx = float(np.dot(d, right)) * scale + w / 2.0
            sy = h / 2.0 - float(np.dot(d, up)) * scale
            depth = float(np.dot(d, into))
            pts.append((sx, sy))
            ds.append(depth)
        win.append((pts[0], pts[1], pts[2], ds[0], ds[1], ds[2], colors[k]))
    return win


def _rasterize(win, w, h):
    img = np.full((h, w, 3), 250, dtype=np.uint8)   # 浅灰背景
    zbuf = np.full((h, w), np.inf, dtype=np.float32)
    for p0, p1, p2, d0, d1, d2, c in win:
        x0 = int(np.floor(min(p0[0], p1[0], p2[0])))
        x1 = int(np.ceil(max(p0[0], p1[0], p2[0])))
        y0 = int(np.floor(min(p0[1], p1[1], p2[1])))
        y1 = int(np.ceil(max(p0[1], p1[1], p2[1])))
        x0, x1 = max(x0, 0), min(x1, w)
        y0, y1 = max(y0, 0), min(y1, h)
        if x0 >= x1 or y0 >= y1:
            continue
        xs, ys = np.meshgrid(np.arange(x0, x1, dtype=np.float32),
                             np.arange(y0, y1, dtype=np.float32))
        px, py = xs.ravel(), ys.ravel()
        v0x, v0y = p1[0] - p0[0], p1[1] - p0[1]
        v1x, v1y = p2[0] - p0[0], p2[1] - p0[1]
        den = v0x * v1y - v1x * v0y
        if abs(den) < 1e-12:
            continue
        v2x, v2y = px - p0[0], py - p0[1]
        s = (v2x * v1y - v1x * v2y) / den
        t = (v0x * v2y - v2x * v0y) / den
        inside = (s >= 0) & (t >= 0) & (s + t <= 1)
        if not inside.any():
            continue
        z = d0 * (1 - s - t) + d1 * s + d2 * t
        yy = py[inside].astype(np.int32)
        xx = px[inside].astype(np.int32)
        frag_z = z[inside]
        depth_ok = frag_z < zbuf[yy, xx]
        sel = yy[depth_ok], xx[depth_ok]
        zbuf[sel] = frag_z[depth_ok]
        img[sel] = c
    return img


def _png_chunk(tag, data):
    chunk = tag + data
    return struct.pack('>I', len(data)) + chunk + struct.pack('>I', zlib.crc32(chunk) & 0xffffffff)


def write_png(path, w, h, rgb):
    """把 (h,w,3) uint8 写成最小 PNG（8-bit RGB，非隔行）。"""
    rows = [b'\x00' + bytes(rgb[y].tobytes()) for y in range(h)]
    raw = b''.join(rows)
    ihdr = struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)
    png = (b'\x89PNG\r\n\x1a\n'
           + _png_chunk(b'IHDR', ihdr)
           + _png_chunk(b'IDAT', zlib.compress(raw, 9))
           + _png_chunk(b'IEND', b''))
    with open(path, 'wb') as f:
        f.write(png)


def render_triangles(tris, out_path, size=None):
    """把三角面列表渲染为 PNG。返回 (width, height, tri_count)。"""
    w, h = size or _SIZE
    win = _project(tris, w, h)
    img = _rasterize(win, w, h)
    write_png(out_path, w, h, img)
    return (w, h, len(tris))
