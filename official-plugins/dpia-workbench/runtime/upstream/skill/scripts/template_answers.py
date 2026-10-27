"""Render authored field answers; never infer a legal conclusion from an empty field."""


def choice_answer(options, *, status, selected, explanation, references, candidates=(), multiple=False):
    if status not in {'determined', 'unknown', 'not_applicable'}:
        raise ValueError('invalid answer status')
    if not explanation.strip() or not references:
        raise ValueError('reason and evidence/analysis references required')
    selected, candidates = list(selected), list(candidates)
    if len(set(selected)) != len(selected) or set(selected + candidates) - set(options):
        raise ValueError('duplicate or unknown option')
    if status == 'determined':
        if not selected or (not multiple and len(selected) != 1) or candidates:
            raise ValueError('determined answer requires an unambiguous selection')
        answer = '\n'.join(('☒ ' if key in selected else '☐ ') + label for key, label in options.items())
    else:
        if selected or (status == 'not_applicable' and candidates):
            raise ValueError('unresolved/inapplicable answers cannot assert a selection')
        answer = '尚不能确定' if status == 'unknown' else '不适用'
        if candidates:
            answer += '；候选路径（未确立）：' + '、'.join(options[key] for key in candidates)
    return answer + '\n' + explanation


def metadata_answer(kind, text):
    if kind not in {'processing_version', 'assessment_version', 'standards'}:
        raise ValueError('unknown metadata field')
    if not text.strip():
        raise ValueError('empty field must explicitly state what is missing')
    import re
    if re.search(r'\S+\.json|模拟测试第|test-\d|第\d+次测试', text, re.I):
        raise ValueError('internal run metadata is not a business field answer')
    if kind in {'assessment_version', 'standards'} and re.search(r'PRD|用户答复|隔离.*回复', text, re.I):
        raise ValueError('input provenance is not an assessment version or a standard')
    return text
