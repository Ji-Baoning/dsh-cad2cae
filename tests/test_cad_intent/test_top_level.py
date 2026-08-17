"""validate_intent 顶层检查与词法分离测试"""
from cad_intent import validate_intent


def test_not_an_object():
    errs = validate_intent([1, 2])
    assert any('必须是一个 JSON 对象' in e for e in errs)


def test_units_must_be_meters():
    intent = {'schema_version': 2, 'units': 'mm', 'parts': [], 'assembly': None}
    errs = validate_intent(intent)
    assert any("units 必须为 'meters'" in e for e in errs)


def test_units_ok():
    intent = {'schema_version': 2, 'units': 'meters', 'parts': [], 'assembly': None}
    errs = validate_intent(intent)
    assert not any('units' in e for e in errs)


def test_parts_required():
    intent = {'schema_version': 2, 'units': 'meters'}
    errs = validate_intent(intent)
    assert any('parts' in e and '非空数组' in e for e in errs)


def test_parts_empty():
    intent = {'schema_version': 2, 'units': 'meters', 'parts': []}
    errs = validate_intent(intent)
    assert any('parts' in e and '非空数组' in e for e in errs)


def test_ground_must_reference_part():
    intent = {
        'schema_version': 2, 'units': 'meters', 'ground': 'ghost',
        'parts': [{'id': 'hub', 'type': 'extrude'}],
        'assembly': {'components': [], 'connections': []},
    }
    errs = validate_intent(intent)
    assert any("ground 'ghost'" in e and 'parts' in e for e in errs)


def test_ground_ok():
    intent = {
        'schema_version': 2, 'units': 'meters', 'ground': 'hub',
        'parts': [{'id': 'hub', 'type': 'extrude'}],
        'assembly': {'components': [], 'connections': []},
    }
    errs = validate_intent(intent)
    assert not any('ground' in e for e in errs)


def test_material_part_only():
    # 含 assembly 词汇的图不允许 material（sample 规则）
    intent = {
        'schema_version': 2, 'units': 'meters',
        'material': {'name': '6061', 'library': 'default'},
        'parts': [{'id': 'hub', 'type': 'extrude'}],
        'assembly': {'components': [{'id': 'c1'}], 'connections': []},
    }
    errs = validate_intent(intent)
    assert any('material' in e and '装配' in e for e in errs)


def test_word_vocabulary_separation():
    # part 词汇与 assembly 词汇不得混图
    intent = {
        'schema_version': 2, 'units': 'meters',
        'parts': [{'id': 'hub', 'type': 'sketch'}],
        'assembly': {'components': [{'id': 'c1'}], 'connections': []},
    }
    errs = validate_intent(intent)
    assert not any('混图' in e for e in errs)  # 正确分离，无错误
