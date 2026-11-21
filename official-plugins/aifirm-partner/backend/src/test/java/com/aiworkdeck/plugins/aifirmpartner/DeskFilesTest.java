// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.aiworkdeck.plugins.aifirmpartner;

import com.checkba.plugin.api.FileInfo;
import com.checkba.plugin.api.Files;
import com.checkba.plugin.api.PluginHost;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.lang.reflect.Proxy;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class DeskFilesTest {
    private final List<FileInfo> files = new ArrayList<>();
    private final Map<Long, byte[]> bytes = new HashMap<>();
    private int writes;

    private DeskFiles tools() {
        Files f = (Files) Proxy.newProxyInstance(Files.class.getClassLoader(), new Class<?>[]{Files.class}, (p, m, a) -> switch (m.getName()) {
            case "list" -> List.copyOf(files);
            case "open" -> new ByteArrayInputStream(bytes.get((Long) a[1]));
            case "write" -> {
                writes++;
                byte[] b = ((InputStream) a[3]).readAllBytes();
                long id = files.size() + 1;
                FileInfo info = new FileInfo(id, (String) a[2], null, false, "docx", b.length, (String) a[2], null, null, 1L);
                files.add(info); bytes.put(id, b);
                yield info;
            }
            default -> throw new UnsupportedOperationException(m.getName());
        });
        PluginHost host = (PluginHost) Proxy.newProxyInstance(PluginHost.class.getClassLoader(), new Class<?>[]{PluginHost.class},
                (p, m, a) -> m.getName().equals("files") ? f : null);
        DeskFiles d = new DeskFiles();
        d.setHost(host);
        return d;
    }

    private static String docx(String text) {
        return Base64.getEncoder().encodeToString(("PK" + text).getBytes());
    }

    @Test
    void putsAWordFileOnceAndNeverOverwritesIt() {
        DeskFiles d = tools();
        String first = d.aifirmPartnerPutDocx(7L, "Mutual NDA · 第1版.docx", docx("one"));
        assertTrue(first.contains("\"existed\":false"), first);
        String again = d.aifirmPartnerPutDocx(7L, "Mutual NDA · 第1版.docx", docx("two"));
        assertTrue(again.contains("\"existed\":true"), again);
        assertEquals(1, writes);
    }

    @Test
    void refusesWhatIsNotAWordFile() {
        DeskFiles d = tools();
        assertTrue(d.aifirmPartnerPutDocx(7L, "a.txt", docx("x")).startsWith("Error"));
        assertTrue(d.aifirmPartnerPutDocx(7L, "a.docx", Base64.getEncoder().encodeToString("nope".getBytes())).startsWith("Error"));
        assertTrue(d.aifirmPartnerPutDocx(null, "a.docx", docx("x")).startsWith("Error"));
        assertTrue(d.aifirmPartnerPutDocx(7L, "../../etc/a.docx", docx("xyz")).contains(" etc a.docx"));
        assertEquals(1, writes);
    }

    @Test
    void readsTheEditedFileBack() {
        DeskFiles d = tools();
        d.aifirmPartnerPutDocx(7L, "SAFE · 第2版.docx", docx("edited"));
        String out = d.aifirmPartnerReadDocx(7L, "SAFE · 第2版.docx");
        assertTrue(out.contains("\"base64\":\"" + docx("edited") + "\""), out);
        assertTrue(d.aifirmPartnerReadDocx(7L, "missing.docx").contains("not_found"));
        assertTrue(d.aifirmPartnerReadDocx(7L, "a.pdf").startsWith("Error"));
    }

    @Test
    void escapesJson() {
        assertEquals("\"a\\\"b\\\\c\\n\"", DeskFiles.json("a\"b\\c\n"));
    }
}
