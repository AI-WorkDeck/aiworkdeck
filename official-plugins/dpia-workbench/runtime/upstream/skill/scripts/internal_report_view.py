"""Business-facing presentation of reviewed records; never infers business facts."""

# These are presentation topics, not additional legal tests or mandatory questions.
TOPICS = {
    'overview': ('范围、目的与参与方', [
        ('scope', '评估范围与产品阶段'), ('purpose', '处理目的'),
        ('people', '涉及人员与参与主体')]),
    'lifecycle': ('数据生命周期', [
        ('collection', '采集与产生'), ('transfer', '传输与跨境访问'),
        ('use', '使用、分析与二次利用'), ('storage', '存储'),
        ('sharing', '访问、接收与分享'), ('retention', '保留、删除与归档'),
        ('backup', '缓存、备份与恢复')]),
    'rights': ('告知、选择与权利实现', [
        ('notice', '告知与使用人覆盖'), ('choice', '开通、选择、撤回与关闭'),
        ('access', '访问与可携带'), ('correction', '更正、人工复核与申诉'),
        ('deletion', '删除、限制与反对'), ('exit', '解绑、换主与退出')]),
    'safeguards': ('现有保护措施与实施状态', [('safeguards', '设计及实施事实')]),
}
FACT_STATUS = dict(documented='材料明确', confirmed='已确认输入', observed='已观察',
                   inferred='推断待确认', unknown='未确定', conflict='来源冲突')
IMPLEMENTATION = dict(planned='拟议设计', partial='部分实施', implemented='已实施', verified='已验证',
                      unknown='实施情况未确定', not_applicable='不适用')
ACTION_STATUS = dict(open='待处理', in_progress='进行中', closed='已关闭', deferred='暂缓')


def layout_errors(d, trace):
    layout = trace.get('report_topics')
    if not isinstance(layout, dict):
        return ['Internal report needs a reviewed report_topics fact mapping; do not dump the technical fact list']
    allowed = {key for _, topics in TOPICS.values() for key, _ in topics}
    facts = {f['id'] for f in d['facts']}
    used = set(); errors = []
    for topic, ids in layout.items():
        if topic not in allowed or not isinstance(ids, list) or any(not isinstance(i, str) for i in ids):
            errors.append('Invalid report topic/fact list: '+str(topic)); continue
        if len(ids) != len(set(ids)) or not set(ids) <= facts:
            errors.append('Unknown/duplicate fact reference in report topic: '+topic)
        used.update(ids)
    if facts - used:
        errors.append('Report topic mapping omits recorded facts: '+', '.join(sorted(facts-used)))
    limits = trace.get('report_topic_limits', {})
    if not isinstance(limits, dict) or any(key not in allowed or not isinstance(value, str) or not value.strip()
                                           for key, value in limits.items()):
        errors.append('Topic limitations must contain reviewed, nonempty statements for known topics')
    elif any(layout.get(key) and key not in limits for key, _ in TOPICS['rights'][1]):
        errors.append('Each populated rights topic needs an explicit coverage/limitations note; functions are not proof of rights fulfilment')
    priorities = trace.get('action_priorities', {})
    if (not isinstance(priorities, dict) or any(
            key not in {a['id'] for a in d['actions']} or not isinstance(value, str) or not value.strip()
            for key, value in priorities.items())):
        errors.append('Action priorities must reference current actions and contain reviewed nonempty text')
    return errors


def render(d, index, trace, screening, conditional_basis, legal):
    from dpia import table, rules
    from internal_judgments import PROGRESS, FINDING
    from source_trace import question_packets
    facts = {f['id']: f for f in d['facts']}
    links = {x['fact_id']: x for x in trace['fact_links']}
    passages = {p['id']: p for p in index['passages']}
    sources = {s['id']: s for s in index['sources']}
    pending = set(d['meta'].get('pending_review_ids', []))
    ratings = {'high':'高', 'not_high':'非高', 'undetermined':'未定'}
    footnotes = {}

    def evidence(ids):
        pids = dict.fromkeys(pid for fid in ids for pid in links[fid]['passage_ids'])
        for pid in pids:
            if pid not in footnotes: footnotes[pid] = len(footnotes)+1
        return ''.join('[^s'+str(footnotes[pid])+']' for pid in pids)

    def law(refs):
        return '；'.join(f"[{legal[r['source_id']][0]}]({legal[r['source_id']][1]}) {r['locator']}" for r in refs)

    def level(r):
        return '未定（待复评）' if r['id'] in pending else ratings[r['gdpr_rating']['level']]

    out = ['# '+d['meta']['project']+' 内部评估报告',
           '评估日期：'+d['meta']['assessed_at'],
           '状态：阶段性内部评估；不表示完整DPIA完成、控制已经验证或批准上线。',
           '## 一、评估所依据的事实',
           '本节固定本轮分析所依据的事实，不新增确认，也不强制冻结未知事项。材料明确不等于已实施；功能存在不等于相应权利义务已满足。',
           '本轮范围：'+d['meta']['scope']+'。限制：'+d['meta']['excluded_scope']]
    for group_title, topics in TOPICS.values():
        out += ['### '+group_title]
        for key, title in topics:
            out += ['#### '+title]
            ids = trace['report_topics'].get(key, [])
            if not ids:
                out += ['当前事实清单未明确本项安排；不能据此认定未设计、不适用或已满足。']
            for fid in ids:
                f = facts[fid]
                out += [links[fid]['summary']+'（'+FACT_STATUS[f['status']]+'；'+
                        IMPLEMENTATION[f['implementation']]+'）'+evidence([fid])]
            if trace.get('report_topic_limits', {}).get(key):
                out += ['事实覆盖范围及未明事项：'+trace['report_topic_limits'][key]]
        if topics[0][0] == 'safeguards':
            for c in d['controls']:
                state = IMPLEMENTATION[c['status']]
                out += [c['description']+'（'+state+'；'+
                        ('已提供效果证据，效果结论见评估部分' if c['verification_evidence'] else '未提供效果验证证据')+'）']
    # Outstanding questions are factual, and precede judgments. Answered unknowns are not re-opened.
    if d['questions'] and any(q['status']=='open' for q in d['questions']):
        out += ['### 待补充或确认的事实', table(['已有依据', '仅需补充的差额', '对判断的影响', '建议补充'],
            [[q['known'], q['question'], q['impact'], q['recommendation']]
             for q in question_packets(d, index, trace)])]

    out += ['## 二、评估结果', '### DPIA筛查与结论范围']
    answer = {'required':'需要开展DPIA', 'undetermined':'暂不能确定是否需要开展DPIA'}[screening['result']]
    out += ['筛查结论：'+answer+('（条件性结论，限下述前提）。' if screening['conditional'] else '。')]
    if conditional_basis.strip():
        out += ['条件性分析限定：'+conditional_basis.strip(), '以上条件不作为已确认事实，也不替代正式筛查。']
    if screening['conditional']:
        out += ['最终筛查未完成指前提或相关核验尚未完成，不抹去上述已形成的条件性判断。']
    assessments = {a['rule_id']:a for a in d['rule_assessments']}
    for rid in screening['rule_ids']:
        a = assessments[rid]
        out += [a['analysis']+evidence(a['fact_ids'])+' 法律依据：'+law(a['source_refs'])]
    if assessments.get('EU-X01',{}).get('status')=='unknown':
        out += ['例外/既往评估适用性尚未确定，当前未建立豁免依据；这不表示已证明例外不适用。']
    out += ['### 评估维度与覆盖限制']
    rr = rules()
    content = [a for a in d['rule_assessments'] if rr[a['rule_id']]['kind']=='content']
    rows=[]; action_map={a['id']:a for a in d['actions']}
    out += ['分析进度、合规发现与措施落实是不同状态；已完成分析可以得出存在问题的结论，提出整改不等于整改已完成。']
    for a in content:
        v=a['review']; stale=a['rule_id'] in pending
        action_state='；'.join(aid+'：'+('待复评' if aid in pending else ACTION_STATUS[action_map[aid]['status']]) for aid in v['action_ids']) or '未记录对应整改'
        rows.append([rr[a['rule_id']]['title'], '变更后待复评' if stale else PROGRESS[v['progress']],
            '旧分析待复评，不作为本轮结论。' if stale else FINDING[v['finding']]+'：'+a['analysis']+evidence(a['fact_ids']),
            v['limitations'] or '本轮未列进一步限制', action_state, law(a['source_refs'])])
    out += [table(['评估维度','分析进度','当前判断','尚待判断 / 补充','整改落实','法律依据'],rows)]
    out += ['### 风险结果', '等级依据个人权益损害的可能性与严重性作定性判断；不是EDPB统一评分表，拟议措施不代表风险已降低。']
    for r in d['risks']:
        g=r['gdpr_rating']
        out += ['#### '+r['id']+'｜'+r['scenario'], '风险等级：'+level(r),
                *(['本项待复评；以下保留旧分析，不作为本轮有效结论。'] if r['id'] in pending else []),
                '法律依据：'+law(r['legal_refs']),
                r['legal_analysis']+evidence(r['fact_ids']),
                '个人影响：'+r['affected_people']+'；'+r['harm'],
                '评级依据：可能性——'+g['likelihood_reason']+'；严重性——'+g['severity_reason']+'；综合——'+g['rationale'],
                '措施预期作用与限制：'+g['measures_reason']+' '+r['target_assumptions'],
                '对应整改：'+ '、'.join(a['id'] for a in d['actions'] if r['id'] in a['risk_ids'])+'（见第三部分）。']
    checks = [c for c in trace['checks'] if c.get('pause') and c['status']!='covered']
    if checks:
        states = dict(missing='待补充', conflict='待消除冲突', answered_unknown='已答复，仍未确定',
                      not_designed='已明确尚未设计', verification_later='待验证')
        out += ['### 尚不能定论的部分', table(['事项及状态','影响范围与原因','现可继续 / 恢复条件'],
            [[c['finding']+'（'+states[c['status']]+'）',
              '；'.join(c['pause']['affected_judgments'])+'：'+c['pause']['reason']+'（'+source_scope(c['pause']['scope'])+'）',
              c['pause']['conditional_analysis']+'；可继续：'+'；'.join(c['pause']['continue_with'])+'；后续需：'+c['pause']['resume_when']]
             for c in checks])]

    out += ['## 三、整改清单', '同一措施只列一次，以风险编号关联；风险等级不自动替代整改优先级。负责人、时点或优先级未明确的，保持待确定。']
    # Priority is an optional presentation record, not inferred from a risk label.
    priorities = trace.get('action_priorities', {})
    risks = {r['id']:r for r in d['risks']}
    out += [table(['整改项 / 对应风险','措施与建议','优先级 / 责任 / 时点','验收要求','状态'],
        [[a['id']+' / '+('、'.join(rid+'（'+level(risks[rid])+'）' for rid in a['risk_ids']) or '专项合规要求'),
          a['description'], (priorities.get(a['id']) or '未确定')+' / '+(a['owner'].strip() or '未确定')+' / '+(a['due'].strip() or '未确定'),
          a['acceptance'], '待复评' if a['id'] in pending else ACTION_STATUS.get(a['status'],'待核对')]
         for a in d['actions']])]
    out += ['后续可补充事实或整改后复评；也可按用户要求生成缺失事实留空、附原生批注的报告草稿。均不等于评估已完成或获准上线。',
            '来源简注如下；内部编号映射、版本摘要和校验记录保存在配套技术索引，不作为业务结论。']
    for pid, number in footnotes.items():
        p=passages[pid];s=sources[p['source_id']]
        out += [f"[^s{number}]: [{s['title']}]({s['path']})，{p['locator']}。"]
    return '\n\n'.join(out)+'\n'


def source_scope(scope):
    return dict(none='不暂停',judgment='仅限制相关判断',activity='仅限制相关处理活动',
                assessment='整体暂停',completion='仅影响完成关口，实质分析可继续')[scope]
