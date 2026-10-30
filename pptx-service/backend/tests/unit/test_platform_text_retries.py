# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Exercise the real OpenAI SDK against an in-memory HTTP transport, without paid calls."""
import ast
from pathlib import Path
from types import SimpleNamespace

import httpx
import openai
import pytest


def text_provider(transport):
    # Load only this provider class, avoiding the unrelated Gemini/Flask app import tree.
    source = Path(__file__).parents[2] / 'services/ai_providers/text/openai_provider.py'
    cls = next(n for n in ast.parse(source.read_text()).body if isinstance(n, ast.ClassDef))
    scope = {
        'TextProvider': object,
        'strip_think_tags': lambda text: text,
        'get_config': lambda: SimpleNamespace(OPENAI_TIMEOUT=1, OPENAI_MAX_RETRIES=2),
        'OpenAI': lambda **kwargs: openai.OpenAI(
            **kwargs, http_client=httpx.Client(transport=httpx.MockTransport(transport))),
    }
    exec(compile(ast.Module(body=[cls], type_ignores=[]), str(source), 'exec'), scope)
    return scope['OpenAITextProvider']


@pytest.mark.parametrize('failure', ['503', 'timeout'])
@pytest.mark.parametrize('domestic', [True, False])
def test_paid_text_retry_policy_uses_actual_sdk(monkeypatch, failure, domestic):
    calls = []

    def transport(request):
        calls.append(request)
        assert request.method == 'POST'
        assert request.url.path.endswith('/chat/completions')
        if failure == 'timeout':
            raise httpx.ReadTimeout('synthetic timeout', request=request)
        return httpx.Response(503, json={'error': {'message': 'synthetic unavailable'}})

    monkeypatch.setattr(openai._base_client.time, 'sleep', lambda _: None)
    Provider = text_provider(transport)
    key = 'awdai_synthetic' if domestic else 'synthetic-openrouter-key'
    base = 'https://www.aiworkdeck.com/api/account/ai/v1' if domestic else 'https://openrouter.ai/api/v1'
    provider = Provider(key, base, 'synthetic-text-model')
    try:
        with pytest.raises(openai.APITimeoutError if failure == 'timeout' else openai.InternalServerError):
            provider.generate_text('Synthetic prompt')
        assert provider.client.max_retries == (0 if domestic else 2)
        assert len(calls) == (1 if domestic else 3)
        assert all(r.headers['authorization'] == 'Bearer ' + key for r in calls)
    finally:
        provider.client.close()
