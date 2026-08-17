"""validate_intent 主入口。"""

from cad_intent.part_validator import validate_part_graph
from cad_intent.assembly_validator import validate_assembly
from cad_intent.schema import ASSEMBLY_TYPES


def _has_assembly_vocab(parts):
    for node in parts or []:
        if node and isinstance(node, dict) and node.get('type') in ASSEMBLY_TYPES:
            return True
    return False


def validate_intent(intent):
    """校验意图层 JSON，返回错误列表（空 = 通过）。"""
    errors = []
    if not isinstance(intent, dict):
        return ['intent 必须是一个 JSON 对象。']

    if intent.get('units') != 'meters':
        errors.append("units 必须为 'meters'（got " + repr(intent.get('units')) + '）。')

    parts = intent.get('parts')
    if not isinstance(parts, list) or len(parts) == 0:
        errors.append('parts 必须是包含至少一个节点的非空数组。')
        return errors

    parts_ids = set()
    for node in parts:
        if isinstance(node, dict) and isinstance(node.get('id'), str):
            parts_ids.add(node['id'])
    ground = intent.get('ground')
    if ground is not None and ground not in parts_ids:
        errors.append("ground '" + str(ground) + "' 未在 parts 中找到。")

    # 词法分离：parts 数组不得混入装配类型节点
    if _has_assembly_vocab(parts):
        errors.append('词法分离违规：parts 数组中混入装配类型节点（component/connection 仅可出现在 assembly 字段）。')

    # material 仅 part 图（装配意图不得指定 material）
    material = intent.get('material')
    assembly = intent.get('assembly')
    if material is not None and assembly is not None:
        errors.append('material 仅限 part 图：装配图不允许指定 material。')

    validate_part_graph(parts, errors)

    if assembly is not None:
        validate_assembly(assembly, parts_ids, ground, errors)

    return errors
