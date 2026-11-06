// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.legal.cn;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 法律简称/全称/俗称别名表（纯数据，离线）。
 *
 * <p>只收全国人大及其常委会制定的<b>法律</b>（全称一律是「中华人民共和国」+ 简称），
 * 含已被民法典废止但文书里仍大量引用的旧法（合同法、物权法……）。
 * 本表只做名称归一，<b>不表示现行有效</b>；时效判断属于外部法规库的事。
 * 行政法规、司法解释、地方性法规名称五花八门、简称不唯一，本期不收——
 * 它们在书名号里出现时原样保留标题。
 */
public final class LawAliases {

    private static final String PRC = "中华人民共和国";

    /** 规范简称 → 额外俗称（规范简称本身与全称自动算作别名）。 */
    private static final Map<String, List<String>> TABLE = new LinkedHashMap<>();

    static {
        add("宪法");
        add("立法法");
        add("监察法");
        add("民法典");
        add("民法总则");
        add("民法通则");
        add("合同法");
        add("物权法");
        add("担保法");
        add("侵权责任法");
        add("婚姻法");
        add("继承法");
        add("收养法");
        add("公司法");
        add("合伙企业法");
        add("个人独资企业法");
        add("企业破产法", "破产法");
        add("证券法");
        add("证券投资基金法", "基金法");
        add("保险法");
        add("商业银行法");
        add("票据法");
        add("信托法");
        add("民事诉讼法", "民诉法");
        add("刑法");
        add("刑事诉讼法", "刑诉法");
        add("行政诉讼法", "行诉法");
        add("行政处罚法");
        add("行政许可法");
        add("行政复议法");
        add("国家赔偿法");
        add("治安管理处罚法");
        add("仲裁法");
        add("律师法");
        add("公证法");
        add("劳动法");
        add("劳动合同法");
        add("劳动争议调解仲裁法");
        add("社会保险法");
        add("著作权法");
        add("专利法");
        add("商标法");
        add("反不正当竞争法");
        add("反垄断法");
        add("消费者权益保护法", "消法", "消保法");
        add("产品质量法");
        add("食品安全法");
        add("广告法");
        add("电子商务法", "电商法");
        add("电子签名法");
        add("网络安全法");
        add("数据安全法");
        add("个人信息保护法", "个保法");
        add("外商投资法");
        add("招标投标法", "招投标法");
        add("政府采购法");
        add("土地管理法");
        add("城市房地产管理法");
        add("道路交通安全法");
        add("环境保护法");
        add("反洗钱法");
        add("出口管制法");
        add("反外国制裁法");
    }

    /** 任一写法 → 规范简称。 */
    private static final Map<String, String> LOOKUP = new LinkedHashMap<>();
    /** 供无书名号扫描用：全部写法，长的在前（「劳动合同法」先于「合同法」）。 */
    private static final List<String> NAMES_LONGEST_FIRST;

    static {
        TABLE.forEach((shortName, extras) -> {
            LOOKUP.put(shortName, shortName);
            LOOKUP.put(PRC + shortName, shortName);
            extras.forEach(e -> LOOKUP.put(e, shortName));
        });
        List<String> names = new ArrayList<>(LOOKUP.keySet());
        names.sort(Comparator.comparingInt(String::length).reversed());
        NAMES_LONGEST_FIRST = List.copyOf(names);
    }

    private LawAliases() {
    }

    private static void add(String shortName, String... extras) {
        TABLE.put(shortName, List.of(extras));
    }

    /** 去空白后查表；查不到返回 {@code null}。 */
    public static String canonicalShort(String title) {
        return title == null ? null : LOOKUP.get(compact(title));
    }

    /** 表内法律的全称（「中华人民共和国民法典」）；不在表内返回 {@code null}。 */
    public static String fullName(String title) {
        String s = canonicalShort(title);
        return s == null ? null : PRC + s;
    }

    public static boolean isKnown(String title) {
        return canonicalShort(title) != null;
    }

    static List<String> namesLongestFirst() {
        return NAMES_LONGEST_FIRST;
    }

    static String compact(String s) {
        return s.replaceAll("[\\s\\u3000]+", "");
    }
}
