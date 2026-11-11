// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai.tools;

import cn.hutool.json.JSONArray;
import cn.hutool.json.JSONObject;
import cn.hutool.json.JSONUtil;
import com.checkba.service.LangText;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;

/**
 * move_files 的容错入参。弱模型第一次调用常常自造形状（eval t06：DeepSeek 用
 * {@code sources=[..], destinations=[..]} 连撞 4 次被卡死循环检测打断）。
 * 只收「读了就知道意思」的形状：并行数组、{from,to} 清单、单个目标文件夹；有歧义就拒绝并给出正确写法。
 */
public final class MoveFilesArgs {

    private MoveFilesArgs() {}

    /** 正确写法，错误信息里原样展示。 */
    static final String EXAMPLE = "[{\"sourcePath\":\"起诉状.docx\",\"destPath\":\"01 诉讼文书/起诉状.docx\"},"
            + "{\"sourcePath\":\"证据1.docx\",\"destPath\":\"02 证据/证据1.docx\"}]";

    private static final List<String> LIST_KEYS = List.of("moves", "files", "items", "operations", "paths");
    private static final List<String> SRC_LIST_KEYS = List.of("sources", "source", "sourcePaths", "srcs", "from");
    private static final List<String> DEST_LIST_KEYS = List.of("destinations", "destination", "destPaths", "dests",
            "dest", "to", "targetFolder", "target_folder", "targetDir", "destFolder", "folder");
    private static final List<String> ITEM_SRC_KEYS = List.of("sourcePath", "source", "src", "from", "path", "file", "name");
    private static final List<String> ITEM_DEST_KEYS = List.of("destPath", "destination", "dest", "to", "target", "targetPath", "newPath");

    /** 一条移动。 */
    public record Move(String sourcePath, String destPath) {}

    /** 供 XML 解析器识别：这些具名参数名对 move_files 不算「未知」。 */
    public static Set<String> extraNames() {
        Set<String> s = new java.util.LinkedHashSet<>(LIST_KEYS);
        s.addAll(SRC_LIST_KEYS);
        s.addAll(DEST_LIST_KEYS);
        return s;
    }

    /** 参数名是 {@code movesJson} 之外的常见发明时，折成规范的 movesJson；已有 movesJson 则不动。 */
    public static void fold(JSONObject args) {
        Object existing = args.get("movesJson");
        if (existing != null && !String.valueOf(existing).isBlank()) {
            return;
        }
        for (String k : LIST_KEYS) {
            if (args.get(k) != null) {
                args.set("movesJson", String.valueOf(args.remove(k)));
                return;
            }
        }
        String srcKey = firstPresent(args, SRC_LIST_KEYS);
        String destKey = firstPresent(args, DEST_LIST_KEYS);
        if (srcKey == null || destKey == null) {
            return;
        }
        List<String> sources = toStrings(args.get(srcKey));
        List<String> dests = toStrings(args.get(destKey));
        if (sources.isEmpty() || dests.isEmpty()) {
            return;
        }
        JSONArray out = new JSONArray();
        if (dests.size() == sources.size()) {
            for (int i = 0; i < sources.size(); i++) {
                out.add(new JSONObject().set("sourcePath", sources.get(i)).set("destPath", dests.get(i)));
            }
        } else if (dests.size() == 1) {
            // 一个目标文件夹：每份文件保留原名放进去
            String folder = dests.get(0).replaceAll("/+$", "");
            for (String s : sources) {
                String base = s.substring(s.lastIndexOf('/') + 1);
                out.add(new JSONObject().set("sourcePath", s).set("destPath", folder + "/" + base));
            }
        } else {
            return; // 数量对不上，留给 move_files 报错
        }
        args.remove(srcKey);
        args.remove(destKey);
        args.set("movesJson", out.toString());
    }

    /**
     * 解析 movesJson。容忍：外层对象包一层数组、{from,to}/{source,destination} 等同义键。
     *
     * @throws IllegalArgumentException 形状不对；message 即可直接回喂模型
     */
    public static List<Move> parse(String movesJson) {
        Object root;
        try {
            root = JSONUtil.parse(movesJson);
        } catch (Exception e) {
            throw new IllegalArgumentException(shapeError(LangText.of("不是合法的 JSON", "is not valid JSON")));
        }
        if (root instanceof JSONObject o) {
            JSONArray inner = null;
            for (String k : LIST_KEYS) {
                if (o.get(k) instanceof JSONArray a) { inner = a; break; }
            }
            root = inner != null ? inner : new JSONArray().put(o);
        }
        if (!(root instanceof JSONArray arr)) {
            throw new IllegalArgumentException(shapeError(LangText.of("不是 JSON 数组", "is not a JSON array")));
        }
        List<Move> moves = new ArrayList<>();
        for (int i = 0; i < arr.size(); i++) {
            if (!(arr.get(i) instanceof JSONObject item)) {
                throw new IllegalArgumentException(shapeError(LangText.of(
                        "第 " + (i + 1) + " 条不是对象", "item " + (i + 1) + " is not an object")));
            }
            moves.add(new Move(text(item, ITEM_SRC_KEYS), text(item, ITEM_DEST_KEYS)));
        }
        return moves;
    }

    private static String shapeError(String reason) {
        return LangText.of(
                "Error: movesJson " + reason + "，未移动任何文件。正确写法（一次可含多个目标文件夹）：movesJson=" + EXAMPLE,
                "Error: movesJson " + reason + "; nothing was moved. Correct shape (several target folders in one call): movesJson=" + EXAMPLE);
    }

    private static String text(JSONObject item, List<String> keys) {
        for (String k : keys) {
            Object v = item.get(k);
            if (v != null) return String.valueOf(v);
        }
        return "";
    }

    private static String firstPresent(JSONObject args, List<String> keys) {
        for (String k : keys) {
            if (args.get(k) != null) return k;
        }
        return null;
    }

    /** JSON 数组、JSON 数组字符串、逗号/换行分隔的字符串、单个值，都转成字符串列表。 */
    private static List<String> toStrings(Object v) {
        List<String> out = new ArrayList<>();
        if (v == null) return out;
        Object val = v;
        if (val instanceof String s) {
            String t = s.strip();
            if (t.startsWith("[")) {
                try { val = JSONUtil.parseArray(t); } catch (Exception ignored) { /* 当普通字符串 */ }
            }
        }
        if (val instanceof JSONArray a) {
            for (Object o : a) if (o != null && !String.valueOf(o).isBlank()) out.add(String.valueOf(o).strip());
        } else {
            for (String p : String.valueOf(val).split("[,\\n]")) if (!p.isBlank()) out.add(p.strip());
        }
        return out;
    }
}
