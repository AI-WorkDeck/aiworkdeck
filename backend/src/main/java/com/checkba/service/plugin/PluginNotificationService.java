// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.plugin;

import com.checkba.plugin.api.ToolCall;
import com.checkba.repository.MessageCenterNoticeRepository;
import com.checkba.service.ProjectMemberService;
import com.checkba.service.ai.PluginService;
import com.checkba.service.messagecenter.MessageCenterGateway;
import com.checkba.service.messagecenter.MessageCenterService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.util.*;

/** Native plugin facade: source identity is bound by PluginHost, never by the plugin payload. */
@Service
@lombok.RequiredArgsConstructor
public class PluginNotificationService {
    private final PluginService plugins;
    private final MessageCenterGateway gateway;
    private final MessageCenterService messages;
    private final MessageCenterNoticeRepository notices;
    private final ProjectMemberService permissions;
    @Value("${security.local-mode:false}") boolean localMode;

    @SuppressWarnings("unchecked")
    public Map<String,Object> publish(String pluginId, ToolCall call, Map<String,Object> notification) {
        authorize(pluginId, call); return (Map<String,Object>)gateway.publishPlugin(call.userId(), pluginId, notification);
    }
    @SuppressWarnings("unchecked")
    public Map<String,Object> resolve(String pluginId, ToolCall call, String eventKey, String state) {
        authorize(pluginId, call); return (Map<String,Object>)gateway.resolvePlugin(call.userId(), pluginId, eventKey, state);
    }
    @Transactional
    public List<Map<String,Object>> publishProject(String pluginId, ToolCall call, long projectId, List<Long> recipients, Map<String,Object> p) {
        authorizeProject(pluginId, call, projectId, recipients);
        Map<String,Object> target = messages.targetMap(p.get("target"));
        if (!target.isEmpty() && (!"plugin".equals(target.get("kind")) || !pluginId.equals(target.get("pluginId"))))
            throw new IllegalArgumentException(com.checkba.service.LangText.of("插件通知只能打开本插件", "Plugin notifications can only open their own plugin"));
        if (target.containsKey("projectId") && !String.valueOf(projectId).equals(String.valueOf(target.get("projectId"))))
            throw new IllegalArgumentException(com.checkba.service.LangText.of("通知目标不属于当前项目", "Notification target does not belong to the current project"));
        Map<String,Object> scoped = new LinkedHashMap<>(target); if (!scoped.isEmpty()) scoped.put("projectId", projectId);
        return messages.publishBusiness("plugin-" + pluginId, com.checkba.service.LangText.of("插件 · ", "Plugin · ") + plugins.getPlugin(pluginId).getName(), call.userId(), recipients,
                projectId, required(p, "eventKey"), Objects.toString(p.get("kind"), "notification"), required(p, "title"),
                Objects.toString(p.get("body"), ""), Objects.toString(p.get("actionState"), "none"), scoped);
    }
    @Transactional
    public void resolveProject(String pluginId, ToolCall call, long projectId, List<Long> recipients, String eventKey, String state) {
        authorizeProject(pluginId, call, projectId, recipients);
        if (!Set.of("done", "cancelled").contains(state)) throw new IllegalArgumentException(com.checkba.service.LangText.of("处理状态无效", "Invalid action state"));
        for (Long recipient : recipients) {
            var notice = notices.findByRecipientIdAndSourceIdAndEventKey(recipient, "plugin-" + pluginId, eventKey)
                     .orElseThrow(() -> new IllegalArgumentException(com.checkba.service.LangText.of("通知不存在", "Notification not found")));
            if (!Objects.equals(notice.getProjectId(), projectId)) throw new IllegalArgumentException(com.checkba.service.LangText.of("通知不属于当前项目", "Notification does not belong to the current project"));
        }
        messages.updateBusinessState("plugin-" + pluginId, eventKey, recipients, state);
    }
    private void authorizeProject(String pluginId, ToolCall call, long projectId, List<Long> recipients) {
        authorize(pluginId, call);
        if (localMode) throw new IllegalArgumentException(com.checkba.service.LangText.of("跨成员通知须由案件库服务端插件发送，本机项目编号不能作为云端身份", "Cross-member notifications must be sent by case library server plugins; local project IDs cannot be used as cloud identity"));
        if (!Objects.equals(call.projectId(), projectId) || !permissions.hasWritePermission(projectId, call.userId()))
            throw new IllegalArgumentException(com.checkba.service.LangText.of("没有项目通知发送权限", "You do not have permission to send project notifications"));
        if (recipients == null || recipients.isEmpty() || recipients.size() > 100 || recipients.stream().anyMatch(Objects::isNull))
            throw new IllegalArgumentException(com.checkba.service.LangText.of("收件人无效", "Invalid recipients"));
        for (Long recipient : recipients) if (!permissions.hasReadPermission(projectId, recipient))
            throw new IllegalArgumentException(com.checkba.service.LangText.of("收件人无权访问项目", "Recipient does not have access to the project"));
    }
    private void authorize(String pluginId, ToolCall call) {
        if (call == null || call.userId() == null) throw new IllegalArgumentException(com.checkba.service.LangText.of("缺少调用用户", "Missing caller user"));
        MessageCenterService.pluginId(pluginId);
        var plugin = plugins.getPlugin(pluginId);
        if (plugin == null || !plugins.isEnabled(pluginId) || plugins.revokedReason(pluginId) != null
                || plugin.getPermissions() == null || !plugin.getPermissions().contains("notifications"))
            throw new IllegalArgumentException(com.checkba.service.LangText.of("插件未获得消息通知权限", "Plugin does not have notifications permission"));
    }
    private String required(Map<String,Object> p, String name) {
        if (!(p.get(name) instanceof String value) || value.isBlank()) throw new IllegalArgumentException(com.checkba.service.LangText.of("缺少 " + name, "Missing " + name));
        return value;
    }
}
