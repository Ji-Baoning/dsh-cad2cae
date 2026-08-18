"""子进程编译：交付物①源码 → 交付物② STEP 文件。"""
import os
import re
import subprocess
from dataclasses import dataclass, field

from cad_codegen.part_gen import CodegenError

# I1（最终审查）纵深防御：模块名直接用于 os.path.join(out_dir, name + '.py') 与
# 子进程 python name.py，若含 '/'、'..' 可写出 out_dir 或执行任意路径脚本。
# Plan A 已把 part_ref 限定为合法标识符，此守卫兜底任何绕过校验的调用方。
_IDENTIFIER_RE = re.compile(r'^[A-Za-z_][A-Za-z0-9_]*$')


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
        if not _IDENTIFIER_RE.match(name):
            raise CodegenError("模块名 '" + str(name) + "' 不是合法 Python 标识符"
                               + "（[A-Za-z_][A-Za-z0-9_]*），拒绝写出文件")
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
