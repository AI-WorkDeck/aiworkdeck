// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai.tools;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 更名/合并后的旧工具名兼容壳（tool-system-v2 E1）。
 *
 * <p>与 {@code ToolRegistry.TOOL_NAME_ALIASES} 的区别：别名静默改道，壳是「同一件事 + 告诉模型」——
 * 方法体只做参数映射后调用新工具，并经 {@link ToolShims#hint} 在回执末尾追加「已并入 X」。
 * 必须同时标 {@code @ToolMeta(offerToModel=false)}：注册但不下发，旧对话回放与 XML 兜底仍可执行。
 *
 * <p>到期删除：{@code until} 版本（读自 desktop/package.json）一到，
 * {@code ToolShimExpiryTest} 变红，提醒删掉壳、对应 CSV 行与 toolDisplayNames 之外的所有引用。
 */
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.METHOD)
public @interface ToolShim {

    /** 取代本工具的新工具名。 */
    String replacedBy();

    /** 壳引入的版本。 */
    String since() default "0.82";

    /** 壳必须删除的版本（到该版本测试变红）。 */
    String until() default "0.83";
}
