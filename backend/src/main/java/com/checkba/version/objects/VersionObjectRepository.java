// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.version.objects;

import org.eclipse.jgit.attributes.AttributesNode;
import org.eclipse.jgit.attributes.AttributesNodeProvider;
import org.eclipse.jgit.attributes.AttributesRule;
import org.eclipse.jgit.internal.storage.file.FileRepository;
import org.eclipse.jgit.lib.BaseRepositoryBuilder;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

/** In-memory info attributes support exact paths, including spaces unsupported by JGit 6.9's parser. */
public final class VersionObjectRepository extends FileRepository {
    private List<AttributesRule> versionRules = List.of();

    public VersionObjectRepository(BaseRepositoryBuilder<?, ?> builder) throws IOException { super(builder); }

    public void setVersionRules(List<AttributesRule> rules) { versionRules = List.copyOf(rules); }

    @Override public AttributesNodeProvider createAttributesNodeProvider() {
        AttributesNodeProvider original = super.createAttributesNodeProvider();
        return new AttributesNodeProvider() {
            @Override public AttributesNode getInfoAttributesNode() throws IOException {
                AttributesNode node = original.getInfoAttributesNode();
                List<AttributesRule> rules = new ArrayList<>();
                if (node != null) rules.addAll(node.getRules());
                rules.addAll(versionRules);
                return new AttributesNode(rules);
            }

            @Override public AttributesNode getGlobalAttributesNode() throws IOException {
                return original.getGlobalAttributesNode();
            }
        };
    }
}
