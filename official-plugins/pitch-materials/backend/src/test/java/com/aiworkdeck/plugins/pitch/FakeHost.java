// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.aiworkdeck.plugins.pitch;

import com.checkba.plugin.api.*;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.lang.reflect.Proxy;
import java.util.*;

/** 只实现本插件用到的宿主 SPI：设置、文件列/读/写。其余方法调用即失败。 */
final class FakeHost {
    final Map<String, String> settings = new HashMap<>();
    final Map<Long, FileInfo> files = new LinkedHashMap<>();
    final Map<Long, byte[]> bytes = new HashMap<>();
    ToolCall call = new ToolCall(7L, null, 3L, null);
    private long nextId = 100;

    long add(String path, byte[] data) {
        long id = nextId++;
        String name = path.substring(path.lastIndexOf('/') + 1);
        files.put(id, new FileInfo(id, name, null, false, "", data.length, path, null, null, null));
        bytes.put(id, data);
        return id;
    }

    byte[] read(String path) {
        for (FileInfo f : files.values()) if (f.path().equals(path)) return bytes.get(f.id());
        return null;
    }

    PluginHost host() {
        Settings s = new Settings() {
            public String get(String key) { return settings.get(key); }
            public void set(String key, String value) { settings.put(key, value); }
            public String projectStyleProfileJson(long projectId) { return null; }
        };
        Files f = proxy(Files.class, (m, a) -> switch (m) {
            case "list" -> new ArrayList<>(files.values());
            case "open" -> new ByteArrayInputStream(bytes.get((Long) a[1]));
            case "createFolderPath" -> {
                @SuppressWarnings("unchecked") List<String> seg = (List<String>) a[1];
                yield new FileInfo(1L, seg.get(0), null, true, "", 0, seg.get(0), null, null, null);
            }
            case "write" -> {
                String name = (String) a[2];
                String path = "投标材料".equals(name) ? name : folderName((Long) a[1]) + "/" + name;
                while (read(path) != null) path = path.replaceFirst("(\\.[a-z]+)$", " (1)$1");
                try { yield files.get(add(path, ((InputStream) a[3]).readAllBytes())); }
                catch (java.io.IOException e) { throw new RuntimeException(e); }
            }
            default -> throw new UnsupportedOperationException(m);
        });
        return proxy(PluginHost.class, (m, a) -> switch (m) {
            case "pluginId" -> "pitch-materials";
            case "call" -> call;
            case "settings" -> s;
            case "files" -> f;
            default -> throw new UnsupportedOperationException(m);
        });
    }

    private String lastFolder = "";
    private String folderName(Long id) { return lastFolder.isEmpty() ? "out" : lastFolder; }

    interface Body { Object run(String method, Object[] args); }

    @SuppressWarnings("unchecked")
    private <T> T proxy(Class<T> type, Body body) {
        return (T) Proxy.newProxyInstance(type.getClassLoader(), new Class<?>[]{type}, (p, m, a) -> {
            if (m.getName().equals("createFolderPath")) lastFolder = ((List<String>) a[1]).get(0);
            return body.run(m.getName(), a);
        });
    }
}
