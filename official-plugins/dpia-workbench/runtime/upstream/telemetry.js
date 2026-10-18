const keys=['uncachedInputTokens','outputTokens','cacheReadTokens','cacheWriteTokens'];
export function telemetry(values,baseline){
 const source=values?.tokenUsage;
 const totals=source&&keys.every(k=>Number.isSafeInteger(source[k])&&source[k]>=0)?Object.fromEntries(keys.map(k=>[k,source[k]])):null;
 const usage=totals&&baseline&&keys.every(k=>Number.isSafeInteger(baseline[k])&&baseline[k]>=0&&totals[k]>=baseline[k])?Object.fromEntries(keys.map(k=>[k,totals[k]-baseline[k]])):null;
 const selection=values?.modelSelection;
 return {usageTotals:totals,usage,model:selection?.lastUsed||null,nextModel:selection?.next||null,usageScope:usage?'current_request':totals?'session_only':'unavailable'};
}
export function usageWarnings(settings,status){
 const messages=[];if(settings?.minutes>0&&status.elapsedSeconds>=settings.minutes*60)messages.push(`本轮等待/运行时间已达到 ${settings.minutes} 分钟提醒值。`);
 if(settings?.tokens>0&&status.usage&&Object.values(status.usage).reduce((a,b)=>a+b,0)>=settings.tokens)messages.push(`本轮宿主已报告用量达到 ${settings.tokens} tokens 提醒值（含缓存）。`);
 return messages;
}
