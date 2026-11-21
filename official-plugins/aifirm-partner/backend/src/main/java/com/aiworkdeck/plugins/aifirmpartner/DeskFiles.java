// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.aiworkdeck.plugins.aifirmpartner;

import com.checkba.plugin.api.ConflictPolicy;
import com.checkba.plugin.api.FileInfo;
import com.checkba.plugin.api.HostAware;
import com.checkba.plugin.api.PluginHost;
import dev.langchain4j.agent.tool.P;
import dev.langchain4j.agent.tool.Tool;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.util.Base64;
import java.util.List;

/**
 * The lawyer desk's Word round trip in AI WorkDeck's own editor. The panel (tools.invoke, agent:false in the manifest)
 * puts the latest version of a matter as a .docx into the current project, opens it with ui.openFile, and later reads
 * the edited bytes back to save them as the matter's next version. Everything goes through the host SPI,
 * which checks the user's project membership; projectId is injected by the host from the call context.
 */
public class DeskFiles implements HostAware {

    static final int MAX_BYTES = 20 * 1024 * 1024;
    private PluginHost host;

    @Override
    public void setHost(PluginHost host) {
        this.host = host;
    }

    @Tool("把案件文件的 Word 版本放进当前项目根目录并返回其路径；同名文件已存在时不覆盖，直接返回它。仅供律师端面板调用")
    public String aifirmPartnerPutDocx(@P("项目 ID，由宿主注入") Long projectId,
                                    @P("文件名，以 .docx 结尾") String name,
                                    @P("文件内容，base64") String base64) {
        if (host == null) return "Error: host not injected";
        if (projectId == null) return "Error: no project";
        String clean = name == null ? "" : name.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]+", " ").replaceAll("\\s+", " ").trim();
        if (clean.length() > 120) clean = clean.substring(0, 115).trim() + ".docx";
        if (!clean.toLowerCase().endsWith(".docx") || clean.length() < 6) return "Error: name must end with .docx";
        byte[] bytes;
        try {
            bytes = Base64.getDecoder().decode(base64 == null ? "" : base64.trim());
        } catch (IllegalArgumentException e) {
            return "Error: invalid base64";
        }
        if (bytes.length < 4 || bytes[0] != 'P' || bytes[1] != 'K') return "Error: not a docx";
        if (bytes.length > MAX_BYTES) return "Error: file too large";
        for (FileInfo f : host.files().list(projectId, null, false)) {
            // The lawyer may already be editing this version's file: never overwrite it.
            if (!f.folder() && clean.equals(f.name())) return result(f, true);
        }
        FileInfo f = host.files().write(projectId, null, clean, new ByteArrayInputStream(bytes), ConflictPolicy.FAIL);
        return result(f, false);
    }

    @Tool("读取当前项目中的一个 Word 文件，返回其 base64 字节，供律师端面板保存为新版本。仅供律师端面板调用")
    public String aifirmPartnerReadDocx(@P("项目 ID，由宿主注入") Long projectId,
                                     @P("项目内相对路径，如 a/b.docx") String path) {
        if (host == null) return "Error: host not injected";
        if (projectId == null) return "Error: no project";
        if (path == null || !path.toLowerCase().endsWith(".docx")) return "Error: not a .docx path";
        FileInfo hit = null;
        List<FileInfo> all = host.files().list(projectId, null, true);
        for (FileInfo f : all) if (!f.folder() && path.equals(f.path())) { hit = f; break; }
        if (hit == null) return "Error: not_found";
        if (hit.size() > MAX_BYTES) return "Error: file too large";
        byte[] bytes;
        try (InputStream in = host.files().open(projectId, hit.id())) {
            bytes = in.readNBytes(MAX_BYTES + 1);
        } catch (Exception e) {
            return "Error: " + e.getMessage();
        }
        if (bytes.length > MAX_BYTES) return "Error: file too large";
        return "{\"path\":" + json(hit.path()) + ",\"name\":" + json(hit.name()) + ",\"size\":" + bytes.length
                + ",\"updatedAt\":" + hit.updatedAt() + ",\"base64\":\"" + Base64.getEncoder().encodeToString(bytes) + "\"}";
    }

    private static String result(FileInfo f, boolean existed) {
        return "{\"path\":" + json(f.path() == null ? f.name() : f.path()) + ",\"name\":" + json(f.name()) + ",\"fileId\":" + f.id()
                + ",\"existed\":" + existed + "}";
    }

    static String json(String s) {
        if (s == null) return "null";
        StringBuilder b = new StringBuilder("\"");
        for (char c : s.toCharArray()) {
            switch (c) {
                case '"' -> b.append("\\\"");
                case '\\' -> b.append("\\\\");
                case '\n' -> b.append("\\n");
                case '\r' -> b.append("\\r");
                case '\t' -> b.append("\\t");
                default -> { if (c < 0x20) b.append(String.format("\\u%04x", (int) c)); else b.append(c); }
            }
        }
        return b.append('"').toString();
    }
}
