// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.legal.cn;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 人民法院案号的结构化表示与离线解析（纯函数，不碰 Spring、IO 与网络）。
 *
 * <p>格式依《最高人民法院关于人民法院案件案号的若干规定》（2016 年起施行）：
 * 「（收案年度）法院代字 类型代字 案件编号 号」，例如「（2023）京01民终1234号」。
 * 法院代字 = 省级简称 + 0/2/4 位数字，分别对应高级 / 中级 / 基层法院；最高人民法院为「最高法」。
 *
 * <p>2016 年以前的旧式案号（「(2015)民二终字第1号」「(2014)京一中民终字第1234号」）
 * 不在本格式内，返回 {@code null}，不猜。类型代字表外的代字照常解析，
 * 只是 {@code caseTypeName} 为 {@code null}、{@code category} 按首字推断。
 * 本类只识别形式，不核实案件是否真实存在。
 *
 * @param raw          原文片段
 * @param start        原文起点（含）
 * @param end          原文终点（不含）
 * @param year         收案年度
 * @param courtCode    法院代字（「京01」「最高法」）
 * @param province     省级行政区全称（「北京市」）；最高法为 {@code null}
 * @param courtLevel   法院层级
 * @param caseTypeCode 类型代字（「民终」）
 * @param caseTypeName 类型名称（「民事二审」），表外代字为 {@code null}
 * @param category     案件大类
 * @param sequence     案件编号
 */
public record CaseNumber(String raw, int start, int end,
                         int year, String courtCode, String province, CourtLevel courtLevel,
                         String caseTypeCode, String caseTypeName, Category category, long sequence) {

    public enum CourtLevel { SUPREME, HIGH, INTERMEDIATE, BASIC }

    public enum Category {
        CIVIL, CRIMINAL, ADMINISTRATIVE, STATE_COMPENSATION, ENFORCEMENT, PRESERVATION, BANKRUPTCY, OTHER
    }

    private static final Map<Character, String> PROVINCES = Map.ofEntries(
            Map.entry('京', "北京市"), Map.entry('津', "天津市"), Map.entry('沪', "上海市"), Map.entry('渝', "重庆市"),
            Map.entry('冀', "河北省"), Map.entry('晋', "山西省"), Map.entry('蒙', "内蒙古自治区"), Map.entry('辽', "辽宁省"),
            Map.entry('吉', "吉林省"), Map.entry('黑', "黑龙江省"), Map.entry('苏', "江苏省"), Map.entry('浙', "浙江省"),
            Map.entry('皖', "安徽省"), Map.entry('闽', "福建省"), Map.entry('赣', "江西省"), Map.entry('鲁', "山东省"),
            Map.entry('豫', "河南省"), Map.entry('鄂', "湖北省"), Map.entry('湘', "湖南省"), Map.entry('粤', "广东省"),
            Map.entry('桂', "广西壮族自治区"), Map.entry('琼', "海南省"), Map.entry('川', "四川省"), Map.entry('贵', "贵州省"),
            Map.entry('云', "云南省"), Map.entry('藏', "西藏自治区"), Map.entry('陕', "陕西省"), Map.entry('甘', "甘肃省"),
            Map.entry('青', "青海省"), Map.entry('宁', "宁夏回族自治区"), Map.entry('新', "新疆维吾尔自治区"),
            Map.entry('兵', "新疆生产建设兵团"));

    /** 常见类型代字（《人民法院案件类型及其代字标准》节选）。 */
    private static final Map<String, Type> TYPES = Map.ofEntries(
            type("民初", "民事一审", Category.CIVIL),
            type("民终", "民事二审", Category.CIVIL),
            type("民申", "民事申请再审审查", Category.CIVIL),
            type("民抗", "民事抗诉再审审查", Category.CIVIL),
            type("民再", "民事再审", Category.CIVIL),
            type("民监", "民事审判监督", Category.CIVIL),
            type("民特", "民事特别程序", Category.CIVIL),
            type("民催", "催告", Category.CIVIL),
            type("民督", "督促", Category.CIVIL),
            type("民撤", "第三人撤销之诉", Category.CIVIL),
            type("民辖", "民事管辖", Category.CIVIL),
            type("民辖终", "民事管辖上诉", Category.CIVIL),
            type("刑初", "刑事一审", Category.CRIMINAL),
            type("刑终", "刑事二审", Category.CRIMINAL),
            type("刑申", "刑事申诉审查", Category.CRIMINAL),
            type("刑抗", "刑事抗诉再审审查", Category.CRIMINAL),
            type("刑再", "刑事再审", Category.CRIMINAL),
            type("刑核", "刑事复核", Category.CRIMINAL),
            type("刑更", "减刑假释", Category.CRIMINAL),
            type("行初", "行政一审", Category.ADMINISTRATIVE),
            type("行终", "行政二审", Category.ADMINISTRATIVE),
            type("行申", "行政申请再审审查", Category.ADMINISTRATIVE),
            type("行抗", "行政抗诉再审审查", Category.ADMINISTRATIVE),
            type("行再", "行政再审", Category.ADMINISTRATIVE),
            type("行审", "非诉行政行为申请执行审查", Category.ADMINISTRATIVE),
            type("法赔", "法院作为赔偿义务机关审查", Category.STATE_COMPENSATION),
            type("委赔", "赔偿委员会审理赔偿", Category.STATE_COMPENSATION),
            type("执", "首次执行", Category.ENFORCEMENT),
            type("执恢", "恢复执行", Category.ENFORCEMENT),
            type("执异", "执行异议", Category.ENFORCEMENT),
            type("执复", "执行复议", Category.ENFORCEMENT),
            type("执监", "执行监督", Category.ENFORCEMENT),
            type("执保", "财产保全执行", Category.ENFORCEMENT),
            type("财保", "非诉财产保全审查", Category.PRESERVATION),
            type("证保", "非诉证据保全审查", Category.PRESERVATION),
            type("破申", "破产申请审查", Category.BANKRUPTCY),
            type("破", "破产", Category.BANKRUPTCY),
            type("强清", "强制清算", Category.BANKRUPTCY));

    private static final Pattern CASE_NUMBER = Pattern.compile(
            "[(（〔\\[［]\\s*(?<year>\\d{4})\\s*[)）〕\\]］]\\s*"
                    + "(?<court>最高法|[京津沪渝冀晋蒙辽吉黑苏浙皖闽赣鲁豫鄂湘粤桂琼川贵云藏陕甘青宁新兵]\\d{0,4})\\s*"
                    + "(?<type>[\\u4e00-\\u9fa5&&[^字第号]]{1,6})\\s*"
                    + "(?<seq>\\d{1,7})\\s*号");

    /** 文本中全部案号，按出现顺序。全角数字按半角识别，位置仍指向原文。 */
    public static List<CaseNumber> findAll(String text) {
        List<CaseNumber> out = new ArrayList<>();
        if (text == null || text.isEmpty()) return out;
        Matcher m = CASE_NUMBER.matcher(halfWidthDigits(text));
        while (m.find()) {
            CaseNumber c = build(text, m);
            if (c != null) out.add(c);
        }
        return out;
    }

    /** 整串恰好是一个案号（首尾空白不计）时返回它，否则 {@code null}。 */
    public static CaseNumber parse(String text) {
        if (text == null) return null;
        String s = text.strip();
        List<CaseNumber> all = findAll(s);
        if (all.size() != 1) return null;
        CaseNumber c = all.get(0);
        return c.start() == 0 && c.end() == s.length() ? c : null;
    }

    /** 规范写法：全角括号、去空白、半角数字——「(2023) 京01 民终 1234 号」→「（2023）京01民终1234号」。 */
    public String normalized() {
        return "（" + year + "）" + courtCode + caseTypeCode + sequence + "号";
    }

    // ---- 内部 ----

    private record Type(String name, Category category) {
    }

    private static Map.Entry<String, Type> type(String code, String name, Category category) {
        return Map.entry(code, new Type(name, category));
    }

    private static CaseNumber build(String text, Matcher m) {
        int year = Integer.parseInt(m.group("year"));
        if (year < 1950 || year > 2099) return null;
        String court = m.group("court");
        CourtLevel level;
        String province;
        if (court.equals("最高法")) {
            level = CourtLevel.SUPREME;
            province = null;
        } else {
            level = switch (court.length() - 1) {
                case 0 -> CourtLevel.HIGH;
                case 2 -> CourtLevel.INTERMEDIATE;
                case 4 -> CourtLevel.BASIC;
                default -> null;
            };
            if (level == null) return null;
            province = PROVINCES.get(court.charAt(0));
        }
        String code = m.group("type");
        // 最高人民法院知识产权法庭的「知民终」「知行终」：去掉「知」再查表
        boolean ip = code.length() > 1 && code.charAt(0) == '知';
        Type t = TYPES.get(ip ? code.substring(1) : code);
        String name = t == null ? null : (ip ? "知识产权" + t.name() : t.name());
        Category category = t != null ? t.category() : guess(ip ? code.substring(1) : code);
        long seq = Long.parseLong(m.group("seq"));
        if (seq < 1) return null;
        return new CaseNumber(text.substring(m.start(), m.end()), m.start(), m.end(),
                year, court, province, level, code, name, category, seq);
    }

    private static Category guess(String code) {
        if (code.contains("赔")) return Category.STATE_COMPENSATION;
        if (code.contains("保")) return Category.PRESERVATION;
        return switch (code.charAt(0)) {
            case '民' -> Category.CIVIL;
            case '刑' -> Category.CRIMINAL;
            case '行' -> Category.ADMINISTRATIVE;
            case '执' -> Category.ENFORCEMENT;
            case '破', '强' -> Category.BANKRUPTCY;
            default -> Category.OTHER;
        };
    }

    private static String halfWidthDigits(String s) {
        StringBuilder sb = new StringBuilder(s.length());
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            sb.append(c >= '０' && c <= '９' ? (char) (c - '０' + '0') : c);
        }
        return sb.toString();
    }
}
