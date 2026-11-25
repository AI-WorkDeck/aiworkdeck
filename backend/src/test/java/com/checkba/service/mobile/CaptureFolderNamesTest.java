// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.mobile;

import static org.junit.jupiter.api.Assertions.*;

import com.checkba.model.entity.MobileMediaInbox;
import com.checkba.service.AppLanguageScope;
import java.time.LocalDateTime;
import java.util.Set;
import org.junit.jupiter.api.Test;

/**
 * X44: capture root folders follow the UI language only when created; existing folders are never
 * renamed or duplicated, so a language switch mid-retry still lands in the same folder.
 */
class CaptureFolderNamesTest {
    private static final CaptureFolderNames.Kind MEDIA = CaptureFolderNames.Kind.MEDIA;
    private static final CaptureFolderNames.Kind AUDIO = CaptureFolderNames.Kind.AUDIO;

    @Test
    void newRootsFollowTheUiLanguage() {
        assertEquals("Field media", AppLanguageScope.call("en-US", () -> CaptureFolderNames.resolve(MEDIA, Set.of())));
        assertEquals("Field audio", AppLanguageScope.call("en-US", () -> CaptureFolderNames.resolve(AUDIO, Set.of())));
        assertEquals("现场影像", AppLanguageScope.call("zh-CN", () -> CaptureFolderNames.resolve(MEDIA, Set.of())));
        assertEquals("現場影像", AppLanguageScope.call("zh-TW", () -> CaptureFolderNames.resolve(MEDIA, Set.of())));
        assertEquals("Plugin documents", AppLanguageScope.call("en-US", () -> CaptureFolderNames.resolve(CaptureFolderNames.Kind.DOCUMENT, Set.of())));
        assertEquals("外掛文件", AppLanguageScope.call("zh-TW", () -> CaptureFolderNames.resolve(CaptureFolderNames.Kind.DOCUMENT, Set.of())));
        // an existing 插件文档 mirror keeps receiving documents after a switch to English
        assertEquals("插件文档", AppLanguageScope.call("en-US", () -> CaptureFolderNames.resolve(CaptureFolderNames.Kind.DOCUMENT, Set.of("插件文档"))));
        // languages without their own entry fall back to English
        assertEquals("Field media", AppLanguageScope.call("ja-JP", () -> CaptureFolderNames.resolve(MEDIA, Set.of())));
    }

    @Test
    void anExistingRootIsReusedWhateverTheLanguage() {
        // an old Chinese project opened by an English user: keep 现场影像, no second "Field media" folder
        assertEquals("现场影像", AppLanguageScope.call("en-US", () -> CaptureFolderNames.resolve(MEDIA, Set.of("证据", "现场影像"))));
        // a root created in English, then the user switches to Chinese: keep "Field media"
        assertEquals("Field media", AppLanguageScope.call("zh-CN", () -> CaptureFolderNames.resolve(MEDIA, Set.of("Field media"))));
        // the audio root is separate from the media root
        assertEquals("Field audio", AppLanguageScope.call("en-US", () -> CaptureFolderNames.resolve(AUDIO, Set.of("现场影像"))));
        // both exist (e.g. created on two devices): the canonical one wins, deterministically
        assertEquals("现场影像", CaptureFolderNames.resolve(MEDIA, Set.of("Field media", "现场影像")));
    }

    @Test
    void theMoveIdentityKeyStaysCanonical() {
        MobileMediaInbox item = new MobileMediaInbox();
        item.setMediaType("image");
        item.setFileName("a.jpg");
        item.setClientMediaId("12345678-aaaa-bbbb-cccc-ddddeeeeffff");
        item.setCapturedAt(LocalDateTime.of(2026, 11, 25, 9, 0));
        String en = AppLanguageScope.call("en-US", () -> MobileMediaMoveService.relativePath(item));
        assertTrue(en.startsWith("现场影像/2026-11-25/"), en);
        item.setMediaType("audio");
        assertTrue(MobileMediaMoveService.relativePath(item).startsWith("现场录音/"));
    }
}
