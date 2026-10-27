// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.sensitive;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

/** Local address spans; offsets always refer to the unmodified paragraph. */
public final class ChineseAddressRecognizer {
    public record Span(int start, int end) {}
    private static final String PROVINCES = "(?:北京|天津|上海|重庆)市|(?:河北|山西|辽宁|吉林|黑龙江|江苏|浙江|安徽|福建|江西|山东|河南|湖北|湖南|广东|海南|四川|贵州|云南|陕西|甘肃|青海|台湾)省|(?:内蒙古|广西壮族|西藏|宁夏回族|新疆维吾尔)自治区|(?:香港|澳门)特别行政区";
    private static final Pattern PROVINCE = Pattern.compile(PROVINCES);
    private static final Pattern CITY = Pattern.compile("[\\p{IsHan}]{1,10}?(?:自治州|地区|市|盟)");
    private static final Pattern COUNTY = Pattern.compile("[\\p{IsHan}]{1,12}?(?:自治县|自治旗|区|县|旗|市)");
    private static final Pattern FIELD = Pattern.compile(
            "(?:注册地址|注册地|登记住所|通讯地址|通信地址|送达地址|联系地址|办公地址|经营地址|住所地|住所|住址|地址)"
            + "(?:\\h*[：:]\\h*(?:(?:为|是|位于)\\h*)?|\\h*(?:为|是|位于)\\h*|\\h+)");
    private static final Pattern CONTEXT = Pattern.compile("(?:位于|坐落于|居住于|住在|迁至|寄至|送至|在)\\h*");
    private static final Pattern BOUNDARY = Pattern.compile("(?:^|[\\r\\n，,。；;：:])\\h*", Pattern.MULTILINE);
    private static final Pattern STOP = Pattern.compile(
            "[\\r\\n，,。；;：:！？!?\\t]|(?:法定代表人|负责人|联系人|联系电话|电话|手机号码|手机号|手机|邮编|电子邮箱|邮箱|统一社会信用代码|注册资本|经营范围|公司名称|企业名称|身份证号码|身份证号|出生日期|性别|民族|现住址|曾用名|姓名|传真|邮政编码|开户银行|开户行|银行账号|甲方|乙方|(?:共同)?(?:原告|被告|第三人|申请执行人|被执行人|申请人|被申请人|上诉人|被上诉人)\\h*(?:[0-9０-９一二三四五六七八九十百零〇两]+|[（(]\\h*[0-9０-９一二三四五六七八九十百零〇两]+\\h*[）)])?(?:\\h*[（(](?:自然人|反诉原告|反诉被告)[）)])?)\\h*(?:[：:]|(?=\\h))"
            + "|(?:签署|签订|履行|约定|经营业务|开展业务|从事|办理|应当|已经|依法|负责|进行|并将|并于|需要|拟于|应于)|(?:办公|居住|经营)(?=$|[，,。；;\\s])");
    private static final Pattern DETAIL = Pattern.compile(
            "(?:[\\p{IsHan}A-Za-z0-9０-９]{1,32}(?:街道|大道|大街|胡同|路|街|巷|镇|乡|村|社区|小区|园区|大厦|广场|花园|公寓|写字楼|中心|道|区|园|城|座)"
            + "|[A-Za-z0-9０-９零一二三四五六七八九十百甲乙丙丁之至\\-—]{1,16}(?:号院|号楼|号|栋|幢|座|单元|楼|层|室|房|弄))+");
    private static final Pattern PROSE = Pattern.compile("(?:本合同|本协议|双方|应当|约定|送达|通知|另行|待补充|位于|寄至|签署|签订)");
    private static final Pattern INTRO = Pattern.compile("^(?:我们|你们|他们|她们|我|公司|本公司|该公司|企业|项目|甲方|乙方|本人|他|她)(?:在|于|迁至|住在)");
    private static final Pattern ORGANIZATION = Pattern.compile("(?:有限公司|有限责任公司|人民法院|人民政府|委员会)");
    private static final Pattern TAIL = Pattern.compile("(?:[A-Za-z0-9０-９][A-Za-z0-9０-９\\-—/]{0,20})?(?:[（(][\\p{IsHan}A-Za-z0-9０-９\\-]{1,30}[）)])?");
    // Explicit address fields can contain trade-zone prefixes and locative suffixes that
    // are not administrative levels. Require postal detail and a plausible address ending.
    private static final Pattern FIELD_POSTAL_DETAIL = Pattern.compile("[0-9０-９零一二三四五六七八九十百甲乙丙丁]+(?:号|栋|幢|座|单元|楼|层|室|房|弄)");
    private static final Pattern FIELD_ADDRESS = Pattern.compile("[\\p{IsHan}A-Za-z0-9０-９（）()\\-—/]+(?:号|院|栋|幢|座|单元|楼|层|室|房|弄|[东南西北]侧|院内|院外|附近|[0-9０-９]|[）)])$");
    private static final Pattern SUFFIX = Pattern.compile("(?:特别行政区|自治区|自治州|自治县|自治旗|地区|省|市|区|县|旗|盟)$");

    private ChineseAddressRecognizer() {}

    public static List<Span> find(String text) {
        List<Span> spans = new ArrayList<>();
        var field = FIELD.matcher(text);
        while (field.find()) add(text, field.end(), true, spans);
        var province = PROVINCE.matcher(text);
        while (province.find()) add(text, province.start(), false, spans);
        var context = CONTEXT.matcher(text);
        while (context.find()) add(text, context.end(), false, spans);
        var boundary = BOUNDARY.matcher(text);
        while (boundary.find()) add(text, boundary.end(), false, spans);
        return spans.stream().distinct().toList();
    }

    private static void add(String text, int start, boolean field, List<Span> spans) {
        var stop = STOP.matcher(text);
        int limit = stop.find(start) ? stop.start() : text.length();
        if (limit - start > 512) return;
        String original = text.substring(start, limit).stripTrailing();
        String candidate = original.replaceAll("\\h+", "");
        if (candidate.isEmpty() || candidate.length() > 180 || PROSE.matcher(candidate).find() || ORGANIZATION.matcher(candidate).find() || INTRO.matcher(candidate).find()) return;
        // A boundary candidate must not absorb a label or sentence prefix before a later address.
        // The dedicated field/context/province passes already start after those words.
        var root = PROVINCE.matcher(candidate);
        if (FIELD.matcher(candidate).find() || (!field && root.find() && root.start() > 0)) return;
        int adminEnd = administrativeEnd(candidate, null);
        var lead = CONTEXT.matcher(candidate);
        if (lead.find() && lead.end() <= adminEnd) return;
        var detail = DETAIL.matcher(candidate).region(adminEnd, candidate.length());
        int end = detail.lookingAt() ? detail.end() : adminEnd;
        if (end > adminEnd) {
            var tail = TAIL.matcher(candidate).region(end, candidate.length());
            if (tail.lookingAt()) end = tail.end();
        }
        // Body text must match the whole postal grammar; explicit fields also accept
        // bounded address variants without leaving their unrecognized suffix exposed.
        boolean boundedFieldAddress = field && FIELD_POSTAL_DETAIL.matcher(candidate).find()
                && FIELD_ADDRESS.matcher(candidate).matches();
        if ((end != candidate.length() || end == 0) && !boundedFieldAddress) return;
        // A room count such as “户型：三房” is not a standalone postal address.
        // A lone room number needs an explicit address field; full addresses keep it.
        if (!field && adminEnd == 0
                && candidate.matches("[A-Za-z0-9０-９零一二三四五六七八九十百甲乙丙丁之至\\-—]{1,16}房")) return;
        if (!field && adminEnd == end) {
            List<String> levels = new ArrayList<>();
            administrativeEnd(candidate, levels);
            if (levels.size() < 2) return;
        }
        if (!field && adminEnd == 0 && !candidate.matches(".*[0-9０-９零一二三四五六七八九十].*")) return;
        spans.add(new Span(start, start + original.length()));
    }

    private static int administrativeEnd(String value, List<String> levels) {
        int end = 0;
        var province = PROVINCE.matcher(value);
        boolean municipality = false;
        if (province.lookingAt()) {
            end = province.end();
            municipality = province.group().endsWith("市");
            addLevel(province.group(), levels);
        }
        if (!municipality) {
            var city = CITY.matcher(value).region(end, value.length());
            if (city.lookingAt()) { end = city.end(); addLevel(city.group(), levels); }
        }
        var county = COUNTY.matcher(value).region(end, value.length());
        if (county.lookingAt() && !county.group().matches(".*(?:小区|社区|园区|工业区|开发区)$")) {
            end = county.end(); addLevel(county.group(), levels);
        }
        return end;
    }

    private static void addLevel(String value, List<String> levels) {
        var suffix = SUFFIX.matcher(value);
        if (levels != null && suffix.find()) levels.add("XX" + suffix.group());
    }

    public static String mask(String value) {
        List<String> levels = new ArrayList<>();
        administrativeEnd(value.replaceAll("\\h+", ""), levels);
        return String.join("", levels) + "XXXX";
    }
}
