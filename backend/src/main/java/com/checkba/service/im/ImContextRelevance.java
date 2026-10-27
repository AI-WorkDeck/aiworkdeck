// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.im;

import java.util.*;

/** Bounded name matching, without reading unrelated files or invoking a model. */
final class ImContextRelevance {
    private ImContextRelevance() {}
    static int score(String name, String question) {
        String value = Objects.toString(name, "").toLowerCase(Locale.ROOT).replaceFirst("\\.[a-z0-9]{1,8}$", "");
        String query = Objects.toString(question, "").toLowerCase(Locale.ROOT);
        if (value.isBlank() || query.isBlank()) return 0;
        int score = query.contains(value) ? 100 : 0;
        Set<String> terms = new HashSet<>();
        for (String part : value.split("[^\\p{L}\\p{N}]+")) {
            if (part.length() > 1) terms.add(part);
            if (part.matches(".*\\p{IsHan}.*")) for (int i = 0; i + 1 < part.length(); i++) terms.add(part.substring(i, i + 2));
        }
        for (String term : terms) if (query.contains(term)) score += term.length();
        return score;
    }
}
