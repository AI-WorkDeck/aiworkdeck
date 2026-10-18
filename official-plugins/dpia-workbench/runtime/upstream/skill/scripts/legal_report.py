"""Readable working draft from assessed evidence; legal editing remains required."""
import re
import dpia

NAMES = {'EU': '欧盟共通规则', 'SA': '沙特阿拉伯'}
STATUS = {'met':'已分析', 'not_met':'分析尚未完成', 'unknown':'待评估', 'not_applicable':'不适用', 'applies':'适用', 'does_not_apply':'不适用', 'confirmed':'范围已确认', 'candidate':'候选，待确认', 'excluded':'排除', 'verified':'已核验', 'pending':'待核验', 'not_applicable':'不适用'}
RECOMMEND = {'proceed_recommendation':'建议继续', 'conditional_recommendation':'附条件建议继续', 'changes_required':'需要调整方案', 'insufficient_information':'资料不足，保留结论', 'stop_recommendation':'建议停止有关处理'}
RISK = {'low':'低', 'medium':'中', 'high':'高', 'very_high':'很高', 'unknown':'暂无法确定'}

def render_report(d):
    rr=dpia.rules()
    sources={s['id']:s for s in dpia.read(dpia.ROOT/'references/sources.json')['sources']}
    sources.update({s['id']:s for s in d['sources']})
    facts={f['id']:f for f in d['facts']}
    labels={k:v['title'] for k,v in rr.items()}
    for name in dpia.COLLECTIONS:
        for x in d[name]:
            labels[x['id']]=x.get('title') or x.get('name') or x.get('description') or x.get('question') or x.get('scenario') or x.get('predicate') or '相关记录'
    pattern=re.compile(r'(?<![A-Za-z0-9_-])('+ '|'.join(re.escape(k) for k in sorted(labels,key=len,reverse=True))+r')(?![A-Za-z0-9_-])') if labels else None
    def prose(t):
        return pattern.sub(lambda m: labels[m.group()],str(t)) if pattern else str(t)
    def cite(ref):
        s=sources.get(ref['source_id'],{})
        title=s.get('title',s.get('name','法源待核验'))
        url=s.get('url',s.get('uri',''))
        label=title+'，'+ref['locator']
        return '['+label+']('+url+')' if url.startswith(('https://','http://')) else label
    def citations(refs):
        return '；'.join(cite(r) for r in refs)
    def evidence(ids):
        seen=[]
        for fid in ids:
            for sid in facts.get(fid,{}).get('source_ids',[]):
                s=sources[sid];text=s.get('title','材料')+'（'+s.get('version','')+'），'+s.get('locator','定位待补')
                if text not in seen:seen.append(text)
        return '；'.join(seen) or '事实依据待补充'
    m=d['meta'];countries=m.get('countries',[])
    confirmed=[c['name'] for c in countries if c['status']=='confirmed']
    out=['# '+m['project']+'：数据保护影响评估初评报告',
         '评估版本：'+m['version']+'；评估日期：'+m['assessed_at']+'；产品阶段：'+m['environment']+'。',
         '国家范围：'+('、'.join(confirmed) if confirmed else '待确认；本稿仅开展候选法域共通初评，未完成具体国家法律审查')+'。',
         '文档状态：供法律复核的工作草稿。编制依据：'+('依据沙特法律必要要素编制，按实施条例第25条核对内容。' if {j['code'] for j in d['jurisdictions']}=={'SA'} else '依据适用法律必要要素组织的自建法律报告。')+'未使用官方原始模板；没有模板本身不影响评估完整性。',
         '## 评估结论及保留事项']
    if dpia.gdpr_workflow.enabled(d):out.insert(2, '评估ID：'+m['assessment_id']+'；修订ID：'+m['revision_id'])
    for x in d['decisions']:
        out.append('**'+NAMES.get(x['jurisdiction'],x['jurisdiction'])+'：'+RECOMMEND[x['recommendation']]+'。** '+prose(x['rationale']))
        if x['blocking_ids']:out.append('影响上述结论的事项：'+'；'.join(prose(k) for k in x['blocking_ids'])+'。')
    if not d['decisions']:out.append('现有评估尚未形成实体结论。')
    out+=['## 项目与资料范围',prose(m['scope']), '排除范围：'+prose(m['excluded_scope']), '控制者及角色：'+prose(m['controller'])+'。'+prose(m['role_analysis']), '法源复核范围：'+prose(m['source_review']), '## 适用国家及法律']
    for c in countries:
        out+=['### '+c['name']+'（'+STATUS[c['status']]+'）',prose(c['connection']), '主管机构：'+c['authorities']+'。国内法律核验：'+STATUS[c['law_review']]+'。',prose(c['law_analysis'])]
        if c['law_refs']:out.append('法律依据：'+citations(c['law_refs']))
    for j in d['jurisdictions']:
        out+=['### '+NAMES.get(j['code'],j['code']),prose(j['analysis']), '本地规则覆盖：'+prose(j['coverage_note'])]
        if j['source_refs']:out.append('法律依据：'+citations(j['source_refs']))
    out.append('## 是否需要开展DPIA')
    screening_names={'applicability_unresolved':'法律适用前提尚未确定','outside_scope':'不在本法域适用范围','conflict_requires_review':'触发与例外判断冲突，须复核','exception_claim_requires_review':'拟援引例外，须核实条件','required':'已识别须开展DPIA的情形','recommended_high_risk_review':'建议开展高风险评估','undetermined':'现有资料不足以确定','no_trigger_identified_within_assessed_scope':'已评范围内未发现触发情形'}
    amap={a['rule_id']:a for a in d['rule_assessments']}
    for s in dpia.screen(d):
        out.append('**'+NAMES.get(s['jurisdiction'],s['jurisdiction'])+'：'+screening_names[s['result']]+'。**')
        relevant=list(dict.fromkeys(s['met_triggers']+s['met_indicators']))
        for rid in relevant:
            a=amap[rid]
            out.append(prose(a['analysis'])+' 材料依据：'+evidence(a['fact_ids'])+'。法律依据：'+citations(a['source_refs']))
        if s['unknown_triggers']:out.append('尚待核实的情形：'+'；'.join(rr[rid]['title'] for rid in s['unknown_triggers'])+'。')
        if s['result']=='no_trigger_identified_within_assessed_scope':
            for a in d['rule_assessments']:
                rule=rr[a['rule_id']]
                if rule['jurisdiction']==s['jurisdiction'] and rule['kind']=='trigger':out.append(prose(a['analysis'])+' 法律依据：'+citations(a['source_refs']))
    out.append('## 数据处理说明')
    for a in d['activities']:
        out+=['### '+a['name'],prose(a['purpose']), '涉及人群：'+'、'.join(a['data_subjects'])+'。处理数据：'+'、'.join(a['data_fields'])+'。', '系统及地域：'+'、'.join(a['systems']+a['regions'])+'。',prose(a['scale']+'；'+a['lifecycle']), '材料依据：'+evidence(a['fact_ids'])]
    out.append('## 法律分析')
    for a in d['rule_assessments']:
        rule=rr[a['rule_id']]
        if rule['kind']!='content':continue
        out+=['### '+NAMES.get(rule['jurisdiction'],rule['jurisdiction'])+'：'+rule['title'],prose(a['analysis'])]
        if a['status'] in ['unknown','not_met']:out.append('本项分析尚未完成，结论保留。')
        out+=['材料依据：'+evidence(a['fact_ids']), '法律依据：'+citations(a['source_refs'])]
    out.append('## 个人权益风险与缓解措施')
    for n,r in enumerate(d['risks'],1):
        if dpia.gdpr_workflow.enabled(d):
            g=r['gdpr_rating']
            out+=['### '+str(n)+'. '+prose(r['scenario']),
                  '受影响人群及影响：'+prose(r['affected_people']+'；'+r['harm']),
                  '法律依据：'+citations(r['legal_refs']), prose(r['legal_analysis']),
                  '当前风险：'+{'high':'高','not_high':'非高','undetermined':'未定'}[g['level']]+'。'+prose(g['rationale']),
                  '可能性依据：'+prose(g['likelihood_reason']), '严重性依据：'+prose(g['severity_reason']),
                  '措施及预期效果：'+prose(g['measures_reason']), '材料依据：'+evidence(r['fact_ids'])]
        else:
            out+=['### '+str(n)+'. '+prose(r['scenario']), '受影响人群及影响：'+prose(r['affected_people']+'；'+r['harm']), '当前条件下的风险：'+RISK[dpia.level(r['current'])]+'。'+prose(r['current']['rationale']), '措施实现后的预期风险：'+RISK[dpia.level(r['target'])]+'。'+prose(r['target']['rationale']+'；'+r['target_assumptions']), '材料依据：'+evidence(r['fact_ids'])]
        controls={c['id']:c for c in d['controls']}
        for cid in r['control_ids']:
            c=controls[cid]
            state={'planned':'计划中','partial':'部分实施','implemented':'已实施，验证另核','verified':'已验证','unknown':'状态待确认'}.get(c['status'],c['status'])
            out.append('缓解措施（'+state+'）：'+prose(c['description']))
    out.append('## 后续事项与复评')
    for a in d['actions']:
        out.append('- '+prose(a['description'])+'；责任人：'+a['owner']+'；期限：'+a['due']+'；验收：'+prose(a['acceptance'])+'。')
    for q in d['questions']:
        if q['status']!='answered':out.append('- 待补充/确认：'+prose(q['question'])+'；合规影响：'+prose(q.get('compliance_impact','待补充'))+'；建议：'+prose(q.get('recommendation','待补充'))+'；应答角色：'+q['owner']+'。')
    for x in d['linked_assessments']:
        out.append('关联专项（'+x['type']+'）：'+{'pending':'待完成','complete':'已有成果','not_applicable':'不适用'}[x['status']]+'。'+prose(x['rationale']))
    out.append('## 人工意见与决策记录')
    recorded=[s for x in d['decisions'] for s in x['human_approval_source_ids']]
    out.append('；'.join(cite({'source_id':sid,'locator':sources[sid]['locator']}) for sid in recorded) if recorded else '尚未提供可引用的人工审批记录。上述结论为评估建议。')
    return '\n\n'.join(out)+'\n'
