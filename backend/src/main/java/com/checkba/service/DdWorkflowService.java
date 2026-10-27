// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service;

import com.checkba.model.entity.*;
import com.checkba.repository.*;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.LocalDateTime;
import java.util.*;

/** Published checklists, immutable submission versions and the lawyer's final decision. */
@Service
@RequiredArgsConstructor
public class DdWorkflowService {
    private final DdRequestRepository requests;
    private final DdItemRepository items;
    private final DdSubmissionRepository submissions;
    private final DdNotificationRepository notifications;
    private final ProjectFileRepository files;
    private final ProjectMemberRepository members;
    private final ProjectRepository projects;
    private final ProjectMemberService permissions;
    private final ProjectFileAccessService fileAccess;
    private final DdService ddService;
    private final ApplicationEventPublisher events;
    private final ObjectMapper mapper;
    @jakarta.persistence.PersistenceContext
    private jakarta.persistence.EntityManager entityManager;

    public List<DdRequest> visibleRequests(Long projectId, Long userId) {
        requireMember(projectId, userId);
        return requests.findByProjectIdOrderByCreatedAtDesc(projectId).stream()
                .filter(r -> !fileAccess.isClient(projectId, userId) || published(r)).toList();
    }

    public void requireVisibleRequest(Long requestId, Long userId) {
        requireVisible(request(requestId), userId);
    }

    public void requireVisibleItem(Long itemId, Long userId) {
        requireVisibleRequest(item(itemId).getDdRequestId(), userId);
    }

    public void requireContributor(Long projectId, Long userId) {
        requireMember(projectId, userId);
        if (members.findByProjectIdAndUserId(projectId, userId)
                .map(m -> "READ_ONLY".equals(m.getRole())).orElse(false)
                || (!fileAccess.isClient(projectId, userId) && !permissions.hasWritePermission(projectId, userId))) {
            throw forbidden("只读成员不能提交或修改材料");
        }
    }

    @Transactional
    public DdRequest publish(Long requestId, boolean aiReviewEnabled, Long userId) {
        DdRequest request = lockRequest(requestId);
        requireStaff(request.getProjectId(), userId);
        if ("PUBLISHED".equals(request.getStatus())) return request;
        if (!"DRAFT".equals(request.getStatus())) throw conflict("归档清单不能重新发布，请复制为新清单");
        List<DdItem> checklist = items.findByDdRequestIdOrderBySortOrderAsc(requestId);
        if (checklist.isEmpty() || checklist.stream().anyMatch(i -> i.getTitle() == null || i.getTitle().isBlank())) {
            throw badRequest("请先添加清单项并填写标题");
        }
        for (DdItem item : checklist) {
            if (item.getCurrentSubmissionId() == null && item.getUploadedFileId() != null) {
                preserveLegacyAttachment(request, item);
                item.setRevision(item.getRevision() + 1);
                items.save(item);
            }
        }
        request.setStatus("PUBLISHED");
        request.setPublishedAt(LocalDateTime.now());
        request.setPublishedBy(userId);
        request.setAiReviewEnabled(aiReviewEnabled);
        requests.save(request);
        for (ProjectMember member : members.findByProjectId(request.getProjectId())) {
            if (fileAccess.isClient(request.getProjectId(), member.getUserId())) {
                notify(request, null, null, member.getUserId(), "PUBLISHED", "publish:" + requestId,
                        "律师已发送尽调清单：" + request.getName());
            }
        }
        return request;
    }

    /** Material import preserves pre-versioning attachments without publishing or notifying clients. */
    @Transactional
    public void prepareMaterials(Long requestId, Long userId) {
        DdRequest request = lockRequest(requestId);
        requireStaff(request.getProjectId(), userId);
        for (DdItem candidate : items.findByDdRequestIdOrderBySortOrderAsc(requestId)) {
            DdItem item = lockItem(candidate.getId());
            if (item.getCurrentSubmissionId() == null && item.getUploadedFileId() != null) {
                preserveLegacyAttachment(request, item);
                item.setRevision(item.getRevision() + 1);
                items.save(item);
            }
        }
    }

    @Transactional
    public DdRequest archive(Long requestId, Long userId) {
        DdRequest request = lockRequest(requestId);
        requireStaff(request.getProjectId(), userId);
        if ("ARCHIVED".equals(request.getStatus())) return request;
        if (!"PUBLISHED".equals(request.getStatus())) throw conflict("只有已发布清单可以归档");
        request.setStatus("ARCHIVED");
        return requests.save(request);
    }

    @Transactional(rollbackFor = Exception.class)
    public DdSubmission submit(Long itemId, List<MultipartFile> attachments, String idempotencyKey,
                               boolean aiConsent, Long userId) throws IOException {
        if (attachments == null || attachments.isEmpty() || attachments.size() > 20
                || attachments.stream().anyMatch(f -> f == null || f.isEmpty())) {
            throw badRequest("每次请上传 1 至 20 个非空文件");
        }
        DdRequest request = lockRequest(requestIdOf(itemId));
        requireSubmissionAccess(request, userId);
        DdItem item = lockItem(itemId);
        String key = required(idempotencyKey, 100, "提交标识");
        String fingerprint = fingerprint(attachments, aiConsent);
        DdSubmission retry = retry(itemId, userId, key, fingerprint);
        if (retry != null) return retry;
        requireOpenItem(item);
        List<Long> fileIds = new ArrayList<>();
        for (MultipartFile attachment : attachments) {
            fileIds.add(ddService.storeAttachment(itemId, attachment, userId).getId());
        }
        DdSubmission submission = newSubmission(request, item, userId, key, fingerprint);
        submission.setFileIds(fileIds);
        submission.setAiConsent(aiConsent);
        submission.setAiStatus(request.getAiReviewEnabled() && aiConsent ? "QUEUED" : "MANUAL_REQUIRED");
        saveSubmission(item, submission);
        notifyStaff(request, item, submission, "SUBMISSION", "submission:" + submission.getId(), "客户提交了材料：" + item.getTitle());
        if ("QUEUED".equals(submission.getAiStatus())) events.publishEvent(new DdSubmissionCreated(submission.getId()));
        return submission;
    }

    @Transactional
    public DdSubmission explain(Long itemId, String type, String reason, String idempotencyKey, Long userId) {
        if (!Set.of("UNAVAILABLE", "NOT_APPLICABLE").contains(type == null ? "" : type)) {
            throw badRequest("请选择暂无法提供或不适用");
        }
        reason = required(reason, 2000, "说明");
        String key = required(idempotencyKey, 100, "提交标识");
        DdRequest request = lockRequest(requestIdOf(itemId));
        requireSubmissionAccess(request, userId);
        DdItem item = lockItem(itemId);
        String fingerprint = digestText("EXPLANATION\n" + type + "\n" + reason);
        DdSubmission retry = retry(itemId, userId, key, fingerprint);
        if (retry != null) return retry;
        requireOpenItem(item);
        DdSubmission submission = newSubmission(request, item, userId, key, fingerprint);
        submission.setType("EXPLANATION");
        submission.setExplanationType(type);
        submission.setReason(reason);
        submission.setAiStatus("MANUAL_REQUIRED");
        saveSubmission(item, submission);
        notifyStaff(request, item, submission, "EXPLANATION", "explanation:" + submission.getId(), "客户提交了材料说明：" + item.getTitle());
        return submission;
    }

    @Transactional
    public DdSubmission appeal(Long itemId, Long submissionId, String reason, Long userId) {
        reason = required(reason, 2000, "复核理由");
        DdRequest request = lockRequest(requestIdOf(itemId));
        requireSubmissionAccess(request, userId);
        DdItem item = lockItem(itemId);
        DdSubmission submission = currentSubmission(item, submissionId);
        boolean pending = submission.getAppealedAt() != null && (submission.getReviewedAt() == null
                || submission.getAppealedAt().isAfter(submission.getReviewedAt()));
        if (pending) {
            if (Objects.equals(submission.getAppealReason(), reason)) return submission;
            throw conflict("复核申请已提交，请等待律师处理");
        }
        if ("APPROVED".equals(submission.getReviewStatus())
                || !("REJECTED".equals(submission.getReviewStatus()) || "FAILED".equals(submission.getAiStatus())
                || "MANUAL_REQUIRED".equals(submission.getAiStatus()))) {
            throw conflict("只有未通过的当前材料可以申请律师复核");
        }
        submission.setReviewStatus("UPLOADED");
        item.setStatus("UPLOADED");
        submission.setAppealReason(reason);
        submission.setAppealedAt(LocalDateTime.now());
        submission.setAppealedBy(userId);
        submissions.save(submission);
        item.setRevision(item.getRevision() + 1);
        items.save(item);
        ddService.addComment(itemId, userId, "申请复核：" + reason);
        notifyStaff(request, item, submission, "APPEAL", "appeal:" + submissionId + ":" + item.getRevision(),
                "客户申请复核：" + item.getTitle());
        return submission;
    }

    @Transactional
    public DdItem review(Long itemId, String status, String reason, Long submissionId, Long revision, Long userId) {
        DdRequest request = lockRequest(requestIdOf(itemId));
        requireStaff(request.getProjectId(), userId);
        if ("ARCHIVED".equals(request.getStatus()) || "COMPLETED".equals(request.getStatus())) throw conflict("归档清单不能修改");
        DdItem item = lockItem(itemId);
        if (item.getCurrentSubmissionId() == null) {
            if (submissionId != null || (revision != null && !revision.equals(item.getRevision()))) throw conflict("材料已更新，请刷新后审核");
            DdItem result = ddService.updateItemStatus(itemId, status, reason, userId);
            result.setRevision(item.getRevision() + 1);
            return items.save(result);
        }
        if (revision == null || !revision.equals(item.getRevision())) throw conflict("材料已更新，请刷新后审核");
        DdSubmission submission = currentSubmission(item, submissionId);
        if (!Set.of("APPROVED", "REJECTED", "UPLOADED").contains(status == null ? "" : status)) throw badRequest("审核状态无效");
        boolean appealPending = submission.getAppealedAt() != null && (submission.getReviewedAt() == null
                || submission.getAppealedAt().isAfter(submission.getReviewedAt()));
        if (status.equals(submission.getReviewStatus()) && !appealPending) throw conflict("该审核结论已生效");
        if ("REJECTED".equals(status)) reason = required(reason, 2000, "退回理由");
        else if (reason != null && reason.length() > 2000) throw badRequest("审核说明过长");
        submission.setReviewStatus(status);
        submission.setReviewReason(reason);
        submission.setReviewedBy(userId);
        submission.setReviewedAt(LocalDateTime.now());
        submissions.save(submission);
        item.setStatus(status);
        item.setRevision(item.getRevision() + 1);
        items.save(item);
        if ("REJECTED".equals(status)) ddService.addComment(itemId, userId, "驳回：" + reason);
        notify(request, item, submission, submission.getSubmittedBy(), "REVIEW", "review:" + submissionId + ":" + item.getRevision(),
                "律师已" + ("APPROVED".equals(status) ? "确认" : "REJECTED".equals(status) ? "退回" : "撤回审核") + "：" + item.getTitle());
        return item;
    }

    public List<Map<String, Object>> history(Long itemId, Long userId) {
        requireVisibleItem(itemId, userId);
        return submissions.findByItemIdOrderByVersionDesc(itemId).stream().map(this::view).toList();
    }

    public Map<Long, Map<String, Object>> currentSubmissions(List<DdItem> checklist) {
        Map<Long, Map<String, Object>> result = new LinkedHashMap<>();
        List<Long> ids = checklist.stream().map(DdItem::getCurrentSubmissionId).filter(Objects::nonNull).toList();
        for (DdSubmission submission : submissions.findAllById(ids)) result.put(submission.getItemId(), view(submission));
        return result;
    }

    public ProjectFile submissionFile(Long itemId, Long submissionId, Long fileId, Long userId) {
        requireVisibleItem(itemId, userId);
        DdSubmission submission = submissions.findById(submissionId).filter(s -> s.getItemId().equals(itemId))
                .orElseThrow(() -> missing("材料版本不存在"));
        if (!submission.getFileIds().contains(fileId)) throw forbidden("该文件不属于此材料版本");
        return files.findById(fileId).filter(f -> submission.getProjectId().equals(f.getProjectId()) && !Boolean.TRUE.equals(f.getIsFolder()))
                .orElseThrow(() -> missing("文件不存在"));
    }

    public List<DdNotification> inbox(Long projectId, Long userId) {
        requireMember(projectId, userId);
        return notificationStates(notifications.findTop100ByProjectIdAndRecipientIdOrderByCreatedAtDesc(projectId, userId), userId);
    }

    /** Recipient-scoped aggregation; revoked projects and unpublished/deleted requests never leak titles. */
    public List<DdNotification> accountInbox(Long userId) {
        if (userId == null) throw forbidden("请先登录");
        return notificationStates(notifications.findTop200ByRecipientIdOrderByCreatedAtDesc(userId), userId);
    }

    private List<DdNotification> notificationStates(List<DdNotification> rows, Long userId) {
        List<DdNotification> result = new ArrayList<>();
        for (DdNotification notification : rows) {
            if (!Objects.equals(notification.getRecipientId(), userId)
                    || !permissions.hasReadPermission(notification.getProjectId(), userId)) continue;
            DdRequest request = requests.findById(notification.getRequestId()).orElse(null);
            if (request == null || !Objects.equals(request.getProjectId(), notification.getProjectId())) continue;
            boolean client = fileAccess.isClient(request.getProjectId(), userId);
            if (client && !published(request)) continue;
            String state = "none";
            if ("PUBLISHED".equals(notification.getKind())) {
                List<DdItem> checklist = items.findByDdRequestIdOrderBySortOrderAsc(request.getId());
                boolean needsMaterial = checklist.stream()
                        .filter(item -> item.getCurrentSubmissionId() != null || item.getUploadedFileId() != null
                                || checklist.stream().noneMatch(child -> Objects.equals(child.getParentId(), item.getId())))
                        .anyMatch(item -> Set.of("PENDING", "REJECTED").contains(item.getStatus()));
                state = "PUBLISHED".equals(request.getStatus()) && needsMaterial ? "pending" : "done";
            } else if (notification.getItemId() != null) {
                DdItem item = items.findById(notification.getItemId()).orElse(null);
                boolean current = item != null && Objects.equals(item.getDdRequestId(), request.getId())
                        && Objects.equals(item.getCurrentSubmissionId(), notification.getSubmissionId());
                boolean needsAction = current && "PUBLISHED".equals(request.getStatus())
                        && (client ? "REJECTED".equals(item.getStatus())
                            : permissions.hasWritePermission(request.getProjectId(), userId) && "UPLOADED".equals(item.getStatus()));
                state = needsAction ? "pending" : "done";
            }
            notification.setActionState(state); result.add(notification);
        }
        return result;
    }

    @Transactional
    public DdNotification markRead(Long notificationId, Long userId) {
        DdNotification notification = notifications.findById(notificationId)
                .filter(n -> Objects.equals(n.getRecipientId(), userId)).orElseThrow(() -> missing("通知不存在"));
        requireMember(notification.getProjectId(), userId);
        if (notification.getReadAt() == null) notification.setReadAt(LocalDateTime.now());
        return notifications.save(notification);
    }

    @Transactional(rollbackFor = Exception.class)
    public DdItem uploadLegacy(Long itemId, MultipartFile file, Long userId) throws IOException {
        DdRequest request = lockRequest(requestIdOf(itemId));
        if ("DRAFT".equals(request.getStatus())) {
            // Existing cloud migration builds a private draft before the lawyer confirms publication.
            requireStaff(request.getProjectId(), userId);
            DdItem item = lockItem(itemId);
            if (item.getCurrentSubmissionId() != null) throw conflict("已有版本材料不能使用旧上传方式");
            DdItem result = ddService.uploadFile(itemId, file, userId);
            result.setRevision(item.getRevision() + 1);
            return items.save(result);
        }
        submit(itemId, List.of(file), UUID.randomUUID().toString(), false, userId);
        return item(itemId);
    }

    @Transactional
    public DdComment comment(Long itemId, String content, Long userId) {
        DdRequest request = lockRequest(requestIdOf(itemId));
        requireContributor(request.getProjectId(), userId);
        requireVisible(request, userId);
        if ("ARCHIVED".equals(request.getStatus()) || "COMPLETED".equals(request.getStatus())) throw conflict("归档清单不能修改");
        return ddService.addComment(itemId, userId, required(content, 2000, "留言"));
    }

    @Transactional
    public List<DdItem> addItems(Long requestId, String content, Long userId) {
        requireEditableRequest(requestId, userId);
        return ddService.addItems(requestId, content);
    }

    @Transactional
    public DdRequest rename(Long requestId, String name, Long userId) {
        requireEditableRequest(requestId, userId);
        return ddService.updateRequest(requestId, required(name, 256, "清单名称"));
    }

    @Transactional
    public DdItem addItem(Long requestId, Long parentId, Long userId) {
        requireEditableRequest(requestId, userId);
        if (parentId != null && !requestId.equals(item(parentId).getDdRequestId())) throw badRequest("父项不属于此清单");
        return ddService.addItem(requestId, parentId);
    }

    @Transactional
    public DdItem moveItem(Long itemId, Long parentId, Long userId) {
        Long requestId = requestIdOf(itemId);
        requireEditableRequest(requestId, userId);
        if (parentId != null && !requestId.equals(item(parentId).getDdRequestId())) throw badRequest("父项不属于此清单");
        return ddService.moveItem(itemId, parentId);
    }

    @Transactional
    public DdItem updateItem(Long itemId, String title, String description, Long userId) {
        requireEditableRequest(requestIdOf(itemId), userId);
        if (title != null) title = required(title, 512, "清单项标题");
        if (description != null && description.length() > 1024) throw badRequest("材料要求过长");
        return ddService.updateItemInfo(itemId, title, description);
    }

    private void requireEditableRequest(Long requestId, Long userId) {
        DdRequest request = lockRequest(requestId);
        requireStaff(request.getProjectId(), userId);
        if (!"DRAFT".equals(request.getStatus())) throw conflict("已发布的清单要求不能直接修改，请复制为新清单");
    }

    @Transactional
    public void deleteRequest(Long requestId, Long userId) {
        DdRequest request = lockRequest(requestId);
        requireStaff(request.getProjectId(), userId);
        if (!"DRAFT".equals(request.getStatus()) || submissions.existsByRequestId(requestId)) throw conflict("已发布或已有材料的清单请归档，不能删除");
        ddService.deleteRequest(requestId, userId);
    }

    @Transactional
    public void deleteItem(Long itemId, Long userId) {
        DdRequest request = lockRequest(requestIdOf(itemId));
        requireStaff(request.getProjectId(), userId);
        if (!"DRAFT".equals(request.getStatus()) || submissions.existsByRequestId(request.getId())) throw conflict("已发布或已有材料的清单项不能删除");
        ddService.deleteItem(itemId, userId);
    }

    private Map<String, Object> view(DdSubmission submission) {
        Map<String, Object> view = mapper.convertValue(submission, new TypeReference<>() {});
        Map<Long, ProjectFile> found = new HashMap<>();
        files.findAllById(submission.getFileIds()).forEach(f -> found.put(f.getId(), f));
        List<Map<String, Object>> metadata = new ArrayList<>();
        for (Long id : submission.getFileIds()) {
            ProjectFile file = found.get(id);
            if (file == null || !Objects.equals(file.getProjectId(), submission.getProjectId())) continue;
            Map<String, Object> entry = new LinkedHashMap<>();
            entry.put("fileId", id); entry.put("name", file.getName());
            entry.put("fileType", file.getFileType()); entry.put("fileSize", file.getFileSize());
            metadata.add(entry);
        }
        view.put("files", metadata);
        return view;
    }

    private DdSubmission newSubmission(DdRequest request, DdItem item, Long userId, String key, String fingerprint) {
        preserveLegacyAttachment(request, item);
        DdSubmission submission = new DdSubmission();
        submission.setProjectId(request.getProjectId()); submission.setRequestId(request.getId());
        submission.setItemId(item.getId()); submission.setSubmittedBy(userId);
        submission.setSubmittedAt(LocalDateTime.now()); submission.setIdempotencyKey(key);
        submission.setRequestFingerprint(fingerprint);
        int previous = item.getCurrentSubmissionId() == null ? 0
                : submissions.findById(item.getCurrentSubmissionId()).orElseThrow(() -> conflict("当前材料版本不存在")).getVersion();
        submission.setVersion(previous + 1);
        return submission;
    }

    private void preserveLegacyAttachment(DdRequest request, DdItem item) {
        if (item.getCurrentSubmissionId() != null || item.getUploadedFileId() == null) return;
        ProjectFile file = files.findById(item.getUploadedFileId())
                .filter(f -> request.getProjectId().equals(f.getProjectId())).orElse(null);
        if (file == null) return;
        DdSubmission legacy = new DdSubmission();
        legacy.setProjectId(request.getProjectId()); legacy.setRequestId(request.getId()); legacy.setItemId(item.getId());
        legacy.setVersion(1); legacy.setSubmittedBy(item.getUploadedBy() == null ? file.getUserId() : item.getUploadedBy());
        legacy.setSubmittedAt(item.getUploadedAt() == null ? item.getCreatedAt() : item.getUploadedAt());
        legacy.setIdempotencyKey("legacy:" + item.getId()); legacy.setFileIds(List.of(file.getId()));
        legacy.setReviewStatus(item.getStatus()); legacy.setAiStatus("MANUAL_REQUIRED");
        submissions.saveAndFlush(legacy);
        item.setCurrentSubmissionId(legacy.getId());
    }

    private void saveSubmission(DdItem item, DdSubmission submission) {
        submissions.saveAndFlush(submission);
        item.setCurrentSubmissionId(submission.getId()); item.setRevision(item.getRevision() + 1);
        item.setUploadedFileId(submission.getFileIds().isEmpty() ? null : submission.getFileIds().get(0));
        item.setUploadedBy(submission.getSubmittedBy()); item.setUploadedAt(submission.getSubmittedAt());
        item.setStatus("UPLOADED"); items.save(item);
    }

    private DdSubmission retry(Long itemId, Long userId, String key, String fingerprint) {
        DdSubmission previous = submissions.findByItemIdAndSubmittedByAndIdempotencyKey(itemId, userId, key).orElse(null);
        if (previous != null && !Objects.equals(previous.getRequestFingerprint(), fingerprint)) throw conflict("此提交标识已用于其他材料，请重新提交");
        return previous;
    }

    private DdSubmission currentSubmission(DdItem item, Long submissionId) {
        if (submissionId == null || !Objects.equals(item.getCurrentSubmissionId(), submissionId)) throw conflict("材料已更新，请刷新后操作");
        return submissions.findById(submissionId).filter(s -> s.getItemId().equals(item.getId()))
                .orElseThrow(() -> missing("材料版本不存在"));
    }

    private void requireOpenItem(DdItem item) {
        if ("APPROVED".equals(item.getStatus())) throw conflict("该项已确认，如需更换材料请联系律师撤回确认");
    }

    private void requireSubmissionAccess(DdRequest request, Long userId) {
        requireContributor(request.getProjectId(), userId);
        if (!"PUBLISHED".equals(request.getStatus())) throw conflict("清单尚未发布或已经归档，不能提交材料");
    }

    private void requireVisible(DdRequest request, Long userId) {
        requireMember(request.getProjectId(), userId);
        if (fileAccess.isClient(request.getProjectId(), userId) && !published(request)) throw forbidden("清单尚未发布");
    }

    private boolean published(DdRequest request) {
        return "PUBLISHED".equals(request.getStatus()) || "ARCHIVED".equals(request.getStatus())
                || "COMPLETED".equals(request.getStatus());
    }

    private void requireMember(Long projectId, Long userId) {
        if (userId == null || !permissions.hasReadPermission(projectId, userId)) throw forbidden("无权访问该清单");
    }

    private void requireStaff(Long projectId, Long userId) {
        requireMember(projectId, userId);
        if (fileAccess.isClient(projectId, userId) || !permissions.hasWritePermission(projectId, userId)) throw forbidden("仅项目可写成员可以进行此操作");
    }

    private void notifyStaff(DdRequest request, DdItem item, DdSubmission submission, String kind, String key, String title) {
        Set<Long> recipients = new HashSet<>();
        projects.findById(request.getProjectId()).map(Project::getUserId).ifPresent(recipients::add);
        members.findByProjectId(request.getProjectId()).forEach(m -> recipients.add(m.getUserId()));
        for (Long recipient : recipients) {
            if (permissions.hasWritePermission(request.getProjectId(), recipient) && !fileAccess.isClient(request.getProjectId(), recipient)) {
                notify(request, item, submission, recipient, kind, key, title);
            }
        }
    }

    private void notify(DdRequest request, DdItem item, DdSubmission submission, Long recipient, String kind, String key, String title) {
        if (notifications.existsByRecipientIdAndEventKey(recipient, key)) return;
        DdNotification notification = new DdNotification();
        notification.setProjectId(request.getProjectId()); notification.setRequestId(request.getId());
        notification.setItemId(item == null ? null : item.getId()); notification.setSubmissionId(submission == null ? null : submission.getId());
        notification.setRecipientId(recipient); notification.setKind(kind); notification.setEventKey(key);
        notification.setTitle(title.length() > 512 ? title.substring(0, 512) : title); notification.setCreatedAt(LocalDateTime.now());
        notifications.save(notification);
    }

    private DdRequest request(Long id) { return requests.findById(id).orElseThrow(() -> missing("清单不存在")); }
    private DdRequest lockRequest(Long id) {
        DdRequest request = requests.findByIdForUpdate(id).orElseThrow(() -> missing("清单不存在"));
        // The web request may have loaded this entity before the transaction acquired its lock.
        entityManager.refresh(request, jakarta.persistence.LockModeType.PESSIMISTIC_WRITE);
        return request;
    }
    private Long requestIdOf(Long id) { return items.findRequestIdById(id).orElseThrow(() -> missing("清单项不存在")); }
    private DdItem item(Long id) { return items.findById(id).orElseThrow(() -> missing("清单项不存在")); }
    private DdItem lockItem(Long id) {
        DdItem item = items.findByIdForUpdate(id).orElseThrow(() -> missing("清单项不存在"));
        entityManager.refresh(item, jakarta.persistence.LockModeType.PESSIMISTIC_WRITE);
        return item;
    }

    private static String required(String value, int max, String label) {
        if (value == null || value.isBlank()) throw badRequest("请填写" + label);
        if (value.trim().length() > max) throw badRequest(label + "过长");
        return value.trim();
    }
    private static MessageDigest sha256() {
        try { return MessageDigest.getInstance("SHA-256"); }
        catch (java.security.NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }
    private static String digestText(String text) {
        return HexFormat.of().formatHex(sha256().digest(text.getBytes(StandardCharsets.UTF_8)));
    }
    private static String fingerprint(List<MultipartFile> attachments, boolean aiConsent) throws IOException {
        MessageDigest digest = sha256();
        digest.update(("FILES:" + aiConsent + ":" + attachments.size()).getBytes(StandardCharsets.UTF_8));
        for (MultipartFile file : attachments) {
            String name = Objects.toString(file.getOriginalFilename(), "");
            digest.update(("\n" + name.length() + ":" + name + ":" + file.getSize() + ":").getBytes(StandardCharsets.UTF_8));
            try (var input = file.getInputStream()) {
                byte[] buffer = new byte[8192]; int read;
                while ((read = input.read(buffer)) != -1) digest.update(buffer, 0, read);
            }
        }
        return HexFormat.of().formatHex(digest.digest());
    }
    private static ResponseStatusException forbidden(String message) { return new ResponseStatusException(HttpStatus.FORBIDDEN, message); }
    private static ResponseStatusException conflict(String message) { return new ResponseStatusException(HttpStatus.CONFLICT, message); }
    private static ResponseStatusException badRequest(String message) { return new ResponseStatusException(HttpStatus.BAD_REQUEST, message); }
    private static ResponseStatusException missing(String message) { return new ResponseStatusException(HttpStatus.NOT_FOUND, message); }
}
