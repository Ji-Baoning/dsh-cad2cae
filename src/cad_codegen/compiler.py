"""子进程编译：交付物①源码 → 交付物② STEP 文件。"""
import os
import subprocess
from dataclasses import dataclass, field


@dataclass
class CompileResult:
    ok: bool
    steps: list = field(default_factory=list)      # [(name, ok, msg)]
    artifacts: dict = field(default_factory=dict)  # name → STEP 绝对路径


def compile_sources(sources, out_dir, python='python3'):
    """把 {模块名: 源码} 写入 out_dir，逐模块以子进程执行导出 STEP。

    执行 cwd=out_dir：装配模块的 import_module('hub') 可解析零件模块。
    """
    os.makedirs(out_dir, exist_ok=True)
    for name, src in sources.items():
        with open(os.path.join(out_dir, name + '.py'), 'w', encoding='utf-8') as f:
            f.write(src)
    steps = []
    artifacts = {}
    for name in sources:
        proc = subprocess.run([python, name + '.py'], cwd=out_dir,
                              capture_output=True, text=True, timeout=300)
        if proc.returncode != 0:
            steps.append((name, False, (proc.stderr or proc.stdout)[:2000]))
            continue
        step = os.path.join(out_dir, name + '.step')
        artifacts[name] = step
        steps.append((name, True, 'STEP 已生成'))
    return CompileResult(ok=all(ok for _, ok, _ in steps), steps=steps, artifacts=artifacts)
