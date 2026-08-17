"""AI-CAD 代码生成层：意图层 JSON → ① build123d 建模语言源码 + ② 可编辑 STEP。"""
# 惰性导出：Task 1 尚无 orchestrator/compiler，模块级 __getattr__ 保证
# `from cad_codegen import compile_sources` 等在各模块就绪后可用。
def __getattr__(name):
    if name == 'generate_sources':
        from cad_codegen.orchestrator import generate_sources
        return generate_sources
    if name == 'compile_sources':
        from cad_codegen.compiler import compile_sources
        return compile_sources
    if name == 'CompileResult':
        from cad_codegen.compiler import CompileResult
        return CompileResult
    raise AttributeError(name)


__all__ = ['generate_sources', 'compile_sources', 'CompileResult']
