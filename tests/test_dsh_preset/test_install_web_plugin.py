"""install-web-plugin.mjs 的集成测试。

沿 test_install_script.py 的临时 DSH_HOME 模式：以子进程运行 web 插件安装，
断言幂等（patch 追加一次、二次不重复）、patch 形状、链接可解析（resolve 到
仓库 web 包目录）、dry-run 不写盘，以及并入 install-dsh-preset.mjs 主流程后的
[web] 输出与 --no-web 跳过。

纯函数语义不在此重实现（不测自身的复制品）：真实 appendPluginPatch 通过
node -e 探针黑盒断言输出形状，幂等性由 --self-test 自检与探针共同覆盖。
"""

import json
import os
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
WEB_SCRIPT = REPO / "install-web-plugin.mjs"
WEB_PKG_DIR = REPO / "preset" / "ai-cad-dsh" / "web"
WEB_PKG_NAME = "@ai-cad/cad3d-preview"
WEB_ENTRY_ID = "cad3d-preview"


def run_web_script(dsh_home, *args):
    env = dict(os.environ)
    env["DSH_HOME"] = str(dsh_home)
    return subprocess.run(
        ["node", str(WEB_SCRIPT), *args],
        cwd=REPO,
        env=env,
        capture_output=True,
        text=True,
    )


def web_profile(dsh_home):
    return Path(dsh_home) / "profiles" / "web"


def web_plugin_link(dsh_home):
    return web_profile(dsh_home) / "node_modules" / "@ai-cad" / "cad3d-preview"


def installed_patch(dsh_home):
    return (web_profile(dsh_home) / "cordis.patch.yml").read_text("utf-8")


def test_self_test_ok():
    """--self-test 在 parseArgs 之前短路，用真实 appendPluginPatch 做幂等自检，退出 0。"""
    res = subprocess.run(
        ["node", str(WEB_SCRIPT), "--self-test"],
        capture_output=True,
        text=True,
    )
    assert res.returncode == 0, res.stderr
    assert "self-test OK" in res.stdout


def test_append_patch_shape_and_idempotence_via_probe():
    """黑盒探针真实导出的 appendPluginPatch：追加一次、二次幂等、形状正确。"""
    probe = (
        "import { appendPluginPatch } from './install-web-plugin.mjs';\n"
        "const once = appendPluginPatch('# patch\\n[]\\n');\n"
        "const twice = appendPluginPatch(once);\n"
        # 坏状态：占位符 `[]` 与条目并存（旧版安装器直接追加的产物）→ 自愈为规范形态
        "const broken = once.replace('# @ai-cad', '[]\\n# @ai-cad', 1);\n"
        "const healed = appendPluginPatch(broken);\n"
        "process.stdout.write(JSON.stringify({ once, twice, same: once === twice, healed }));\n"
    )
    res = subprocess.run(
        ["node", "--input-type=module", "-e", probe],
        cwd=REPO,
        capture_output=True,
        text=True,
    )
    assert res.returncode == 0, res.stderr
    data = json.loads(res.stdout)
    once = data["once"]
    assert data["same"], "appendPluginPatch 非幂等"
    assert f"- id: {WEB_ENTRY_ID}" in once
    assert f"name: '{WEB_PKG_NAME}'" in once
    # 原文本尾随换行被规范化：追加块前不留多余空行
    assert "\n\n\n" not in once
    # dsh 默认占位符 `[]` 须被移除：`[]` + `- insert:` 是两文档粘连，YAML 解析失败
    assert "[]" not in once, "占位符 [] 未被移除——dsh web 将报 end of the stream"
    # 坏状态（占位符与条目并存，旧版安装器直接追加的产物）自愈为与全新安装一致的规范形态
    assert data["healed"] == once, "已坏 patch 未自愈为规范形态"


def test_install_creates_profile_and_link_and_patch(tmp_path):
    """完整安装：建 profile 目录、建可解析链接、patch 追加 - insert 条目。"""
    result = run_web_script(tmp_path)
    assert result.returncode == 0, result.stderr
    link = web_plugin_link(tmp_path)
    assert link.is_symlink(), "缺 web 插件符号链接"
    assert link.resolve().is_dir(), "链接目标不是目录"
    assert link.resolve() == WEB_PKG_DIR.resolve(), "链接应解析到仓库 web 包目录"
    assert (web_profile(tmp_path) / "node_modules").is_dir()
    patch = installed_patch(tmp_path)
    assert f"- id: {WEB_ENTRY_ID}" in patch
    assert f"name: '{WEB_PKG_NAME}'" in patch


def test_second_run_idempotent(tmp_path):
    """二次运行：patch 不再追加（id 已存在跳过），链接指向不变。"""
    first = run_web_script(tmp_path)
    assert first.returncode == 0, first.stderr
    patch_after_first = installed_patch(tmp_path)
    second = run_web_script(tmp_path)
    assert second.returncode == 0, second.stderr
    assert installed_patch(tmp_path) == patch_after_first
    assert "patched=false" in second.stdout


def test_dry_run_writes_nothing(tmp_path):
    """--dry-run 打印路径且不写盘（无 profile 目录、无链接、无 patch）。"""
    result = run_web_script(tmp_path, "--dry-run")
    assert result.returncode == 0, result.stderr
    assert "[dry-run]" in result.stdout
    assert not (Path(tmp_path) / "profiles").exists()


def test_integrated_with_install_dsh_preset(tmp_path):
    """install-dsh-preset.mjs 主流程末尾自动装 web 插件；--no-web 跳过。"""
    env = dict(os.environ)
    env["DSH_HOME"] = str(tmp_path)
    res = subprocess.run(
        ["node", str(REPO / "install-dsh-preset.mjs")],
        cwd=REPO,
        env=env,
        capture_output=True,
        text=True,
    )
    assert res.returncode == 0, res.stderr
    assert "[web]" in res.stdout
    assert web_plugin_link(tmp_path).is_symlink()
    assert f"- id: {WEB_ENTRY_ID}" in installed_patch(tmp_path)

    # --no-web 跳过客户端插件安装
    env["DSH_HOME"] = str(tmp_path / "nohome")
    res = subprocess.run(
        ["node", str(REPO / "install-dsh-preset.mjs"), "--no-web"],
        cwd=REPO,
        env=env,
        capture_output=True,
        text=True,
    )
    assert res.returncode == 0, res.stderr
    assert "[web]" not in res.stdout
    assert not (Path(tmp_path) / "nohome" / "profiles").exists()
