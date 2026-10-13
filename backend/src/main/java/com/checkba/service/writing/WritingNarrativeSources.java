// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.writing;

import java.util.*;
import java.util.regex.Pattern;
import static com.checkba.service.writing.WritingTypes.*;

/** A short paragraph is source prose, not a verified fact. Preserve attribution and negatives intact. */
public final class WritingNarrativeSources {
    private WritingNarrativeSources() {}
    private static final Pattern CLAIM=Pattern.compile("^(原告|被告|第三人)(?:主张|认为|辩称|抗辩|称)[：:]?.+");
    private static final Pattern GENERAL_CLAIM=Pattern.compile("^(原告|被告|第三人)(?:主张|认为|辩称|抗辩|称)[：:]?.*");
    private static final Pattern SENTENCE_END=Pattern.compile("[。！？][”’\"')）]*|[.!?][”’\"')）]*(?=\\s|$)");
    public static List<Fact> append(String profile,List<Source> sources,List<Fact> structured) {
        // Unknown contract scope must remain unknown; callers should supply the live editor section.
        return append(profile,new Context(profile,"","","","","",""),sources,structured);
    }
    public static List<Fact> append(String profile,Context context,List<Source> sources,List<Fact> structured) {
        List<Fact> out=new ArrayList<>(structured);
        for(Source source:sources) {
            if("contract".equals(profile) && !"active-document".equals(source.id())) continue;
            Map<Integer,String> contractScope="contract".equals(profile)
                    ? ContractWritingProfile.narrativeScope(context,source) : Map.of();
            boolean general="general".equals(profile);
            int index=0, pendingStart=-1, pendingParagraph=0;
            var paragraphs=Pattern.compile("(?s).*?(?:\\R|\\z)").matcher(source.text());
            while(paragraphs.find()) {
                if(paragraphs.start()==paragraphs.end()) continue;
                int paragraph=++index, lastParagraph=index;
                String text=paragraphs.group().strip();
                if(general) {
                    if(pendingStart<0) {
                        if(text.isEmpty()) continue;
                        pendingStart=paragraphs.start(); pendingParagraph=paragraph;
                    }
                    // A line break must not detach a condition from its consequence. Preserve
                    // the original substring (including CRLF); an oversized group is omitted whole.
                    boolean complete=text.matches("(?s).*[。！？.!?][”’\"')）]*$");
                    if(!complete && paragraphs.end()<source.text().length()) continue;
                    text=source.text().substring(pendingStart,paragraphs.end()).strip();
                    if(!complete) {
                        // The current paragraph may end at the caret. Retain its completed
                        // evidence, but never promote the unfinished thought or a decimal point.
                        var endings=SENTENCE_END.matcher(text); int end=0;
                        while(endings.find()) end=endings.end();
                        if(end==0) continue;
                        text=text.substring(0,end);
                    }
                    paragraph=pendingParagraph; pendingStart=-1;
                    lastParagraph=paragraph+text.split("\\R",-1).length-1;
                    if(text.codePoints().noneMatch(Character::isLetter)) continue;
                }
                if((!general && text.length()<12) || text.length()>400 || out.size()>=200)continue;
                if("contract".equals(profile) && !contractScope.containsKey(paragraph)) continue;
                // Never create a second citation path around a structured conflict/missing/role fact.
                String quote=text;
                if(structured.stream().anyMatch(f -> source.id().equals(f.sourceId()) && !clean(f.quote()).isEmpty()
                        && (quote.contains(f.quote().strip()) || f.quote().contains(quote))))continue;
                String status="DOCUMENT_STATES",role="";
                String contractStatus=contractScope.get(paragraph);
                if(contractStatus!=null && !contractStatus.equals("CONTRACT_TERM")) status=contractStatus;
                Pattern claimPattern=general ? GENERAL_CLAIM : CLAIM;
                var claim=claimPattern.matcher(general ? Arrays.stream(text.split("\\R")).map(String::strip)
                        .filter(line -> claimPattern.matcher(line).matches()).findFirst().orElse(text) : text);
                if(claim.matches() && status.equals("DOCUMENT_STATES")) {status="CLAIM";role=claim.group(1);}
                else if("diligence".equals(profile) && text.matches(".*(?:未取得|未提供|未收到|无法读取|未能取得).*"))status="MISSING";
                out.add(new Fact("prose:"+source.id()+":"+paragraph,"SOURCE_TEXT","材料第"+paragraph+(lastParagraph==paragraph?"段":"至"+lastParagraph+"段"),text,role,status,source.id(),text));
            }
        }
        return List.copyOf(out);
    }
}
