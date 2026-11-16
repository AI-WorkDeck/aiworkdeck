// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai;

import dev.langchain4j.agent.tool.P;
import dev.langchain4j.agent.tool.Tool;
import dev.langchain4j.agent.tool.ToolSpecification;
import com.checkba.service.ai.tools.AgentToolComponent;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Random;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * 下发给模型的 tools 顺序必须与 JVM / bean 扫描顺序 / 反射方法顺序无关：
 * 供应商 prompt 缓存要求 tools 前缀逐字节一致（matrix 日志里同一 master 构建两次启动 toolsOrderHash 不同）。
 */
class ToolRegistryDeterministicOrderTest {

    static class BeanA implements AgentToolComponent {
        @Tool("a1") public String todo_write(@P("t") String t) { return t; }
        @Tool("a2") public String zz_probe_last(@P("t") String t) { return t; }
        @Tool("a3") public String ask_user(@P("t") String t) { return t; }
        @Tool("a4") public String aa_probe_first(@P("t") String t) { return t; }
    }

    static class BeanB implements AgentToolComponent {
        @Tool("b1") public String list_tools(@P("t") String t) { return t; }
        @Tool("b2") public String mm_probe_mid(@P("t") String t) { return t; }
        @Tool("b3") public String use_skill(@P("t") String t) { return t; }
    }

    private static ToolRegistry registry(List<AgentToolComponent> beans) {
        ToolRegistry registry = new ToolRegistry(beans, new PluginService(), new ClientCapabilityService());
        ReflectionTestUtils.setField(registry, "disclosurePolicy", new ToolDisclosurePolicy(true));
        registry.init();
        return registry;
    }

    private static String serialized(ToolRegistry registry) {
        return registry.getAllSpecifications().stream().map(ToolSpecification::toString)
                .collect(java.util.stream.Collectors.joining("\n"));
    }

    @Test
    @DisplayName("bean 顺序打乱后，两份注册表的 tools 序列化逐字节一致")
    void sameBytesRegardlessOfBeanOrder() {
        String forward = serialized(registry(List.of(new BeanA(), new BeanB())));
        String reversed = serialized(registry(List.of(new BeanB(), new BeanA())));
        assertEquals(forward, reversed);
    }

    @Test
    @DisplayName("规范序：核心集按 CORE 声明序在前，其余按类目序再按名字")
    void coreFirstInDeclaredOrderThenByName() {
        List<String> names = registry(List.of(new BeanB(), new BeanA())).getAllSpecifications().stream()
                .map(ToolSpecification::name).toList();
        List<String> core = new ArrayList<>(ToolDisclosurePolicy.CORE);
        List<String> expectedCore = names.stream().filter(core::contains)
                .sorted(java.util.Comparator.comparingInt(core::indexOf)).toList();
        assertEquals(expectedCore, names.subList(0, expectedCore.size()), names.toString());
        assertEquals(List.of("aa_probe_first", "mm_probe_mid", "zz_probe_last"),
                names.subList(expectedCore.size(), names.size()), names.toString());
    }

    @Test
    @DisplayName("canonicalOrder：任意输入排列得到同一序列")
    void canonicalOrderIgnoresInputPermutation() {
        ToolDisclosurePolicy policy = new ToolDisclosurePolicy(true);
        List<ToolSpecification> specs = new ArrayList<>(registry(List.of(new BeanA(), new BeanB())).getAllSpecifications());
        for (String name : ToolDisclosurePolicy.CORE) {
            specs.add(ToolSpecification.builder().name(name).description("x").build());
        }
        specs = specs.stream().collect(java.util.stream.Collectors.toMap(ToolSpecification::name, s -> s, (a, b) -> a))
                .values().stream().toList();
        List<ToolSpecification> baseline = policy.canonicalOrder(specs);
        for (int seed = 0; seed < 20; seed++) {
            List<ToolSpecification> shuffled = new ArrayList<>(specs);
            Collections.shuffle(shuffled, new Random(seed));
            assertEquals(baseline, policy.canonicalOrder(shuffled));
        }
    }
}
