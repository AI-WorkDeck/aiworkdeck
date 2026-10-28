// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { t } from './i18n.js'
const invalid = () => { throw new Error(t('pptInvalidArguments')) }
const unavailable = () => { throw new Error(t('pptCapabilityUnavailable')) }
export function mediaGeometry(a) {
  if (!Number.isInteger(a.slideNumber) || a.slideNumber < 1 || !['left','top','width','height'].every(k => typeof a[k] === 'number' && Number.isFinite(a[k])) || a.width <= 0 || a.height <= 0) invalid()
  return {left:a.left,top:a.top,width:a.width,height:a.height}
}
export function chartData(a) {
  mediaGeometry(a)
  const types={column:51,bar:57,line:4,area:1,pie:5,doughnut:-4120,scatter:-4169}
  if (!Object.hasOwn(types,a.chartType) || !Array.isArray(a.categories) || !a.categories.length || a.categories.length>1000 || !a.categories.every(x=>typeof x==='string'||typeof x==='number'&&Number.isFinite(x)) || !Array.isArray(a.series) || !a.series.length || a.series.length>50) invalid()
  if (!a.series.every(s=>s&&typeof s.name==='string'&&Array.isArray(s.values)&&s.values.length===a.categories.length&&s.values.every(x=>typeof x==='number'&&Number.isFinite(x)))) invalid()
  if (['pie','doughnut'].includes(a.chartType) && (a.series.length!==1 || a.series[0].values.some(x=>x<0))) invalid()
  if (a.chartType==='scatter' && !a.categories.every(x=>typeof x==='number'&&Number.isFinite(x))) invalid()
  if(a.title!=null&&typeof a.title!=='string')invalid()
  return types[a.chartType]
}
export function chartStyle(a) {
  if (!Number.isInteger(a.slideNumber)||a.slideNumber<1||typeof a.shapeName!=='string'||!a.shapeName)invalid()
  for(const k of ['backgroundColor','textColor'])if(a[k]!=null&&!/^#[0-9a-f]{6}$/i.test(a[k]))invalid()
  if(a.fontSize!=null&&(!Number.isFinite(a.fontSize)||a.fontSize<8||a.fontSize>72))invalid()
  for(const k of ['showLegend','showGrid'])if(a[k]!=null&&typeof a[k]!=='boolean')invalid()
  if(a.seriesColors!=null&&(!Array.isArray(a.seriesColors)||!a.seriesColors.length||!a.seriesColors.every(x=>/^#[0-9a-f]{6}$/i.test(x))))invalid()
  if(!['backgroundColor','textColor','fontSize','seriesColors','showLegend','showGrid'].some(k=>a[k]!=null))invalid()
  return a
}
export function imageOptions(a) {
  mediaGeometry(a)
  const fit=a.fit??'cover',fx=a.focalX??0.5,fy=a.focalY??0.5
  if(!['cover','contain','stretch'].includes(fit)||![fx,fy].every(x=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=1)||a.sendToBack!=null&&typeof a.sendToBack!=='boolean')invalid()
  if(typeof a.base64!=='string'||!a.base64||a.base64.length>16777216)invalid()
  let binary;try{binary=atob(a.base64)}catch{invalid()}
  const mime=binary.startsWith('\x89PNG\r\n\x1a\n')?'image/png':binary.startsWith('\xff\xd8\xff')?'image/jpeg':/^GIF8[79]a/.test(binary)?'image/gif':binary.startsWith('BM')?'image/bmp':null
  if(!mime||binary.length>12*1024*1024)invalid()
  return {fit,fx,fy,mime,binary}
}
export function imageRectangle(a,iw,ih) {
  if(!Number.isFinite(iw)||!Number.isFinite(ih)||iw<=0||ih<=0||iw*ih>40000000)invalid()
  const o={...mediaGeometry(a),sx:0,sy:0,sw:iw,sh:ih},fit=a.fit??'cover'
  if(fit==='cover') {const scale=Math.max(a.width/iw,a.height/ih);o.sw=a.width/scale;o.sh=a.height/scale;o.sx=(iw-o.sw)*(a.focalX??0.5);o.sy=(ih-o.sh)*(a.focalY??0.5)}
  if(fit==='contain'){const scale=Math.min(a.width/iw,a.height/ih);o.width=iw*scale;o.height=ih*scale;o.left+=(a.width-o.width)/2;o.top+=(a.height-o.height)/2}
  return o
}
// Preprocess only image bytes, before host writes. PNG crop preserves alpha;
// the returned fit/cropped flags make the loss of out-of-crop pixels explicit.
export async function preparePptImage(a) {
  const options=imageOptions(a)
  if(typeof Image!=='function'||typeof document==='undefined')unavailable()
  const img=new Image();await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(new Error(t('fileOperationInvalidBytes')));img.src=`data:${options.mime};base64,${a.base64}`})
  const g=imageRectangle(a,img.naturalWidth,img.naturalHeight)
  if(options.fit!=='cover')return {...g,base64:a.base64,extension:options.mime.split('/')[1],cropped:false,fit:options.fit}
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(g.sw));canvas.height=Math.max(1,Math.round(g.sh));
  const ctx=canvas.getContext('2d');if(!ctx)unavailable();ctx.drawImage(img,g.sx,g.sy,g.sw,g.sh,0,0,canvas.width,canvas.height)
  const base64=canvas.toDataURL('image/png').split(',')[1];if(!base64||base64.length>16777216)invalid()
  return {...g,base64,extension:'png',cropped:true,fit:options.fit}
}
export function mediaPartial(error,a,shape) {
  error.partialResult={slideNumber:a.slideNumber,shapeId:shape?.Id==null?undefined:String(shape.Id),shapeName:shape?.Name,created:!!shape,outcomeUnknown:true,retryable:false};return error
}
const rgb=s=>{const n=parseInt(s.slice(1),16);return ((n&255)<<16)|(n&65280)|((n>>16)&255)}
export function addWpsChart(slide,a) {
  const type=chartData(a);if(typeof slide.Shapes.AddChart!=='function')unavailable()
  let shape
  try{
    shape=slide.Shapes.AddChart(type,a.left,a.top,a.width,a.height)
    const chart=shape.Chart,series=chart.SeriesCollection()
    if(typeof series.NewSeries!=='function')unavailable()
    for(let i=series.Count;i>=1;i--)series.Item(i).Delete()
    for(const data of a.series){const s=series.NewSeries();s.Name=data.name;s.XValues=a.categories;s.Values=data.values}
    if(a.title!=null){chart.HasTitle=true;chart.ChartTitle.Text=a.title}
    return {slideNumber:a.slideNumber,shapeId:String(shape.Id),shapeName:String(shape.Name),created:true,chartType:a.chartType}
  }catch(error){throw mediaPartial(error,a,shape)}
}
export function formatWpsChart(slide,a) {
  chartStyle(a);let shape
  for(let i=1;i<=slide.Shapes.Count;i++){const s=slide.Shapes.Item(i);if(String(s.Name)===a.shapeName){if(shape)invalid();shape=s}}
  if(!shape||!shape.HasChart)invalid()
  const c=shape.Chart,actions=[]
  const set=(obj,key,value)=>{if(!obj)unavailable();actions.push(()=>{obj[key]=value})}
  const fill=(f,color)=>{if(!f||typeof f.Solid!=='function'||!f.ForeColor)unavailable();actions.push(()=>{f.Solid();f.ForeColor.RGB=rgb(color)})}
  if(a.backgroundColor!=null){fill(c.ChartArea.Format.Fill,a.backgroundColor);fill(c.PlotArea.Format.Fill,a.backgroundColor)}
  if(a.showLegend!=null)set(c,'HasLegend',a.showLegend)
  if(a.textColor!=null||a.fontSize!=null){
    const fonts=[c.ChartArea.Font]
    if(c.HasTitle)fonts.push(c.ChartTitle.Font)
    if(a.showLegend??c.HasLegend)fonts.push(c.Legend.Font)
    if(![5,-4120].includes(Number(c.ChartType))){
      if(typeof c.Axes!=='function')unavailable()
      for(const type of [1,2]){const axis=c.Axes(type);if(!axis)unavailable();fonts.push(axis.TickLabels?.Font);if(axis.HasTitle)fonts.push(axis.AxisTitle?.Font)}
    }
    for(const font of fonts){if(a.textColor!=null)set(font,'Color',rgb(a.textColor));if(a.fontSize!=null)set(font,'Size',a.fontSize)}
  }
  if(a.showGrid!=null){if(typeof c.Axes!=='function'||[5,-4120].includes(Number(c.ChartType)))unavailable();set(c.Axes(2),'HasMajorGridlines',a.showGrid)}
  if(a.seriesColors!=null){const ss=c.SeriesCollection();const pie=[5,-4120].includes(Number(c.ChartType));const targets=pie?ss.Item(1).Points():ss;if(!Number.isInteger(targets.Count)||targets.Count<1)invalid();for(let i=0;i<targets.Count;i++){const color=a.seriesColors[i%a.seriesColors.length];const f=targets.Item(i+1).Format;fill(f.Fill,color);if(!pie&&[4,-4169].includes(Number(c.ChartType))){if(!f.Line?.ForeColor)unavailable();set(f.Line.ForeColor,'RGB',rgb(color))}}}
  let count=0;try{for(const action of actions){action();count++}}catch(error){error.partialResult={slideNumber:a.slideNumber,shapeName:a.shapeName,operationsApplied:count,outcomeUnknown:true,retryable:false};throw error}
  return {slideNumber:a.slideNumber,shapeName:a.shapeName,updated:true}
}
export function setWpsTransition(slide,a,enums) {
  if(!Number.isInteger(a.slideNumber)||a.slideNumber<1||!['none','fade','push','wipe'].includes(a.effect))invalid()
  const duration=a.durationSeconds??0.6;if(!Number.isFinite(duration)||duration<0.1||duration>5)invalid()
  const name={none:'ppEffectNone',fade:'ppEffectFade',push:'ppEffectPushLeft',wipe:'ppEffectWipeLeft'}[a.effect],value=enums?.[name],tr=slide.SlideShowTransition
  // Do not invent enum numbers or downgrade exact duration to coarse Speed.
  if(!tr||!Number.isFinite(value)||typeof tr.EntryEffect!=='number'||typeof tr.Duration!=='number')unavailable()
  try{tr.EntryEffect=value;tr.Duration=duration;if(tr.EntryEffect!==value||Math.abs(tr.Duration-duration)>0.001)unavailable();return{slideNumber:a.slideNumber,effect:a.effect,durationSeconds:tr.Duration,updated:true}}
  catch(error){error.partialResult={slideNumber:a.slideNumber,outcomeUnknown:true,retryable:false};throw error}
}
