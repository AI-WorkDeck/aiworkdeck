// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.mobile;

import com.checkba.service.LangText;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.function.Function;

/**
 * X44: root folders for phone captures follow the UI language when they are first created
 * (the phone already tells English users "Field media / {date}"). Rules that keep existing data safe:
 * <ul>
 *   <li>A project that already has the root under ANY known name keeps using it: never renamed, never a
 *       second sibling folder, and retries after a language switch land in the same folder (idempotency).</li>
 *   <li>Only a brand-new root takes the current-language name.</li>
 *   <li>{@link MobileMediaMoveService#relativePath} keeps the canonical zh names: it is an internal identity
 *       key for legacy items (new items are located by capture id), never a display string.</li>
 * </ul>
 * Locales without an entry fall back to English (LangText fallback chain).
 */
public final class CaptureFolderNames {
    private CaptureFolderNames() {}

    public enum Kind {
        MEDIA(Map.of("zh-CN", "现场影像", "zh-TW", "現場影像", "en-US", "Field media")),
        AUDIO(Map.of("zh-CN", "现场录音", "zh-TW", "現場錄音", "en-US", "Field recordings"));

        final Map<String, String> names;
        Kind(Map<String, String> names) { this.names = names; }

        /** Canonical (historical) name: the identity key used by relative paths. */
        public String canonical() { return names.get("zh-CN"); }

        /** Every name this root may already have on disk, canonical first. */
        public Set<String> aliases() {
            Set<String> all = new LinkedHashSet<>();
            all.add(canonical());
            all.addAll(names.values());
            return all;
        }

        /** Name for a root created now, in the current UI language. */
        public String localized() { return LangText.of(names); }
    }

    public static Kind forMediaType(String mediaType) {
        return "audio".equals(mediaType) ? Kind.AUDIO : Kind.MEDIA;
    }

    /**
     * The root folder name to use in a project: an existing root under any alias (canonical preferred),
     * otherwise the current-language name.
     *
     * @param existingRootNames names of the project's live, top-level folders
     */
    public static String resolve(Kind kind, Set<String> existingRootNames) {
        for (String alias : kind.aliases()) {
            if (existingRootNames.contains(alias)) return alias;
        }
        return kind.localized();
    }

    /** Convenience for callers that look folders up lazily. */
    public static String resolve(Kind kind, Function<String, Optional<?>> rootFolderByName) {
        for (String alias : kind.aliases()) {
            if (rootFolderByName.apply(alias).isPresent()) return alias;
        }
        return kind.localized();
    }
}
