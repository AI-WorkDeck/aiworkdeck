# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Exercise request options without loading network clients or service databases."""
import ast
from pathlib import Path
from types import SimpleNamespace


def extra_body(base, ratio='16:9', resolution='2k'):
    source = Path(__file__).parents[2] / 'services/ai_providers/image/openai_provider.py'
    tree = ast.parse(source.read_text())
    cls = next(n for n in tree.body if isinstance(n, ast.ClassDef))
    method = next(n for n in cls.body if isinstance(n, ast.FunctionDef) and n.name == '_build_extra_body')
    module = ast.Module(body=[method], type_ignores=[])
    scope = {}
    exec(compile(module, str(source), 'exec'), scope)
    return scope['_build_extra_body'](SimpleNamespace(api_base=base), ratio, resolution)


def test_openrouter_gets_native_image_config():
    assert extra_body('https://openrouter.ai/api/v1') == {
        'image_config': {'aspect_ratio': '16:9', 'image_size': '2K'}}


def test_other_providers_keep_legacy_contract_and_spoof_host_does_not_match():
    for base in ['https://proxy.example/v1', 'https://openrouter.ai.example/v1',
                 'https://addin.workdeck.ai.evil/openrouter-relay/api/v1',
                 'https://addin.workdeck.ai/other']:
        body = extra_body(base, '3:2', '1K')
        assert body['aspect_ratio'] == '3:2'
        assert body['generationConfig']['imageConfig']['imageSize'] == '1K'
        assert 'image_config' not in body
