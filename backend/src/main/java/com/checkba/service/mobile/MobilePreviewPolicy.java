// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.mobile;
import java.util.Locale;
import java.util.Set;

public final class MobilePreviewPolicy {
    private MobilePreviewPolicy() {}
    public static String unsupported() { return com.checkba.service.LangText.of(
            "手机端暂不支持预览此文件类型，不会传输文件", "This file type is not supported on mobile and will not be transferred"); }
    private static final Set<String> TYPES = Set.of("jpg","jpeg","png","gif","webp","heic","heif","bmp","tif","tiff",
            "docx","pptx","xlsx","pdf","m4a","mp3","wav","aac","caf","aif","aiff","mp4","mov","m4v");
    public static boolean supports(String name) {
        if (name == null) return false;
        int dot = name.lastIndexOf('.');
        return dot >= 0 && TYPES.contains(name.substring(dot + 1).toLowerCase(Locale.ROOT));
    }
    public static void requireSupported(String name) {
        if (!supports(name)) throw new IllegalArgumentException(unsupported());
    }
}
