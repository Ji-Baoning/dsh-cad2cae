"""install-dsh-preset.mjs 的集成测试。

用临时 DSH_HOME 以子进程运行安装脚本，断言目录结构、backendDir 改写、
测试/缓存文件排除、幂等、--force 与 --dry-run 行为；
并对安装产物做端到端挂载验证（导入入口 + apply，覆盖 node_modules 链接、
schemastery 导入形式、parameters 属性映射格式三个历史 bug）。
"""

import os
import subprocess
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
SCRIPT = REPO / "install-dsh-preset.mjs"
PRESET_SRC = REPO / "preset" / "ai-cad-dsh" / "preset"

TARGET_FILES = [
    "preset.yml",
    "agent.cordis.yml",
    "ai-cad-plugin.js",
    "lib/backend.js",
    "lib/python.js",
    "lib/questions.js",
    "lib/register.js",
    "lib/state.js",
    "lib/tools.js",
    "python/backend_cli.py",
    "python/measure.py",
]


def run_script(dsh_home, *args):
    env = dict(os.environ)
    env["DSH_HOME"] = str(dsh_home)
    return subprocess.run(
        ["node", str(SCRIPT), *args],
        cwd=REPO,
        env=env,
        capture_output=True,
        text=True,
    )


def target_dir(dsh_home, preset_id="ai-cad"):
    return Path(dsh_home) / ".agent-presets" / preset_id


def installed_composition(dsh_home, preset_id="ai-cad"):
    return (target_dir(dsh_home, preset_id) / "agent.cordis.yml").read_text("utf-8")


def expected_backend_dir():
    return str(REPO / "src").replace("\\", "/")


def installed_tree(dsh_home, preset_id="ai-cad"):
    return "\n".join(
        str(p.relative_to(target_dir(dsh_home, preset_id)))
        for p in target_dir(dsh_home, preset_id).rglob("*")
        if p.is_file()
    )


def test_install_creates_clean_preset(tmp_path):
    result = run_script(tmp_path)
    assert result.returncode == 0, result.stderr
    for rel in TARGET_FILES:
        assert (target_dir(tmp_path) / rel).is_file(), f"缺 {rel}"
    tree = installed_tree(tmp_path)
    assert "test.js" not in tree
    assert "lib/test" not in tree
    assert "__pycache__" not in tree
    assert ".pyc" not in tree
    assert f"backendDir: '{expected_backend_dir()}'" in installed_composition(tmp_path)
    # 仓库源文件保持原样（backendDir 仍为空）
    source = (PRESET_SRC / "agent.cordis.yml").read_text("utf-8")
    assert "backendDir: ''" in source


def test_second_run_idempotent(tmp_path):
    first = run_script(tmp_path)
    assert first.returncode == 0, first.stderr
    comp_after_first = installed_composition(tmp_path)
    second = run_script(tmp_path)
    assert second.returncode == 0, second.stderr
    assert "已就绪" in second.stdout
    assert installed_composition(tmp_path) == comp_after_first


def test_force_overwrites(tmp_path):
    result = run_script(tmp_path)
    assert result.returncode == 0
    marker = target_dir(tmp_path) / "MARKER"
    marker.write_text("x")
    result = run_script(tmp_path, "--force")
    assert result.returncode == 0, result.stderr
    assert not marker.exists()
    assert "已删除旧目录" in result.stdout


def test_stale_backenddir_selfheal(tmp_path):
    result = run_script(tmp_path)
    assert result.returncode == 0
    comp_path = target_dir(tmp_path) / "agent.cordis.yml"
    comp_path.write_text(
        comp_path.read_text("utf-8").replace(
            f"backendDir: '{expected_backend_dir()}'",
            "backendDir: '/old/path/src'",
        ),
        "utf-8",
    )
    result = run_script(tmp_path)
    assert result.returncode == 0, result.stderr
    assert f"backendDir: '{expected_backend_dir()}'" in installed_composition(tmp_path)


def test_dry_run_writes_nothing(tmp_path):
    result = run_script(tmp_path, "--dry-run")
    assert result.returncode == 0, result.stderr
    assert "dry-run" in result.stdout
    assert not (Path(tmp_path) / ".agent-presets").exists()


def test_invalid_id_rejected(tmp_path):
    result = run_script(tmp_path, "--id", "Bad_ID")
    assert result.returncode != 0
    assert "非法" in result.stderr
    assert not (Path(tmp_path) / ".agent-presets").exists()


def test_installed_preset_links_harness_deps(tmp_path):
    """安装产物应带 node_modules/@deepseek-ai/{dsh-tools,schemastery} 符号链接。"""
    result = run_script(tmp_path)
    assert result.returncode == 0, result.stderr
    scope = target_dir(tmp_path) / "node_modules" / "@deepseek-ai"
    for name in ("dsh-tools", "schemastery"):
        link = scope / name
        assert link.is_symlink(), f"缺符号链接 {name}"
        assert link.resolve().is_dir(), f"{name} 链接目标不是目录"


def test_installed_preset_applies(tmp_path):
    """端到端：安装后的预设入口可被 node 导入并 apply（mock ctx），注册 23 个 cad_* 工具。

    一次性覆盖三个历史挂载 bug：
      1) 缺 node_modules → 插件 import '@deepseek-ai/dsh-tools' 解析失败（Cannot find package）；
      2) schemastery 命名导入 { z } → 模块加载失败（ESM 只导出默认值）；
      3) parameters 旧包裹式/缺 additionalProperties → 真实 defineTool 编译抛错。
    harness 未安装（无链接）时跳过。
    """
    result = run_script(tmp_path)
    assert result.returncode == 0, result.stderr
    link = target_dir(tmp_path) / "node_modules" / "@deepseek-ai" / "dsh-tools"
    if not link.is_symlink():
        pytest.skip("未找到 dsh harness，跳过端到端 apply 验证")

    entry = target_dir(tmp_path) / "ai-cad-plugin.js"
    node_src = (
        "import { pathToFileURL } from 'node:url';\n"
        "const mod = await import(pathToFileURL(process.argv[1]).href);\n"
        "let n = 0;\n"
        "const ctx = {\n"
        "  systemPrompt: { section: () => {} },\n"
        "  tools: { register: (t) => { n++; if (!t.name.startsWith('cad_')) throw new Error('bad tool name ' + t.name); } },\n"
        "};\n"
        "await mod.apply(ctx, { backendDir: process.argv[2] });\n"
        "if (n !== 23) throw new Error('expected 23 tools, got ' + n);\n"
        "console.log('APPLY_OK tools=' + n);\n"
    )
    run = subprocess.run(
        ["node", "--input-type=module", "-e", node_src, str(entry), str(REPO / "src")],
        capture_output=True,
        text=True,
    )
    assert run.returncode == 0, f"apply 失败：{run.stderr}\nstdout={run.stdout}"
    assert "APPLY_OK tools=23" in run.stdout
