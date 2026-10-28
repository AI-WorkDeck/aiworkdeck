// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai.tools;

import com.checkba.repository.ProjectFileRepository;
import com.checkba.service.LangText;
import com.checkba.service.ProjectMemberService;
import com.checkba.service.ai.EditorBridgeService;
import com.checkba.service.ai.context.ProjectContextHolder;
import com.checkba.storage.StorageServiceFactory;

import dev.langchain4j.agent.tool.P;
import dev.langchain4j.agent.tool.Tool;

import lombok.RequiredArgsConstructor;

import org.springframework.stereotype.Component;

import java.util.*;

@Component
@RequiredArgsConstructor
public class SlideMediaTools implements AgentToolComponent {
    private final ProjectFileRepository files;
    private final ProjectMemberService members;
    private final StorageServiceFactory storage;
    private final EditorBridgeService editor;

    @ToolMeta(displayName = "插入幻灯片图片", category = "document", fileEffect = "MODIFIED")
    @Tool(
            "Insert an existing project image into an exact slide rectangle (points). Negative"
                + " left/top and edges extending outside the canvas intentionally create bleed."
                + " fit=cover crops to fill the rectangle; focalX/focalY choose the crop position"
                + " (0=start edge, 0.5=center, 1=end edge); contain preserves the whole image;"
                + " stretch distorts the aspect ratio. sendToBack=true places it behind existing"
                + " content; use the slide dimensions for a full-slide background. PNG transparency"
                + " is preserved; at most 12 MB. Keep text/data editable, not baked into the image."
                + " Inspect the visible crop and contrast after insertion. Partial failure must be"
                + " read back before retrying.")
    public String slide_add_image(
            @P("Project image file ID") Long fileId,
            @P("Slide number, 1-based") Integer slideNumber,
            @P("Left in points; negative values allow bleed") Double left,
            @P("Top in points; negative values allow bleed") Double top,
            @P("Width in points") Double width,
            @P("Height in points") Double height,
            @P(value = "cover/contain/stretch, default cover", required = false) String fit,
            @P(value = "Place behind existing content, default false", required = false)
                    Boolean sendToBack,
            @P(value = "Horizontal crop position from 0 to 1, default 0.5", required = false)
                    Double focalX,
            @P(value = "Vertical crop position from 0 to 1, default 0.5", required = false)
                    Double focalY) {
        if (slideNumber == null || slideNumber < 1)
            return "Error: "
                    + LangText.of("请指定从1开始的准确页码", "Specify an exact slide number starting at 1");
        if (!finite(left)
                || !finite(top)
                || !finite(width)
                || !finite(height)
                || width <= 0
                || height <= 0
                || (fit != null && !Set.of("cover", "contain", "stretch").contains(fit))
                || !focalValid(focalX)
                || !focalValid(focalY))
            return "Error: "
                    + LangText.of(
                            "位置须为有限数值，宽高须为正数；请检查裁剪模式及0到1的焦点位置",
                            "Position must be finite and dimensions positive; check fit mode and"
                                + " focal positions from 0 to 1");
        Long projectId = ProjectContextHolder.getProjectIdAsLong();
        Long userId = ProjectContextHolder.getUserId();
        if (projectId == null || userId == null || !members.hasWritePermission(projectId, userId))
            return "Error: "
                    + LangText.of(
                            "无权修改当前项目的幻灯片", "No permission to edit slides in the current project");
        try {
            var file = fileId == null ? null : files.findById(fileId).orElse(null);
            if (file == null
                    || Boolean.TRUE.equals(file.getIsDeleted())
                    || Boolean.TRUE.equals(file.getIsFolder()))
                return "Error: " + LangText.of("图片文件不存在", "Image file not found");
            String denied = ToolFileGuard.rejectIfCannotRead(file, members);
            if (denied != null)
                return "Error: " + LangText.of("无权读取图片", "No permission to read this image");
            if (userId == null || !members.hasReadPermission(file.getProjectId(), userId))
                return "Error: " + LangText.of("无权读取图片", "No permission to read this image");
            byte[] bytes;
            try (var in = storage.getStorageService().load(file.getFilePath()).getInputStream()) {
                bytes = in.readNBytes(12 * 1024 * 1024 + 1);
            }
            if (bytes.length == 0 || bytes.length > 12 * 1024 * 1024)
                return "Error: "
                        + LangText.of("图片须为非空且不超过12MB", "Image must be nonempty and at most 12 MB");
            Map<String, Object> params = new HashMap<>();
            params.put("base64", Base64.getEncoder().encodeToString(bytes));
            params.put("slideNumber", slideNumber);
            params.put("left", left);
            params.put("top", top);
            params.put("width", width);
            params.put("height", height);
            if (fit != null) params.put("fit", fit);
            if (sendToBack != null) params.put("sendToBack", sendToBack);
            if (focalX != null) params.put("focalX", focalX);
            if (focalY != null) params.put("focalY", focalY);
            return localizeResult(editor.executeEditorCommand("slide_add_image", params));
        } catch (Exception e) {
            return "Error: "
                    + LangText.of(
                            "图片插入未完成，请读取目标页确认后继续",
                            "Image insertion did not complete; inspect the target slide before"
                                + " continuing");
        }
    }

    private static boolean finite(Double value) {
        return value != null && Double.isFinite(value);
    }

    private static boolean focalValid(Double value) {
        return value == null || (finite(value) && value >= 0 && value <= 1);
    }

    private String localizeResult(String response) {
        if (response == null || !response.stripLeading().startsWith("{")) return response;
        try {
            var result = cn.hutool.json.JSONUtil.parseObj(response);
            String code = result.getStr("errorCode", result.getStr("error"));
            if (code == null) return response;
            String message =
                    switch (code) {
                        case "SLIDE_INVALID_NUMBER" ->
                                LangText.of(
                                        "页码须为范围内的整数，从1开始",
                                        "Slide number must be an in-range integer, starting at 1");
                        case "SLIDE_INVALID_GEOMETRY" ->
                                LangText.of(
                                        "图片位置或尺寸无效，请检查位置、正数宽高及裁剪参数",
                                        "Invalid image position or dimensions; check coordinates,"
                                            + " positive dimensions and crop parameters");
                        case "SLIDE_INVALID_IMAGE" ->
                                LangText.of(
                                        "文件无法解码为有效图片，请选择可读取的图片文件",
                                        "The file cannot be decoded as a valid image; choose a"
                                            + " readable image file");
                        case "SLIDE_IMAGE_PARTIAL" ->
                                LangText.of(
                                        "图片已插入，但后续设置未完成；请按返回的页码和形状名回读修复，勿重复插入",
                                        "Image inserted, but setup is incomplete; inspect and"
                                            + " repair the returned slide and shape, do not insert"
                                            + " again");
                        default -> null;
                    };
            if (message == null) return response;
            result.set("errorCode", code);
            result.set("error", message);
            result.set("message", message);
            return result.toString();
        } catch (RuntimeException ignored) {
            return response;
        }
    }
}
