# preset/ai-cad-dsh/preset/python/backend_cli.py
# DSH AI-CAD 后端 CLI：把 Plan A/B + measure 包装为 JSON 子进程协议。
import argparse
import json
import os
import sys


def _import_plans(backend_dir):
    sys.path.insert(0, backend_dir)
    from cad_intent import validate_intent          # noqa: F401
    from cad_codegen import generate_sources, compile_sources  # noqa: F401
    return validate_intent, generate_sources, compile_sources


def cmd_health(backend_dir):
    py = sys.executable
    ocp = "NOT_FOUND"
    try:
        import OCP  # noqa: F401
        ocp = "OK"
    except Exception:
        pass
    return {"ok": ocp == "OK", "python": py, "ocp": ocp}


def cmd_validate(backend_dir, payload):
    validate_intent, _, _ = _import_plans(backend_dir)
    return {"errors": validate_intent(payload)}


def cmd_generate(backend_dir, payload, out_dir):
    validate_intent, generate_sources, _ = _import_plans(backend_dir)
    errors = validate_intent(payload)
    if errors:
        return {"ok": False, "errors": errors}
    sources = generate_sources(payload)
    parts_dir = os.path.join(out_dir, "parts")
    os.makedirs(parts_dir, exist_ok=True)
    written = []
    for name, src in sources.items():
        path = os.path.join(parts_dir, name + ".py")
        with open(path, "w", encoding="utf-8") as f:
            f.write(src)
        written.append(os.path.relpath(path, out_dir))
    return {"ok": True, "written": written, "intent_snapshot": payload}


def cmd_compile(backend_dir, payload, out_dir):
    _, generate_sources, compile_sources = _import_plans(backend_dir)
    # compile_sources 接收的是 {模块名: 源码字符串} 字典，先由 intent 经
    # generate_sources 生成源码字典，再编译（而非直接把 intent 传给编译）。
    sources = generate_sources(payload)
    result = compile_sources(sources, out_dir=out_dir)
    # A5（最终审查修订）：artifacts 为 dict {name: STEP 绝对路径}；relpath 基准 = backend_dir
    # 的父目录（= 仓库根，backend.js 恒传 REPO_ROOT/src），而非进程 CWD。原实现依赖子进程
    # CWD == 仓库根，一旦宿主忽略 cwd 选项（测试 mock 曾如此）即产出 ../../cad-state/... 的
    # 错位路径。改为从 backend_dir 推导仓库根后，artifacts 恒为仓库相对路径，供 JS 侧
    # resolve(REPO_ROOT, a)。
    repo_root = os.path.dirname(os.path.abspath(backend_dir))
    artifacts = [os.path.relpath(a, repo_root) for a in result.artifacts.values()]
    return {"ok": result.ok, "steps": result.steps, "artifacts": artifacts}


def cmd_measure(backend_dir, payload):
    from measure import measure
    try:
        m = measure(payload["step_path"])
        return {"ok": True, "measured": m}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def cmd_verify(backend_dir, payload):
    from measure import verify
    return verify(payload.get("step_paths", []), payload.get("expected", {}))


def cmd_manifest(backend_dir, payload, out_dir):
    from viewer_manifest import build_manifest
    wf = payload.get("workflow_id", "default")
    intent = payload.get("intent") or {}
    # 与 cmd_compile 同款推导：仓库根 = backend_dir（<repo>/src）的父目录。
    repo_root = os.path.dirname(os.path.abspath(backend_dir))
    m = build_manifest(out_dir, intent, repo_root=repo_root)
    m["workflow_id"] = wf
    return {"ok": True, "manifest": m}


def main():
    ap = argparse.ArgumentParser(description="AI-CAD 后端 CLI")
    ap.add_argument("--backend-dir", required=True)
    ap.add_argument("command", choices=["health", "validate", "generate", "compile",
                                        "measure", "verify", "manifest"])
    ap.add_argument("--payload", required=True)
    ap.add_argument("--out-dir", default=os.getcwd())
    args = ap.parse_args()

    try:
        payload = json.loads(args.payload)
        if args.command == "health":
            result = cmd_health(args.backend_dir)
        elif args.command == "validate":
            result = cmd_validate(args.backend_dir, payload)
        elif args.command == "generate":
            result = cmd_generate(args.backend_dir, payload, args.out_dir)
        elif args.command == "compile":
            result = cmd_compile(args.backend_dir, payload, args.out_dir)
        elif args.command == "measure":
            result = cmd_measure(args.backend_dir, payload)
        elif args.command == "manifest":
            result = cmd_manifest(args.backend_dir, payload, args.out_dir)
        else:
            result = cmd_verify(args.backend_dir, payload)
        print(json.dumps(result, ensure_ascii=False, default=str))
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False))
        sys.exit(1)


if __name__ == "__main__":
    main()
