// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.aiworkdeck.plugins.pitch;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** 模板占位符字段表（README「模板占位符」一节的单一出处）：中英文名都解析到规范中文名。 */
final class Fields {
    record Key(String list, String field) {}

    static final List<String> SCALARS = List.of("律所名称", "律所简介", "客户名称", "项目名称", "日期", "团队负责人",
            "服务方案", "报价方式", "报价合计", "报价大写", "报价说明");
    private static final String[][] SCALAR_EN = {
            {"firm.name", "律所名称"}, {"firm.intro", "律所简介"}, {"client.name", "客户名称"}, {"project.name", "项目名称"},
            {"date", "日期"}, {"team.lead", "团队负责人"}, {"service.text", "服务方案"}, {"quote.mode", "报价方式"},
            {"quote.total", "报价合计"}, {"quote.totalUpper", "报价大写"}, {"quote.note", "报价说明"}};
    static final Map<String, List<String>> LISTS = Map.of(
            "业绩", List.of("序号", "名称", "客户", "领域", "年份", "金额", "角色", "简介", "律师"),
            "律师", List.of("序号", "姓名", "职务", "领域", "执业年份", "教育", "简介"),
            "资质", List.of("序号", "名称", "类型", "颁发机构", "年份"),
            "报价", List.of("序号", "项目", "计算", "金额"),
            "对照", List.of("序号", "类型", "要求", "分值", "结论", "依据", "缺口"));
    private static final String[][] LIST_EN = {
            {"credentials", "业绩", "no:序号,title:名称,client:客户,area:领域,year:年份,amount:金额,role:角色,summary:简介,lawyers:律师"},
            {"lawyers", "律师", "no:序号,name:姓名,title:职务,area:领域,since:执业年份,education:教育,bio:简介"},
            {"quals", "资质", "no:序号,name:名称,kind:类型,issuer:颁发机构,year:年份"},
            {"quote", "报价", "no:序号,item:项目,basis:计算,amount:金额"},
            {"matrix", "对照", "no:序号,kind:类型,requirement:要求,score:分值,status:结论,evidence:依据,gap:缺口"}};

    private static final Map<String, Key> INDEX = new HashMap<>();

    static {
        for (String s : SCALARS) INDEX.put(s, new Key(null, s));
        for (String[] e : SCALAR_EN) INDEX.put(e[0].toLowerCase(), new Key(null, e[1]));
        LISTS.forEach((list, fields) -> fields.forEach(f -> INDEX.put(list + "." + f, new Key(list, f))));
        for (String[] e : LIST_EN) {
            for (String pair : e[2].split(",")) {
                String[] kv = pair.split(":");
                INDEX.put((e[0] + "." + kv[0]).toLowerCase(), new Key(e[1], kv[1]));
            }
        }
    }

    private Fields() {}

    /** 去掉空白（Word 里常混进全角空格）后查表；认不出返回 null。 */
    static Key resolve(String raw) {
        if (raw == null) return null;
        String k = raw.replaceAll("[\\s\\u3000]", "").replace('．', '.').replace('。', '.');
        Key hit = INDEX.get(k);
        return hit != null ? hit : INDEX.get(k.toLowerCase());
    }
}
