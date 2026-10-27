"""Source-backed intake presentation. Checks provenance/links, not semantic truth."""
import hashlib
import json
from pathlib import Path
import xml.etree.ElementTree as ET
from zipfile import ZipFile

STAGES = ['cross_cutting', 'collect', 'transmit', 'use_derive', 'store',
          'access_share', 'retain_delete', 'backup_recover', 'rights_exit']
LABELS = ['范围与参与方', '收集/产生', '传输', '使用/推导', '存储',
          '访问/分享', '保留/删除', '备份/恢复', '权利/退出']
PAUSE_KINDS = dict(foundational='评估对象基础事实', substantive='具体实质判断',
                   effectiveness='措施效果验证', governance='程序/治理')
PAUSE_SCOPES = dict(none='不暂停', judgment='仅所列判断', activity='仅所列活动',
                    assessment='整体实质评估暂停', completion='仅完成关口，实质分析继续')


def pause_errors(c, activity_ids):
    """Validate scope declarations, not the legal sufficiency of their reasons."""
    p = c.get('pause')
    if p is None and c.get('status') == 'covered':
        return []
    prefix = c['id']+': '
    if not isinstance(p, dict):
        return [prefix+'explicit pause classification/scope required for each unresolved item']
    out = []
    kind, scope = p.get('kind'), p.get('scope')
    allowed = {'foundational': {'none', 'judgment', 'activity', 'assessment'},
               'substantive': {'none', 'judgment', 'activity'},
               'effectiveness': {'none', 'judgment', 'completion'},
               'governance': {'none', 'completion'}}
    if kind not in allowed or scope not in allowed.get(kind, set()):
        out.append(prefix+'pause kind/scope incompatible; split substantive and governance dependencies')
    for field in ['reason', 'conditional_analysis', 'resume_when']:
        if not isinstance(p.get(field), str) or not p[field].strip():
            out.append(prefix+'pause missing '+field)
    for field in ['affected_judgments', 'continue_with']:
        values = p.get(field)
        if (not isinstance(values, list) or not values or
                any(not isinstance(v, str) or not v.strip() for v in values)):
            out.append(prefix+'pause needs explicit nonempty '+field)
    if c.get('status') == 'covered' and scope != 'none':
        out.append(prefix+'covered input cannot itself pause a judgment; split any remaining gap')
    if scope == 'assessment':
        if set(c.get('activity_ids', [])) != set(activity_ids):
            out.append(prefix+'whole-assessment pause must address every activity')
        reason = p.get('whole_assessment_reason')
        if not isinstance(reason, str) or not reason.strip():
            out.append(prefix+'whole-assessment pause needs reason why independent/conditional analysis is unavailable')
    return out


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def snapshot(d):
    return digest({k: d[k] for k in ['meta', 'sources', 'activities', 'facts', 'questions']})


def passages(path):
    path = Path(path)
    if path.suffix.lower() == '.docx':
        with ZipFile(path) as z:
            root = ET.fromstring(z.read('word/document.xml'))
        ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
        for i, p in enumerate(root.findall('.//w:p', ns), 1):
            text = ''.join(t.text or '' for t in p.findall('.//w:t', ns))
            if text.strip():
                yield f'P{i}', f'正文XML段落 {i}（含表格段落，非页码）', text
    elif path.suffix.lower() in ['.md', '.txt']:
        for i, line in enumerate(path.read_text(encoding='utf-8').splitlines(), 1):
            if line.strip():
                yield f'L{i}', f'行 {i}', line
    else:
        raise ValueError('Unsupported source format; supply a faithful indexed transcription with provenance')


def build_index(d, source_ids):
    sources = {s['id']: s for s in d['sources']}
    if not source_ids or len(set(source_ids)) != len(source_ids):
        raise ValueError('Select unique business source IDs explicitly')
    business_kinds = {'prd', 'ui', 'architecture', 'configuration', 'test', 'log', 'policy', 'contract', 'human_confirmation'}
    omitted = {s['id'] for s in d['sources'] if s['kind'] in business_kinds} - set(source_ids)
    if omitted:
        raise ValueError('Supplied business sources omitted from index: '+', '.join(sorted(omitted)))
    result = {'version': '1', 'sources': [], 'passages': []}
    for sid in source_ids:
        s = sources[sid]; path = Path(s['uri'])
        sha = hashlib.sha256(path.read_bytes()).hexdigest()
        if s.get('sha256') and s['sha256'] != sha:
            raise ValueError('Source hash mismatch: ' + sid)
        result['sources'].append(dict(id=sid, path=str(path.resolve()), sha256=sha, title=s['title']))
        for key, locator, text in passages(path):
            result['passages'].append(dict(id=sid+':'+key, source_id=sid, locator=locator, text=text))
    return result


def errors(d, index, trace):
    out = []
    if trace.get('assessment_digest') != snapshot(d) or trace.get('index_digest') != digest(index):
        out.append('Trace snapshot stale or missing; review changed facts/sources/questions')
    selected = [s['id'] for s in index['sources']]
    if build_index(d, selected) != index:
        out.append('Source index differs from current original text')
    ps = {p['id']: p for p in index['passages']}
    fs = {f['id']: f for f in d['facts']}
    qs = {q['id']: q for q in d['questions'] if q['status'] == 'open'}
    links = trace.get('fact_links', [])
    linked = [x['fact_id'] for x in links]
    if len(linked) != len(set(linked)) or set(linked) != set(fs):
        out.append('Every fact needs exactly one source review, including unresolved facts')
    for x in links:
        f = fs.get(x['fact_id'], {})
        refs = x.get('passage_ids', [])
        if not refs or not x.get('support_note', '').strip() or not x.get('summary', '').strip():
            out.append(x['fact_id']+': missing exact source passages/support note/readable fact summary')
        for pid in refs:
            if pid not in ps or ps[pid]['source_id'] not in f.get('source_ids', []):
                out.append(x['fact_id']+': invalid source passage '+pid)
    checks = trace.get('checks', [])
    ids = [c['id'] for c in checks]
    if not checks or len(ids) != len(set(ids)):
        out.append('Concrete fact/gap checks required; IDs must be unique')
    mapped = []; targets = set()
    for c in checks:
        out.extend(pause_errors(c, {a['id'] for a in d['activities']}))
        key = (tuple(sorted(c.get('activity_ids', []))), c.get('predicate'))
        if key in targets: out.append(c['id']+': duplicate target; merge its evidence/resolve conflict')
        targets.add(key)
        if not c.get('activity_ids') or not set(c['activity_ids']) <= {a['id'] for a in d['activities']}:
            out.append(c['id']+': invalid activity scope')
        for field in ['predicate', 'finding', 'decision_impact', 'recommendation']:
            if not c.get(field, '').strip(): out.append(c['id']+': missing '+field)
        if c.get('status') not in ['covered', 'missing', 'conflict', 'not_designed', 'answered_unknown', 'verification_later']:
            out.append(c['id']+': invalid status')
        if c.get('phase') not in ['screening', 'assessment', 'remediation']:
            out.append(c['id']+': invalid phase')
        if set(c.get('searched_source_ids', [])) != set(selected):
            out.append(c['id']+': must check every supplied business source before declaring a gap')
        if not c.get('passage_ids') or any(p not in ps for p in c['passage_ids']):
            out.append(c['id']+': missing reviewed source locations')
        if any(f not in fs for f in c.get('known_fact_ids', [])):
            out.append(c['id']+': invalid known fact')
        qid = c.get('question_id')
        if qid:
            mapped.append(qid)
            if qid not in qs or c['status'] not in ['missing', 'conflict']:
                out.append(c['id']+': only an unresolved gap/conflict can produce a new question')
            if c['phase'] != trace.get('phase'):
                out.append(c['id']+': future-stage question must not enter current intake')
            if not c.get('gap', '').strip(): out.append(c['id']+': precise residual gap required')
            # Same predicate and overlapping activity already known: cannot reclassify it as missing.
            for f in d['facts']:
                scope = f.get('scope_activity_ids') or [f.get('activity_id')]
                if (c['status'] == 'missing' and f['predicate'] == c['predicate'] and
                        f['status'] in ['documented', 'confirmed', 'observed'] and
                        set(c['activity_ids']) & set(scope)):
                    out.append(c['id']+': target already has a known fact; split the genuinely missing subfield')
    if len(mapped) != len(set(mapped)) or set(mapped) != set(qs):
        out.append('Each open question must map one-to-one to a concrete reviewed residual gap')
    if trace.get('phase') not in ['screening', 'assessment'] or not trace.get('semantic_review', '').strip():
        out.append('Current phase and substantive source/coverage review note required')
    return out


def _question_packets(d, index, trace):
    """Project reviewed residual gaps, not a separately drafted broad questionnaire."""
    facts = {f['id']: f for f in d['facts']}
    links = {x['fact_id']: x for x in trace['fact_links']}
    passages = {p['id']: p for p in index['passages']}
    sources = {s['id']: s for s in index['sources']}
    status = dict(documented='材料明确', confirmed='输入已确认', observed='已观察',
                  inferred='推断待确认', unknown='未确定', conflict='来源冲突')
    implementation = dict(planned='拟议设计', partial='部分实施', implemented='已实施',
                          verified='已验证', unknown='实施情况未确定', not_applicable='不适用')
    result = []
    for c in trace['checks']:
        if not c.get('question_id'):
            continue
        known = []
        for fid in c['known_fact_ids']:
            f, link = facts[fid], links[fid]
            refs = list(dict.fromkeys(
                sources[passages[pid]['source_id']]['title']+'，'+passages[pid]['locator']
                for pid in link['passage_ids']))
            known.append(link['summary']+'（'+status[f['status']]+'；'+
                         implementation[f['implementation']]+'；'+'；'.join(refs)+'）')
        known_text = '；'.join(known) or '本项尚无关联事实可复用；不能据此认定安排不存在。'
        question = ('请澄清：' if c['status'] == 'conflict' else '请补充或确认：')+c['gap']
        result.append(dict(id=c['question_id'], known=known_text, gap=c['gap'],
            question=question, impact=c['decision_impact'], recommendation=c['recommendation'],
            comment='已有材料：'+known_text+'\n'+question+'\n对判断的影响：'+
                    c['decision_impact']+'\n建议材料：'+c['recommendation']))
    return result


def question_packets(d, index, trace):
    """Shared read-only input for intake, internal reports and native Word comments.

    Source validation does not prove that a reviewed gap is semantically new.
    """
    issues = errors(d, index, trace)
    if issues:
        raise ValueError('; '.join(issues))
    return _question_packets(d, index, trace)


def render(d, index, trace):
    from dpia import table
    issues = errors(d, index, trace)
    if issues: raise ValueError('; '.join(issues))
    links = {x['fact_id']: x for x in trace['fact_links']}
    acts = {a['id']: a['name'] for a in d['activities']}
    status_labels = dict(documented='材料明确',confirmed='输入已确认',observed='已观察',
                         inferred='推断待确认',unknown='未知',conflict='来源冲突')
    implementation_labels = dict(planned='拟议',implemented='已实施',verified='已验证',unknown='未确定',not_applicable='不适用')
    gap_labels = dict(covered='已知',missing='材料未回答',conflict='冲突待澄清',not_designed='已答尚未设计/选定',
                      answered_unknown='已明确未确定',verification_later='后续验证')
    phase_labels = dict(screening='筛查',assessment='内部评估',remediation='整改验证')
    parts = ['# 生命周期事实确认与信息缺口',
             '评估ID：'+d['meta']['assessment_id']+'｜修订ID：'+d['meta']['revision_id'],
             '先核对以下事实，按事实ID指出更正；已提供的事实无需重述。材料描述、用户答复、模拟设定与实施证据分别保留来源性质。未知不填答案，尚未设计不反复追问。',
             '## 一、已提取事实：按生命周期确认']
    for stage, label in zip(STAGES, LABELS):
        rows = []
        for f in d['facts']:
            if f.get('lifecycle_stage') != stage: continue
            scope = f.get('scope_activity_ids') or [f.get('activity_id')]
            activity = '项目共通范围' if set(scope) == set(acts) else '、'.join(acts.get(a, str(a)) for a in scope)
            rows.append([f['id'], activity, links[f['id']]['summary'],
                         status_labels[f['status']]+'/'+implementation_labels.get(f['implementation'], f['implementation']),
                         '；'.join(links[f['id']]['passage_ids']), links[f['id']]['support_note']])
        parts += ['### '+label, table(['事实ID','活动','事实','证据/实施状态','原文索引','支持范围/限制'], rows)
                  if rows else '尚无独立事实记录；不得据此推定不适用，也不自动生成整阶段问题。']
    parts += ['## 二、差额核对：已知、尚未设计与剩余缺口',
              table(['核对ID/阶段','具体事实项','已有事实ID','核对结果','对判断的影响'],
                    [[c['id']+'/'+phase_labels[c['phase']],c.get('label',c['predicate']),'、'.join(c['known_fact_ids']),gap_labels[c['status']]+'：'+c['finding'],c['decision_impact']] for c in trace['checks']]),
              '### 暂停范围与可继续事项',
              '以下范围不代表自动法律裁定；提问等待、实质分析、完整评估完成与批准上线分别处理。']
    for c in trace['checks']:
        p = c.get('pause')
        if not p: continue
        parts += [f"**{c['id']}｜{PAUSE_KINDS[p['kind']]}｜{PAUSE_SCOPES[p['scope']]}**",
                  '活动范围：'+'、'.join(c['activity_ids']),
                  '涉及判断：'+'；'.join(p['affected_judgments']),
                  '范围理由：'+p['reason'], '条件分析：'+p['conditional_analysis'],
                  '可继续：'+'；'.join(p['continue_with']), '解除限制/后续处理：'+p['resume_when']]
        if p['scope'] == 'assessment':
            parts += ['整体暂停理由：'+p['whole_assessment_reason']]
    parts += ['## 三、本阶段需要补充的问题（只问剩余缺口）']
    for q in _question_packets(d, index, trace):
        parts += ['### '+q['id'], '已有依据：'+q['known'],
                  '剩余缺口：'+q['gap'], '问题：'+q['question'],
                  '对筛查/风险判断的影响：'+q['impact'], '建议提供：'+q['recommendation']]
    if not any(c.get('question_id') for c in trace['checks']):
        parts += ['当前未生成新的事实问题；已答未知/尚未设计及未来验证保留，不要求重复作答。']
    parts += ['## 四、来源原文索引', '<details>\n<summary>展开所引PRD段落及用户问答原文</summary>\n', '以下是所引材料原文，不是评估结论。问答汇编中问题还原和模拟回答归纳的性质不改变；不能冒充原始对话逐字记录。']
    used = {p for x in trace['fact_links'] for p in x['passage_ids']} | {p for c in trace['checks'] for p in c['passage_ids']}
    for s in index['sources']:
        parts += [f"### {s['id']}：{s['title']}", f"来源：[{s['title']}]({s['path']})；SHA-256：`{s['sha256']}`"]
        for p in index['passages']:
            if p['source_id'] == s['id'] and p['id'] in used:
                parts += [f"**{p['id']}｜{p['locator']}**", '> '+p['text'].replace('\n', '\n> ')]
    parts += ['</details>', '核对限制：'+trace['semantic_review'],
              '程序检查来源一致性、关联完整性、阶段及已知项重复；不自动证明原文支持充分、语义无遗漏或法律判断正确。']
    return '\n\n'.join(parts)+'\n'
