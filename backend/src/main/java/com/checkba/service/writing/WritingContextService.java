// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.writing;

import com.checkba.model.entity.ProjectFile;
import com.checkba.model.entity.ProjectVariable;
import com.checkba.repository.ProjectFileRepository;
import com.checkba.repository.ProjectVariableRepository;
import com.checkba.service.DocumentTextService;
import com.checkba.service.LangText;
import com.checkba.service.ProjectMemberService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.LocalDate;
import java.util.*;
import static com.checkba.service.writing.WritingTypes.*;

/** Context is explicitly selected and project scoped; never scans all project bodies while typing. */
@Service
public class WritingContextService {
    private final ProjectFileRepository files;
    private final ProjectVariableRepository variables;
    private final DocumentTextService texts;
    private final ProjectMemberService members;
    private final List<WritingProfile> profiles;
    public WritingContextService(ProjectFileRepository files, ProjectVariableRepository variables,
            DocumentTextService texts, ProjectMemberService members, List<WritingProfile> profiles) {
        this.files=files; this.variables=variables; this.texts=texts; this.members=members; this.profiles=profiles;
    }
    public record FileOption(Long id, String name) {}
    public record Settings(String stance, String cutoffDate, List<FileOption> files) {}
    public record SettingsInput(String stance, String cutoffDate) {}
    public record Request(Long fileId, String revision, String documentText, String before, String after,
                          String selection, String title, String section, String documentType, List<Long> sourceFileIds) {}
    public record Snapshot(Long projectId, Long userId, Request request, Settings settings, Context context,
                           WritingProfile profile, List<Source> sources, List<Fact> facts, List<String> warnings) {}
    private static final String STANCE="写作立场", CUTOFF="核查基准日";
    public void require(Long userId, Long projectId, boolean write) {
        if (userId == null || projectId == null || !(write ? members.hasWritePermission(projectId,userId)
                : members.hasReadPermission(projectId,userId))) throw new IllegalArgumentException(LangText.of("无权使用此项目的写作上下文", "No permission to use writing context for this project"));
    }
    private String value(Long projectId, String name) {
        return variables.findByProjectIdAndName(projectId,name).map(v -> clean(v.getValue())).orElse("");
    }
    public Settings settings(Long userId, Long projectId) {
        require(userId,projectId,false);
        var options=files.findByProjectIdAndIsDeletedFalseOrderBySortOrderAsc(projectId).stream()
                .filter(f -> !Boolean.TRUE.equals(f.getIsFolder())).limit(300)
                .map(f -> new FileOption(f.getId(),f.getName())).toList();
        return new Settings(value(projectId,STANCE),value(projectId,CUTOFF),options);
    }
    @Transactional
    public Settings saveSettings(Long userId, Long projectId, SettingsInput input) {
        require(userId,projectId,true);
        if(input==null) throw new IllegalArgumentException(LangText.of("请填写项目上下文", "Please provide project writing context"));
        String stance=bounded(input.stance(),120), cutoff=bounded(input.cutoffDate(),10);
        if(!cutoff.isBlank()) { try { LocalDate.parse(cutoff); } catch(Exception e) { throw new IllegalArgumentException(LangText.of("基准日须为有效的 YYYY-MM-DD 日期", "Cut-off date must be a valid YYYY-MM-DD date")); } }
        put(projectId,userId,STANCE,stance); put(projectId,userId,CUTOFF,cutoff);
        return settings(userId,projectId);
    }
    private void put(Long projectId, Long userId, String name, String value) {
        ProjectVariable v=variables.findByProjectIdAndName(projectId,name).orElseGet(ProjectVariable::new);
        v.setProjectId(projectId); v.setName(name); v.setValue(value); v.setType("TEXT");
        v.setVariableGroup("写作上下文"); if(v.getCreatorId()==null) v.setCreatorId(userId); variables.save(v);
    }
    private ProjectFile file(Long projectId, Long id) {
        ProjectFile f=id==null?null:files.findById(id).orElse(null);
        if(f==null || !projectId.equals(f.getProjectId()) || Boolean.TRUE.equals(f.getIsDeleted()) || Boolean.TRUE.equals(f.getIsFolder()))
            throw new IllegalArgumentException(LangText.of("参考文档不可用或不属于当前项目", "Reference document is unavailable or does not belong to this project"));
        if(f.getFileSize()!=null && f.getFileSize()>8*1024*1024) throw new IllegalArgumentException(LangText.of("请选用 8 MB 以内的文本材料", "Please select reference materials under 8 MB"));
        return f;
    }
    private String extract(ProjectFile f) {
        try { return Objects.toString(texts.extractText(f),""); }
        catch(Exception e) { throw new IllegalArgumentException(LangText.of("无法读取参考文档，请确认文本可提取", "Unable to read reference document; please ensure text is extractable")); }
    }
    public Snapshot capture(Long userId, Long projectId, Request r) {
        require(userId,projectId,true);
        if(r==null || clean(r.revision()).isEmpty()) throw new IllegalArgumentException(LangText.of("缺少文档快照", "Document snapshot is required"));
        file(projectId,r.fileId());
        bounded(r.revision(),160); bounded(r.title(),300); bounded(r.section(),300); bounded(r.documentType(),40);
        String body=bounded(r.documentText(),16000), before=bounded(r.before(),2000), after=bounded(r.after(),2000);
        bounded(r.selection(),2000);
        var ids=r.sourceFileIds()==null?List.<Long>of():r.sourceFileIds();
        if(ids.size()>4 || ids.stream().anyMatch(Objects::isNull)) throw new IllegalArgumentException(LangText.of("最多选择 4 份参考材料", "Select up to 4 reference documents"));
        // Validate the whole selection before extracting any file.
        var selected=ids.stream().distinct().filter(id -> !id.equals(r.fileId())).map(id -> file(projectId,id)).toList();
        List<Source> sources=new ArrayList<>(); List<String> warnings=new ArrayList<>();
        sources.add(new Source("active-document",r.fileId(),clean(r.title()),r.revision()+":"+hash(body),LangText.of("当前文档文本快照", "Active document text snapshot"),body));
        for(ProjectFile f:selected) {
            String text=extract(f), version=version(f,text);
            if(text.isBlank()) warnings.add(LangText.of("“"+f.getName()+"”没有可提取文本，不能作为事实来源", "\"" + f.getName() + "\" has no extractable text and cannot be used as a factual source"));
            if(text.length()>6000) warnings.add(LangText.of("“"+f.getName()+"”仅纳入前 6000 字；未阅读部分不作结论", "\"" + f.getName() + "\" includes only the first 6,000 characters; unread portions are not used for conclusions"));
            sources.add(new Source("file:"+f.getId(),f.getId(),f.getName(),version,LangText.of("文本第 1 至 "+Math.min(6000,text.length())+" 字", "Characters 1 to " + Math.min(6000, text.length())),text.substring(0,Math.min(6000,text.length()))));
        }
        Settings settings=settings(userId,projectId);
        Context c=new Context(r.documentType(),clean(r.title()),clean(r.section()),before,after,settings.stance(),settings.cutoffDate());
        WritingProfile profile=profiles.stream().filter(p -> clean(r.documentType()).equals(p.id()) || clean(r.documentType()).isEmpty() || "auto".equals(r.documentType()))
                .filter(p -> p.score(c,sources)>0).max(Comparator.comparingInt(p -> p.score(c,sources))).orElse(null);
        var facts=profile==null?List.<Fact>of():WritingNarrativeSources.append(profile.id(),c,sources,profile.facts(c,sources)).stream()
                .filter(f -> sources.stream().anyMatch(s -> s.id().equals(f.sourceId()) && !clean(f.quote()).isEmpty() && s.text().contains(f.quote()))).limit(200).toList();
        if(profile==null) warnings.add(LangText.of("文书类型尚未识别；可手动选择，或继续使用普通词语补全", "Document type not yet identified; you may select it manually or continue with general completion"));
        if(settings.stance().isBlank()) warnings.add(LangText.of("尚未设置项目写作立场；不会推定代理对象", "Project writing stance is not set; represented party will not be inferred"));
        return new Snapshot(projectId,userId,r,settings,c,profile,List.copyOf(sources),facts,List.copyOf(warnings));
    }
    /** Authorization and selected file contents are checked again immediately before insertion authorization. */
    public void revalidate(Snapshot s, String revision) {
        require(s.userId(),s.projectId(),true);
        file(s.projectId(),s.request().fileId());
        if(!Objects.equals(s.request().revision(),revision)) throw new IllegalArgumentException(LangText.of("文档已变化，请重新生成建议", "Document has changed; please regenerate suggestions"));
        if(!s.settings().stance().equals(value(s.projectId(),STANCE)) || !s.settings().cutoffDate().equals(value(s.projectId(),CUTOFF)))
            throw new IllegalArgumentException(LangText.of("项目上下文已变化，请重新生成建议", "Project writing context has changed; please regenerate suggestions"));
        for(Source source:s.sources()) if(!source.id().equals("active-document")) {
            ProjectFile f=file(s.projectId(),source.fileId());
            if(!source.version().equals(version(f,extract(f)))) throw new IllegalArgumentException(LangText.of("参考材料已变化，请重新生成建议", "Reference materials have changed; please regenerate suggestions"));
        }
    }
    private static String version(ProjectFile f,String text) { return hash(f.getId()+"|"+f.getName()+"|"+f.getUpdatedAt()+"|"+text); }
    static String bounded(String s,int max) { s=Objects.toString(s,""); if(s.length()>max) throw new IllegalArgumentException(LangText.of("上下文超过长度上限", "Context exceeds maximum length")); return s; }
    public static String hash(String text) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8))); }
        catch(java.security.NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }
}
