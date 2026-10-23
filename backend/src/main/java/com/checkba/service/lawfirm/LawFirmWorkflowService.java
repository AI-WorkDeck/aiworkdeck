// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.lawfirm;

import com.checkba.model.entity.User;
import com.checkba.model.entity.lawfirm.*;
import com.checkba.repository.lawfirm.*;
import com.checkba.service.messagecenter.MessageCenterService;
import jakarta.persistence.EntityManager;
import jakarta.persistence.LockModeType;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.*;

/** Cloud authority for explicitly submitted conflicts. No legacy table, local project or financial data access. */
@Service @RequiredArgsConstructor
public class LawFirmWorkflowService {
    private final LawFirmAuthority authority;
    private final LawFirmCommitteeAppointmentRepository appointments;
    private final LawFirmWorkflowRepository workflows;
    private final LawFirmWorkflowClearanceRepository clearances;
    private final LawFirmWorkflowScopeRepository scopes;
    private final LawFirmConflictEngine engine;
    private final MessageCenterService notices;
    private final EntityManager entities;
    private final PlatformTransactionManager transactionManager;
    public static final Set<String> ACTIONS=Set.of("workflowOverview","workflowLookup","workflowAppoint","workflowAppointmentDecision",
            "workflowSubmit","workflowDetail","workflowClearance","workflowReview");

    public Map<String,Object> execute(Long userId,String action,Map<String,Object> raw) {
        boolean submission="workflowSubmit".equals(action);
        LawFirmAuthority.Member me=authority.current(userId);
        TransactionTemplate transaction=new TransactionTemplate(transactionManager);
        if(submission) {
            ensureScope(me.firmId());
            transaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
            transaction.setIsolationLevel(TransactionDefinition.ISOLATION_READ_COMMITTED);
        }
        return transaction.execute(status->{
            if(submission) scopes.lockByFirmId(me.firmId()).orElseThrow(LawFirmAuthority::denied);
            return executeTransaction(me,action,raw);
        });
    }

    private Map<String,Object> executeTransaction(LawFirmAuthority.Member me,String action,Map<String,Object> raw) {
        Map<String,Object> p=raw==null?Map.of():raw;
        return switch(action) {
            case "workflowOverview" -> overview(me);
            case "workflowLookup" -> Map.of("member",authority.lookup(me.userId(),text(p,"identifier",254,true)));
            case "workflowAppoint" -> appoint(me,p);
            case "workflowAppointmentDecision" -> appointmentDecision(me,p);
            case "workflowSubmit" -> submit(me,p);
            case "workflowDetail" -> view(requireWorkflow(me,uuid(p,"recordId"),false),me);
            case "workflowClearance" -> decideClearance(me,p);
            case "workflowReview" -> review(me,p);
            default -> throw new IllegalArgumentException("不支持的云端利冲操作");
        };
    }

    private void ensureScope(String firm) {
        TransactionTemplate create=new TransactionTemplate(transactionManager);
        create.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        try {
            create.executeWithoutResult(status->{
                if(!scopes.existsById(firm)) {var row=new LawFirmWorkflowScope();row.setFirmId(firm);scopes.saveAndFlush(row);}
            });
        } catch(org.springframework.dao.DataIntegrityViolationException concurrentCreate) {
            // The failed insert transaction has rolled back. Re-read in a clean transaction, never continue it.
            if(!Boolean.TRUE.equals(create.execute(status->scopes.existsById(firm)))) throw concurrentCreate;
        }
    }

    private Map<String,Object> overview(LawFirmAuthority.Member me) {
        List<Map<String,Object>> committee=new ArrayList<>();
        for (LawFirmCommitteeAppointment a:appointments.findByFirmId(me.firmId())) {
            if (!me.firmAdmin() && !Objects.equals(a.getUserId(),me.userId()) && !"ACCEPTED".equals(a.getState())) continue;
            try { committee.add(appointmentView(a,authority.requireMember(me.userId(),a.getUserId()))); }
            catch (IllegalArgumentException revoked) { /* A departed member is no longer selectable. */ }
        }
        List<Map<String,Object>> records=new ArrayList<>();
        for(LawFirmWorkflow w:workflows.findByFirmIdOrderByCreatedAtDesc(me.firmId())) if (visible(w,me)) records.add(view(w,me));
        return Map.of("self",me,"committee",committee,"records",records);
    }

    private Map<String,Object> appoint(LawFirmAuthority.Member me,Map<String,Object> p) {
        if(!me.firmAdmin()) throw LawFirmAuthority.denied();
        Long target=number(p,"userId");
        var candidate=authority.requireMember(me.userId(),target);
        lockUsers(List.of(me.userId(),target)); // Same lock order as the notification adapter.
        var a=appointments.findByFirmIdAndUserId(me.firmId(),target).orElse(null);
        boolean revoke="REVOKE".equals(text(p,"decision",20,false));
        if(revoke && a==null) throw new IllegalArgumentException("委员指派不存在");
        if(a!=null && ((!revoke && Set.of("PENDING","ACCEPTED").contains(a.getState())) || (revoke && "REVOKED".equals(a.getState()))))
            return appointmentView(a,candidate);
        if(revoke) notices.updateBusinessState("lawfirm","appointment/"+a.getId()+"/"+a.getVersion(),List.of(target),"cancelled");
        if(a==null) { a=new LawFirmCommitteeAppointment();a.setId(UUID.randomUUID().toString());a.setFirmId(me.firmId());a.setUserId(target); }
        a.setAppointedBy(me.userId());a.setState(revoke?"REVOKED":"PENDING");a.setUpdatedAt(Instant.now());
        appointments.saveAndFlush(a);
        String event="appointment/"+a.getId()+"/"+a.getVersion();
        notify(me.userId(),List.of(target),event,"COMMITTEE_APPOINTMENT",revoke?"利冲委员指派已撤销":"请确认利冲委员指派",
                revoke?"你已不再具备该律所的利冲终审权限。":"律所管理员邀请你担任利冲委员，请在律所管理中接受或拒绝。",revoke?"CANCELLED":"PENDING",a.getId());
        return appointmentView(a,candidate);
    }

    private Map<String,Object> appointmentDecision(LawFirmAuthority.Member me,Map<String,Object> p) {
        var a=appointments.findById(uuid(p,"recordId")).orElseThrow(LawFirmAuthority::denied);
        if(!Objects.equals(a.getFirmId(),me.firmId()) || !Objects.equals(a.getUserId(),me.userId())) throw LawFirmAuthority.denied();
        lockUsers(List.of(me.userId(),a.getAppointedBy()));
        entities.clear();
        a=appointments.findByFirmIdAndUserId(me.firmId(),me.userId()).orElseThrow(LawFirmAuthority::denied);
        String decision=text(p,"decision",20,true);
        if(!Set.of("ACCEPTED","DECLINED").contains(decision)) throw new IllegalArgumentException("请选择接受或拒绝指派");
        long expectedVersion=expectedVersion(p);
        // A successful decision advances exactly one version. Repeating that exact request remains idempotent.
        if(decision.equals(a.getState()) && expectedVersion==a.getVersion()-1) return appointmentView(a,me);
        if(expectedVersion!=a.getVersion()) throw new IllegalStateException("该委员指派版本已变更，请刷新后确认当前邀请");
        if(!"PENDING".equals(a.getState())) throw new IllegalStateException("该委员指派已变更，请刷新");
        String oldEvent="appointment/"+a.getId()+"/"+a.getVersion();
        a.setState(decision);a.setUpdatedAt(Instant.now());appointments.saveAndFlush(a);
        notices.updateBusinessState("lawfirm",oldEvent,List.of(me.userId()),"done");
        notify(me.userId(),List.of(a.getAppointedBy()),"appointment/"+a.getId()+"/decision/"+a.getVersion(),"COMMITTEE_RECEIPT",
                "委员指派已有回复",me.name()+ ("ACCEPTED".equals(decision)?"已接受利冲委员指派。":"已拒绝利冲委员指派。"),"COMPLETED",a.getId());
        return appointmentView(a,me);
    }

    private Map<String,Object> submit(LawFirmAuthority.Member me,Map<String,Object> p) {
        String id=uuid(p,"requestId");
        String title=text(p,"title",256,true),client=text(p,"clientName",256,true),counter=text(p,"counterpartyName",256,false);
        String practice=text(p,"practiceArea",64,false);
        Long lead=number(p,"leadId"),reviewer=number(p,"committeeId");
        authority.requireMember(me.userId(),lead); authority.requireMember(me.userId(),reviewer);
        if(Objects.equals(reviewer,me.userId()) || Objects.equals(reviewer,lead)) throw new IllegalArgumentException("申请人和主办律师不能终审自己的申请，请选择另一位委员");
        Map<Long,String> requested=new TreeMap<>();
        Map<Long,String> privateDetails=new HashMap<>();
        if(p.get("related") instanceof List<?> rows) {
            if(rows.size()>20) throw new IllegalArgumentException("一次最多向20位关联律师征询");
            for(Object value:rows) {
                if(!(value instanceof Map<?,?> row)) throw new IllegalArgumentException("征询信息无效");
                Long target=number(row,"userId");authority.requireMember(me.userId(),target);
                requested.put(target,text(row,"summary",2000,true));
            }
        }
        String hash=hash(List.of(title,client,counter,practice,lead,reviewer,requested));
        var old=workflows.findById(id).orElse(null);
        if(old!=null) {
            if(!Objects.equals(old.getApplicantId(),me.userId()) || !old.getFirmId().equals(me.firmId()) || !old.getRequestHash().equals(hash))
                throw new IllegalArgumentException("该发送编号已用于其他内容，请刷新后重试");
            return view(old,me);
        }
        // Conflict scan is restricted to new, explicitly submitted records in this exact firm.
        List<LawFirmWorkflow> previous=workflows.findByFirmIdOrderByCreatedAtDesc(me.firmId());
        var draft=projection(null,title,client,counter,practice,lead,me.userId());
        List<LawFirmMatterIntake> corpus=previous.stream().map(w -> projection(w,w.getTitle(),w.getClientName(),w.getCounterpartyName(),w.getPracticeArea(),w.getLeadId(),w.getApplicantId())).toList();
        var check=engine.evaluateConflict(draft,corpus,List.of(),Map.of());
        for(var hit:check.getHits()) if(hit.getHandlerUserId()!=null) {
            Long target=hit.getHandlerUserId();authority.requireMember(me.userId(),target);
            String rule=Objects.toString(hit.getRuleTitle(),"");
            requested.merge(target,"系统发现该律师承办案件存在关联；核查事项："+rule,(a,b)->clip(a+"\n"+b,4000));
            String detail="本人关联案件："+Objects.toString(hit.getMatchedMatterTitle(),"")+"；命中主体："+Objects.toString(hit.getMatchedPartyName(),"")+"；核查事项："+rule;
            privateDetails.merge(target,clip(detail,4000),(a,b)->clip(a+"\n"+b,4000));
        }
        if(requested.size()>20) throw new IllegalArgumentException("关联律师超过20位，请先由律所管理员分批核查");
        if(requested.containsKey(reviewer)) throw new IllegalArgumentException("所选委员同时是本次被征询律师，请改由未涉及本次征询的委员终审");
        List<Long> locks=new ArrayList<>(requested.keySet());locks.addAll(List.of(me.userId(),lead,reviewer));lockUsers(locks);
        old=workflows.findById(id).orElse(null);
        if(old!=null) {
            if(!Objects.equals(old.getApplicantId(),me.userId())||!old.getFirmId().equals(me.firmId())||!old.getRequestHash().equals(hash))throw new IllegalArgumentException("发送编号已用于其他内容");
            return view(old,me);
        }
        requireAcceptedCommittee(me,reviewer);
        LawFirmWorkflow w=new LawFirmWorkflow();w.setId(id);w.setFirmId(me.firmId());w.setApplicantId(me.userId());w.setLeadId(lead);w.setCommitteeId(reviewer);
        w.setTitle(title);w.setClientName(client);w.setCounterpartyName(counter);w.setPracticeArea(practice);w.setRequestHash(hash);
        w.setRisk(check.getRiskLevel());w.setStatus(requested.isEmpty()?"PENDING_COMMITTEE_REVIEW":"PENDING_LAWYER_CLEARANCE");w.setCreatedAt(Instant.now());w.setUpdatedAt(w.getCreatedAt());
        workflows.saveAndFlush(w);
        for(var entry:requested.entrySet()) {
            var c=new LawFirmWorkflowClearance();c.setId(UUID.randomUUID().toString());c.setWorkflowId(id);c.setTargetId(entry.getKey());c.setSummary(entry.getValue());c.setPrivateSummary(privateDetails.get(entry.getKey()));c.setDecision("PENDING");clearances.save(c);
            notify(me.userId(),List.of(c.getTargetId()),"workflow/"+id+"/clearance/"+c.getTargetId(),"CONFLICT_CLEARANCE","待你确认："+title,
                    "有一项关联案件利冲征询需要本人确认，请打开律所管理查看与你有关的摘要。","PENDING",id);
        }
        if(requested.isEmpty()) notifyCommittee(w,me.userId());
        return view(w,me);
    }

    private LawFirmMatterIntake projection(LawFirmWorkflow w,String title,String client,String counter,String practice,Long lead,Long applicant) {
        return LawFirmMatterIntake.builder().title(title).clientName(client).counterpartyName(counter).practiceArea(practice)
                .leadLawyerUserId(lead).applicantUserId(applicant).status(w==null?"DRAFT":"REJECTED".equals(w.getStatus())?"REJECTED_CONFLICT":"APPROVED_FILED").build();
    }

    private Map<String,Object> decideClearance(LawFirmAuthority.Member me,Map<String,Object> p) {
        LawFirmWorkflow w=requireWorkflow(me,uuid(p,"recordId"),true);
        String decision=text(p,"decision",24,true),comment=text(p,"comment",2000,true);
        if(!Set.of("APPROVED","APPROVED_WITH_WALL","REJECTED").contains(decision)) throw new IllegalArgumentException("征询决定无效");
        var all=clearances.findByWorkflowId(w.getId());
        var c=all.stream().filter(x->Objects.equals(x.getTargetId(),me.userId())).findFirst().orElseThrow(LawFirmAuthority::denied);
        if(!"PENDING".equals(c.getDecision())) {
            if(decision.equals(c.getDecision()) && Objects.equals(comment,c.getComment())) return view(w,me);
            throw new IllegalStateException("该征询已处理，请刷新查看");
        }
        if(!"PENDING_LAWYER_CLEARANCE".equals(w.getStatus())) throw new IllegalStateException("申请已结束或进入终审，不能继续放行");
        c.setDecision(decision);c.setComment(comment);c.setDecidedAt(Instant.now());clearances.saveAndFlush(c);
        notices.updateBusinessState("lawfirm","workflow/"+w.getId()+"/clearance/"+me.userId(),List.of(me.userId()),"done");
        if("REJECTED".equals(decision)) {
            w.setStatus("REJECTED");
            for(var pending:all) if("PENDING".equals(pending.getDecision()))
                notices.updateBusinessState("lawfirm","workflow/"+w.getId()+"/clearance/"+pending.getTargetId(),List.of(pending.getTargetId()),"cancelled");
        }
        else if(all.stream().allMatch(x->!"PENDING".equals(x.getDecision()))) {w.setStatus("PENDING_COMMITTEE_REVIEW");notifyCommittee(w,me.userId());}
        w.setUpdatedAt(Instant.now());workflows.saveAndFlush(w);
        notify(me.userId(),List.of(w.getApplicantId()),"workflow/"+w.getId()+"/receipt/"+me.userId(),"CLEARANCE_RECEIPT","关联律师已回复："+w.getTitle(),"请在律所管理查看征询回复与当前状态。","COMPLETED",w.getId());
        return view(w,me);
    }

    private Map<String,Object> review(LawFirmAuthority.Member me,Map<String,Object> p) {
        LawFirmWorkflow w=requireWorkflow(me,uuid(p,"recordId"),true);
        if(!Objects.equals(w.getCommitteeId(),me.userId()) || Objects.equals(w.getApplicantId(),me.userId()) || Objects.equals(w.getLeadId(),me.userId())) throw LawFirmAuthority.denied();
        requireAcceptedCommittee(me,me.userId());
        String decision=text(p,"decision",20,true),comment=text(p,"comment",2000,true);
        if(!Set.of("APPROVED","REJECTED").contains(decision)) throw new IllegalArgumentException("终审决定无效");
        if(Set.of("APPROVED","REJECTED").contains(w.getStatus())) {
            if(decision.equals(w.getStatus()) && Objects.equals(comment,w.getDecisionComment())) return view(w,me);
            throw new IllegalStateException("该申请已终结，请刷新查看");
        }
        if(!"PENDING_COMMITTEE_REVIEW".equals(w.getStatus())) throw new IllegalStateException("关联律师尚未全部放行");
        w.setStatus(decision);w.setDecisionComment(comment);w.setUpdatedAt(Instant.now());workflows.saveAndFlush(w);
        notices.updateBusinessState("lawfirm","workflow/"+w.getId()+"/committee",List.of(me.userId()),"done");
        notify(me.userId(),new ArrayList<>(new LinkedHashSet<>(List.of(w.getApplicantId(),w.getLeadId()))),"workflow/"+w.getId()+"/review","COMMITTEE_RESULT",
                "利冲终审已有结论："+w.getTitle(),"APPROVED".equals(decision)?"指定委员已终审通过。该结果不代表已在本机创建项目。":"指定委员已终审拒绝，请查看意见。","COMPLETED",w.getId());
        return view(w,me);
    }

    private void notifyCommittee(LawFirmWorkflow w,Long actor) {
        authority.requireMember(actor,w.getCommitteeId());
        notify(actor,List.of(w.getCommitteeId()),"workflow/"+w.getId()+"/committee","COMMITTEE_REVIEW","待你终审："+w.getTitle(),"关联律师征询已完成，请在律所管理核查并亲自作出决定。","PENDING",w.getId());
    }
    private void notify(Long actor,List<Long> recipients,String key,String kind,String title,String body,String state,String record) {
        for(Long recipient:recipients) authority.requireMember(actor,recipient);
        String notificationState="PENDING".equals(state)?"pending":"CANCELLED".equals(state)?"cancelled":"done";
        notices.publishAuthorizedBusiness("lawfirm","律所利冲",actor,recipients,null,key,kind,clip(title,256),body,notificationState,
                Map.of("kind","plugin","pluginId","lawfirm-management","view","conflicts","recordId",record));
    }
    private void requireAcceptedCommittee(LawFirmAuthority.Member me,Long user) {
        authority.requireMember(me.userId(),user);
        if(!appointments.findByFirmIdAndUserId(me.firmId(),user).map(a->"ACCEPTED".equals(a.getState())).orElse(false))
            throw new IllegalArgumentException("该委员尚未接受指派或指派已撤销，请刷新选择");
    }
    private boolean accepted(String firm,Long user) { return appointments.findByFirmId(firm).stream().anyMatch(a->Objects.equals(a.getUserId(),user)&&"ACCEPTED".equals(a.getState())); }
    private LawFirmWorkflow requireWorkflow(LawFirmAuthority.Member me,String id,boolean lock) {
        if(lock) {
            var initial=workflows.findById(id).orElseThrow(LawFirmAuthority::denied);
            if(!initial.getFirmId().equals(me.firmId())||!visible(initial,me))throw LawFirmAuthority.denied();
            List<Long> ids=new ArrayList<>(List.of(me.userId(),initial.getApplicantId(),initial.getLeadId(),initial.getCommitteeId()));
            clearances.findByWorkflowId(id).forEach(c->ids.add(c.getTargetId()));lockUsers(ids);
            entities.clear(); // Reload workflow and clearance state after waiting for the common user locks.
        }
        var w=(lock?workflows.lockById(id):workflows.findById(id)).orElseThrow(LawFirmAuthority::denied);
        if(!w.getFirmId().equals(me.firmId()) || !visible(w,me)) throw LawFirmAuthority.denied();
        return w;
    }
    private boolean visible(LawFirmWorkflow w,LawFirmAuthority.Member me) {
        if(!w.getFirmId().equals(me.firmId())) return false;
        return Objects.equals(w.getApplicantId(),me.userId()) || Objects.equals(w.getLeadId(),me.userId())
                || (Objects.equals(w.getCommitteeId(),me.userId()) && accepted(me.firmId(),me.userId()))
                || clearances.findByWorkflowId(w.getId()).stream().anyMatch(c->Objects.equals(c.getTargetId(),me.userId()));
    }
    private Map<String,Object> view(LawFirmWorkflow w,LawFirmAuthority.Member me) {
        boolean full=Objects.equals(w.getApplicantId(),me.userId())||Objects.equals(w.getLeadId(),me.userId())
                ||(Objects.equals(w.getCommitteeId(),me.userId())&&accepted(me.firmId(),me.userId()));
        Map<String,Object> out=new LinkedHashMap<>();out.put("id",w.getId());out.put("title",w.getTitle());out.put("status",w.getStatus());out.put("risk",w.getRisk());out.put("version",w.getVersion());
        out.put("applicantId",w.getApplicantId());out.put("leadId",w.getLeadId());out.put("committeeId",w.getCommitteeId());
        if(full){out.put("clientName",w.getClientName());out.put("counterpartyName",w.getCounterpartyName());out.put("decisionComment",w.getDecisionComment());}
        var relevantClearances=clearances.findByWorkflowId(w.getId());
        if(relevantClearances.stream().anyMatch(c->Objects.equals(c.getTargetId(),me.userId())))
            out.put("consultationContext",Map.of("title",w.getTitle(),"clientName",w.getClientName(),"counterpartyName",Objects.toString(w.getCounterpartyName(),"")));
        out.put("clearances",relevantClearances.stream().filter(c->full||Objects.equals(c.getTargetId(),me.userId())).map(c->{
            Map<String,Object> row=new LinkedHashMap<>();row.put("targetId",c.getTargetId());
            row.put("summary",c.getSummary()+(Objects.equals(c.getTargetId(),me.userId())&&c.getPrivateSummary()!=null?"\n"+c.getPrivateSummary():""));
            row.put("decision",c.getDecision());row.put("comment",c.getComment());return row;
        }).toList());
        out.put("canReview",Objects.equals(w.getCommitteeId(),me.userId())&&accepted(me.firmId(),me.userId())&&"PENDING_COMMITTEE_REVIEW".equals(w.getStatus()));
        return out;
    }
    private Map<String,Object> appointmentView(LawFirmCommitteeAppointment a,LawFirmAuthority.Member member) {
        return Map.of("id",a.getId(),"member",member,"state",a.getState(),"version",a.getVersion());
    }
    public boolean canAccess(Long userId,String eventKey) {
        try {
            var me=authority.current(userId);String[] parts=eventKey.split("/");
            if(parts.length<2)return false;
            if("appointment".equals(parts[0])) return appointments.findById(parts[1]).filter(a->a.getFirmId().equals(me.firmId())&&(Objects.equals(a.getUserId(),userId)||Objects.equals(a.getAppointedBy(),userId))).isPresent();
            return "workflow".equals(parts[0])&&workflows.findById(parts[1]).filter(w->visible(w,me)).isPresent();
        } catch(LawFirmAuthority.AccessDenied denied){return false;}
    }
    private void lockUsers(Collection<Long> ids) {for(Long id:new TreeSet<>(ids))if(entities.find(User.class,id,LockModeType.PESSIMISTIC_WRITE)==null)throw LawFirmAuthority.denied();}
    private static long expectedVersion(Map<String,Object> p) {try {long version=Long.parseLong(String.valueOf(p.get("expectedVersion")));if(version>=0)return version;}catch(NumberFormatException ignored){}throw new IllegalArgumentException("请刷新后确认当前委员邀请版本");}
    private static Long number(Map<?,?> p,String key) {Object v=p.get(key);try {long n=Long.parseLong(String.valueOf(v));if(n>0)return n;}catch(NumberFormatException ignored){}throw new IllegalArgumentException("请选择已核验的真实账户");}
    private static String uuid(Map<?,?> p,String key) {String v=text(p,key,36,true);try{return UUID.fromString(v).toString();}catch(IllegalArgumentException e){throw new IllegalArgumentException("记录编号无效");}}
    private static String text(Map<?,?> p,String key,int max,boolean required) {String v=p.get(key)==null?"":String.valueOf(p.get(key)).trim();if(v.length()>max||(required&&v.isBlank()))throw new IllegalArgumentException("请核对字段："+key);return v;}
    private static String clip(String value,int n){return value.substring(0,Math.min(value.length(),n));}
    private static String hash(Object value){try{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsBytes(value)));}catch(Exception e){throw new IllegalStateException(e);}}
}
