# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Run the real provider methods with SDK response fixtures; never make paid calls."""
import ast
import base64
import logging
import re
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
from typing import Optional, List
from unittest.mock import Mock

import pytest
from PIL import Image
from openai.types.chat import ChatCompletion


def provider_type():
    source = Path(__file__).parents[2] / 'services/ai_providers/image/openai_provider.py'
    tree = ast.parse(source.read_text())
    cls = next(n for n in tree.body if isinstance(n, ast.ClassDef))
    cls.bases = []
    scope = dict(Image=Image, Optional=Optional, List=List, BytesIO=BytesIO,
                 base64=base64, re=re, logger=logging.getLogger('fixture'),
                 requests=Mock(), OpenAI=Mock(), get_config=lambda: SimpleNamespace(OPENAI_TIMEOUT=30))
    exec(compile(ast.Module(body=[cls], type_ignores=[]), str(source), 'exec'), scope)
    return scope['OpenAIImageProvider'], scope


def fixture_response():
    out = BytesIO()
    Image.new('RGB', (3, 2), 'red').save(out, format='PNG')
    return dict(id='gen-test', object='chat.completion', created=1, model='test-image',
                choices=[dict(index=0, finish_reason='stop', message=dict(role='assistant', content=None,
                    images=[dict(type='image_url', image_url=dict(url='data:image/png;base64,' + base64.b64encode(out.getvalue()).decode()))]))])


@pytest.mark.parametrize('representation', ['dict', 'sdk', 'attributes'])
def test_native_images_returns_decoded_pixels_once(representation):
    cls, scope = provider_type()
    instance = cls('test-key', 'https://openrouter.ai/api/v1')
    response = fixture_response()
    if representation == 'sdk':
        response = ChatCompletion.model_validate(response)
    elif representation == 'attributes':
        url = response['choices'][0]['message']['images'][0]['image_url']['url']
        response = SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=None,
            images=[SimpleNamespace(image_url=SimpleNamespace(url=url))]))])
    instance.client.chat.completions.create.return_value = response
    image = instance.generate_image('test image')
    assert image.size == (3, 2)
    assert image.getpixel((0, 0)) == (255, 0, 0)
    instance.client.chat.completions.create.assert_called_once()
    assert scope['OpenAI'].call_args.kwargs['max_retries'] == 0
    scope['requests'].get.assert_not_called()


@pytest.mark.parametrize('base', ['https://openrouter.ai/api/v1', 'https://addin.workdeck.ai/openrouter-relay/api/v1/'])
def test_openrouter_never_fetches_response_urls(base):
    cls, scope = provider_type()
    instance = cls('test-key', base)
    response = fixture_response()
    message = response['choices'][0]['message']
    message['images'][0]['image_url']['url'] = 'http://127.0.0.1/private.png'
    message['content'] = '![image](http://127.0.0.1/private.png)'
    instance.client.chat.completions.create.return_value = response
    with pytest.raises(Exception):
        instance.generate_image('test')
    scope['requests'].get.assert_not_called()
    instance.client.chat.completions.create.assert_called_once()
    assert 'image_config' in instance._build_extra_body('16:9', '1K')


def test_failed_paid_call_is_not_resubmitted():
    cls, scope = provider_type()
    instance = cls('test-key', 'https://openrouter.ai/api/v1')
    instance.client.chat.completions.create.side_effect = TimeoutError('sensitive payload')
    with pytest.raises(Exception, match='Image generation failed: TimeoutError') as error:
        instance.generate_image('test')
    assert 'sensitive payload' not in str(error.value)
    instance.client.chat.completions.create.assert_called_once()
    assert scope['OpenAI'].call_args.kwargs['max_retries'] == 0


def test_upstream_exception_body_is_not_in_formatted_traceback():
    import traceback
    Provider, scope = provider_type()
    provider = Provider('fixture-key', 'https://openrouter.ai/api/v1', 'fixture-model')
    provider.client.chat.completions.create.side_effect = RuntimeError('private-upstream-identifier')
    try:
        provider.generate_image('a street')
    except Exception:
        rendered = traceback.format_exc()
        assert 'private-upstream-identifier' not in rendered
        assert 'Image generation failed: RuntimeError' in rendered
    else:
        pytest.fail('expected sanitized failure')
