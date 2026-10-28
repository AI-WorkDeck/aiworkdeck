// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai.tools;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.checkba.model.entity.ProjectFile;
import com.checkba.repository.ProjectFileRepository;
import com.checkba.service.ProjectMemberService;
import com.checkba.service.ai.EditorBridgeService;
import com.checkba.service.ai.context.ProjectContextHolder;
import com.checkba.storage.StorageService;
import com.checkba.storage.StorageServiceFactory;

import org.junit.jupiter.api.*;
import org.springframework.core.io.ByteArrayResource;

import java.util.*;

class SlideMediaToolsTest {
    ProjectFileRepository files = mock(ProjectFileRepository.class);
    ProjectMemberService members = mock(ProjectMemberService.class);
    StorageServiceFactory storage = mock(StorageServiceFactory.class);
    StorageService store = mock(StorageService.class);
    EditorBridgeService editor = mock(EditorBridgeService.class);
    SlideMediaTools tools = new SlideMediaTools(files, members, storage, editor);

    @BeforeEach
    void setup() {
        ProjectContextHolder.setProjectId("1");
        ProjectContextHolder.setUserId(2L);
        when(members.hasWritePermission(1L, 2L)).thenReturn(true);
        when(members.hasReadPermission(1L, 2L)).thenReturn(true);
    }

    @AfterEach
    void cleanup() {
        ProjectContextHolder.clear();
    }

    void source(byte[] data) {
        var file = new ProjectFile();
        file.setId(3L);
        file.setProjectId(1L);
        file.setFilePath("image");
        when(files.findById(3L)).thenReturn(Optional.of(file));
        when(storage.getStorageService()).thenReturn(store);
        when(store.load("image")).thenReturn(new ByteArrayResource(data));
    }

    String insert() {
        return tools.slide_add_image(3L, 2, -20.0, -10.0, 400.0, 300.0, "cover", true, 0.2, 0.7);
    }

    @Test
    void unauthorizedTargetDoesNotReadMetadataOrBytes() {
        when(members.hasWritePermission(1L, 2L)).thenReturn(false);
        assertTrue(insert().startsWith("Error:"));
        verifyNoInteractions(files, storage, store, editor);
    }

    @Test
    void unauthorizedSourceDoesNotReadBytes() {
        source(new byte[] {1});
        when(members.hasReadPermission(1L, 2L)).thenReturn(false);
        assertTrue(insert().startsWith("Error:"));
        verifyNoInteractions(store, editor);
    }

    @Test
    void invalidParametersHaveNoFileOrEditorSideEffects() {
        for (Integer slide : Arrays.asList(null, 0, -1))
            assertTrue(
                    tools.slide_add_image(3L, slide, 0., 0., 1., 1., null, null, null, null)
                            .startsWith("Error:"));
        for (Double width : Arrays.asList(null, 0., -1., Double.NaN, Double.POSITIVE_INFINITY))
            assertTrue(
                    tools.slide_add_image(3L, 1, 0., 0., width, 1., null, null, null, null)
                            .startsWith("Error:"));
        assertTrue(
                tools.slide_add_image(3L, 1, Double.NaN, 0., 1., 1., null, null, null, null)
                        .startsWith("Error:"));
        assertTrue(
                tools.slide_add_image(3L, 1, 0., 0., 1., 1., "bad", null, null, null)
                        .startsWith("Error:"));
        assertTrue(
                tools.slide_add_image(3L, 1, 0., 0., 1., 1., null, null, 1.1, null)
                        .startsWith("Error:"));
        verifyNoInteractions(files, storage, store, editor);
    }

    @Test
    void legalBleedAndExactSlideReachDecoderUnchanged() {
        // No extension allowlist: actual decoding belongs to the editor's graphic provider.
        source("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"2\" height=\"2\"/>".getBytes());
        when(editor.executeEditorCommand(eq("slide_add_image"), any()))
                .thenReturn("{\"success\":true}");
        assertTrue(insert().contains("true"));
        verify(editor)
                .executeEditorCommand(
                        eq("slide_add_image"),
                        argThat(
                                p ->
                                        p.get("slideNumber").equals(2)
                                                && p.get("left").equals(-20.)
                                                && p.get("top").equals(-10.)
                                                && p.get("width").equals(400.)
                                                && p.get("focalX").equals(0.2)
                                                && p.get("sendToBack").equals(true)));
    }

    @Test
    void decoderRejectionIsLocalizedAndPartialFlagsAreRetained() {
        source("not an image".getBytes());
        when(editor.executeEditorCommand(any(), any()))
                .thenReturn("{\"error\":\"SLIDE_INVALID_IMAGE\"}")
                .thenReturn(
                        "{\"errorCode\":\"SLIDE_IMAGE_PARTIAL\",\"created\":true,\"retryable\":false,\"shapeName\":\"Image"
                            + " 1\"}");
        var invalid = cn.hutool.json.JSONUtil.parseObj(insert());
        assertEquals("SLIDE_INVALID_IMAGE", invalid.getStr("errorCode"));
        assertNotEquals("SLIDE_INVALID_IMAGE", invalid.getStr("message"));
        var partial = cn.hutool.json.JSONUtil.parseObj(insert());
        assertTrue(partial.getBool("created"));
        assertFalse(partial.getBool("retryable"));
        assertEquals("Image 1", partial.getStr("shapeName"));
    }

    @Test
    void oversizedFilesNeverReachEditor() {
        source(new byte[12 * 1024 * 1024 + 1]);
        assertTrue(insert().startsWith("Error:"));
        verifyNoInteractions(editor);
    }
}
