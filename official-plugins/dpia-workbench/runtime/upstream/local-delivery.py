"""Deterministic local report rendering and explicit archive packaging. No model calls."""
import hashlib, importlib.util, json, sys
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
sys.path.insert(0,str(Path(__file__).parent/'skill/scripts'))
import dpia, source_trace, internal_review


def internal(args):
    paths=args['paths'];d,index,trace=(json.loads(Path(paths[k]).read_text()) for k in ['assessment','sourceIndex','intake'])
    errors=dpia.validate(d)['errors']+source_trace.errors(d,index,trace)
    if errors:raise ValueError('; '.join(errors[:10]))
    out=Path(args['out']);report=out/'internal.md'
    if d['risks']:
        internal_review.write(d,index,trace,report,args['conditionalBasis'])
    else:
        spec=importlib.util.spec_from_file_location('result_check',Path(__file__).with_name('result-check.py'));module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        checked=module.check(paths)
        if checked['errors']:raise ValueError('; '.join(checked['errors'][:10]))
        content=checked['delivery']['readable_report'];report.write_text(content)
        audit={'assessment_id':d['meta']['assessment_id'],'revision_id':d['meta']['revision_id'],'input_digest':source_trace.digest(dict(assessment=d,source_index=index,intake_review=trace)),'report_sha256':hashlib.sha256(content.encode()).hexdigest(),'delivery':checked['delivery']['kind'],'source_index':index,'fact_links':trace['fact_links'],'checks':trace['checks'],'limitation':'Stage report only; not a formal completed DPIA or regulatory approval'}
        (out/'internal.audit.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2)+'\n')
    return {'report':str(report)}


def archive(args):
    entries=args['entries'];names=[e['name'] for e in entries]
    if len(names)!=len(set(names)) or len(names)>2000:raise ValueError('Invalid archive inventory')
    for name in names:
        if name.startswith('/') or '\\' in name or any(p in ['', '..'] for p in name.split('/')):raise ValueError('Unsafe archive name')
    # Validate the bytes as they enter the archive, not only before spawning Python.
    total=0
    with ZipFile(args['destination'],'x',compression=ZIP_DEFLATED,compresslevel=5) as z:
        for entry in entries:
            raw=Path(entry['path']).read_bytes();total+=len(raw)
            if total>150_000_000 or len(raw)!=entry['bytes'] or hashlib.sha256(raw).hexdigest()!=entry['sha256']:raise ValueError('Archive source changed')
            z.writestr(entry['name'],raw)
        z.writestr('manifest.json',json.dumps(args['manifest'],ensure_ascii=False,indent=2)+'\n')
        z.writestr('README.md','# DPIA 归档包\n\n按本次选择保存；manifest.json 列明报告、对应分析修订、所选来源/原件及文件摘要。\n\nanalysis/ 中的底稿和索引保持原始字节，历史本机路径只用于来源追溯。未选中的原件不会自动导出。reports/ 中仅包含已通过交付检查的文件，模板状态及确认范围见清单。Word 转换工作副本不能冒称官方原生 Word。\n\n本包不包含执行会话或模型配置，不代表监管提交、风险接受或批准上线。\n')
    with ZipFile(args['destination']) as z:
        if z.testzip() is not None or set(z.namelist())!=set(names+['manifest.json','README.md']):raise ValueError('Archive integrity failure')
    return {'files':len(names)+2}


if __name__=='__main__':
    try:
        args=json.load(sys.stdin)
        if args['mode']=='internal':result=internal(args)
        elif args['mode']=='archive':result=archive(args)
        else:raise ValueError('Unknown delivery action')
        print(json.dumps(result,ensure_ascii=False))
    except Exception as e:print(json.dumps({'error':str(e)[:2000]}));sys.exit(1)
