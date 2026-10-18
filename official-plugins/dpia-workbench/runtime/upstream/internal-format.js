// Text-only Markdown presentation. Never evaluates raw HTML, URLs or embedded code.
export const inlineText=value=>String(value).replace(/!\[([^\]]*)\]\(([^)]+)\)/g,'$1（$2）').replace(/\[([^\]]+)\]\(([^)]+)\)/g,'$1（$2）').replace(/(\*\*|__)(.*?)\1/g,'$2').replace(/`([^`]+)`/g,'$1');
export function reportBlocks(content){
 const lines=String(content).replace(/\r\n/g,'\n').split('\n'),out=[];
 const cells=line=>line.trim().replace(/^\|/,'').replace(/\|$/,'').split(/(?<!\\)\|/).map(x=>inlineText(x.trim().replace(/\\\|/g,'|')));
 const separator=line=>/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line||'');
 for(let i=0;i<lines.length;){const line=lines[i];
  if(!line.trim()){i++;continue;}
  if(/^```/.test(line)){const text=[];i++;while(i<lines.length&&!/^```/.test(lines[i]))text.push(lines[i++]);i++;out.push({type:'code',text:text.join('\n')});continue;}
  const heading=/^(#{1,6})\s+(.+)$/.exec(line);if(heading){out.push({type:'heading',level:heading[1].length,text:inlineText(heading[2])});i++;continue;}
  if(line.includes('|')&&separator(lines[i+1])){const rows=[cells(line)];i+=2;while(i<lines.length&&lines[i].trim()&&lines[i].includes('|'))rows.push(cells(lines[i++]));const width=Math.max(...rows.map(r=>r.length));out.push({type:'table',rows:rows.map(r=>Array.from({length:width},(_,n)=>r[n]||''))});continue;}
  const item=/^\s*(?:[-*+] |\d+[.)] )(.+)$/.exec(line);if(item){const ordered=/^\s*\d/.test(line),items=[];while(i<lines.length){const m=/^\s*(?:[-*+] |\d+[.)] )(.+)$/.exec(lines[i]);if(!m||/^\s*\d/.test(lines[i])!==ordered)break;items.push(inlineText(m[1]));i++;}out.push({type:'list',ordered,items});continue;}
  if(/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)){i++;continue;}
  out.push({type:'paragraph',text:inlineText(line.replace(/^>\s?/,''))});i++;
 }
 return out;
}
