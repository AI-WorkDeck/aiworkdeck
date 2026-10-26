// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.util;

import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Lightweight, zero-dependency Simplified-to-Traditional Chinese (zh-CN -> zh-TW) converter
 * for backend user-visible fallback strings and plugin manifest labels.
 */
public final class ZhHantConverter {

    private static final Map<String, String> PHRASE_MAP;
    private static final Map<Character, Character> CHAR_MAP;

    static {
        Map<String, String> phrases = new LinkedHashMap<>();
        phrases.put("插件临时项目", "插件臨時項目");
        phrases.put("余额不足", "餘額不足");
        phrases.put("暂不可用", "暫不可用");
        phrases.put("软件", "軟體");
        phrases.put("设置", "設定");
        phrases.put("默认", "預設");
        phrases.put("网络", "網路");
        phrases.put("服务器", "伺服器");
        phrases.put("文件夹", "資料夾");
        phrases.put("复制", "複製");
        phrases.put("粘贴", "貼上");
        phrases.put("登录", "登入");
        phrases.put("账户", "帳戶");
        phrases.put("账号", "帳號");
        phrases.put("数据", "資料");
        phrases.put("信息", "資訊");
        phrases.put("激活", "啟用");
        PHRASE_MAP = Collections.unmodifiableMap(phrases);

        String[] pairList = {
            "请請", "设設", "账賬", "户戶", "团團", "队隊", "项項", "软軟", "盘盤", "检檢",
            "审審", "权權", "录錄", "错錯", "误誤", "败敗", "暂暫", "时時", "师師", "诉訴",
            "讼訟", "签簽", "约約", "证證", "据據", "档檔", "编編", "辑輯", "删刪", "复復",
            "制製", "贴貼", "导導", "预預", "览覽", "关關", "闭閉", "开開", "启啟", "选選",
            "择擇", "确確", "认認", "创創", "员員", "码碼", "机機", "号號", "额額", "数數",
            "单單", "笔筆", "过過", "余餘", "币幣", "库庫", "应應", "务務", "动動", "态態",
            "统統", "计計", "连連", "结結", "断斷", "线線", "网網", "络絡", "传傳", "输輸",
            "载載", "试試", "验驗", "费費", "订訂", "阅閱", "购購", "买買", "卖賣", "退退",
            "发發", "总總", "价價", "优優", "惠惠", "兑兌", "换換", "积積", "励勵", "邀邀",
            "链鏈", "维維", "扫掃", "绑綁", "改改", "邮郵", "电電", "话話", "讯訊", "标標",
            "签籤", "类類", "筛篩", "寻尋", "询詢", "无無", "记記", "历歷", "详詳", "说說",
            "帮幫", "馈饋", "于於", "协協", "议議", "条條", "隐隱", "绝絕", "撤撤", "销銷",
            "备備", "云雲", "离離", "进進", "续續", "险險", "级級", "格格", "宽寬", "长長",
            "颜顏", "体體", "划劃", "齐齊", "单單", "并併", "数數", "图圖", "灯燈", "页頁",
            "节節", "题題", "注註", "较較", "对對", "异異", "险險", "规規", "律律", "处處",
            "归歸", "附附", "频頻", "视視", "写寫", "译譯", "读讀", "语語", "识識", "忆憶",
            "识識", "执執", "调調", "参參", "超超", "流流", "配配", "个個", "们們", "为為",
            "来來", "国國", "会會", "东東", "车車", "书書", "门門", "问問", "间間", "闻聞",
            "见見", "观觀", "规規", "视視", "觉覺", "览覽", "言言", "计計", "训訓", "议議",
            "记記", "讲講", "许許", "论論", "讼訟", "设設", "访訪", "证證", "评評", "识識",
            "诈詐", "诉訴", "诊診", "词詞", "诏詔", "译譯", "试試", "诗詩", "诚誠", "话話",
            "诞誕", "询詢", "该該", "详詳", "语語", "误誤", "说說", "请請", "诸諸", "诺諾",
            "读讀", "诽誹", "课課", "谁誰", "调調", "谅諒", "谈談", "谋謀", "谍諜", "谎謊",
            "谐諧", "谓謂", "谢謝", "谣謠", "谤謗", "谦謙", "谨謹", "谬謬", "谱譜", "谴譴",
            "贝貝", "贞貞", "负負", "财財", "贡貢", "贫貧", "货貨", "贩販", "贪貪", "贯貫",
            "责責", "贮貯", "贷貸", "贸貿", "费費", "贺賀", "贼賊", "贾賈", "贿賄", "赁賃",
            "赂賂", "赃贓", "资資", "赅賅", "赆贐", "赈賑", "赉賚", "赊賒", "赋賦", "赌賭",
            "赎贖", "赏賞", "赐賜", "赔賠", "赖賴", "赘贅", "赚賺", "赛賽", "赜賾", "赞贊",
            "赠贈", "赡贍", "赢贏", "赣贛"
        };

        Map<Character, Character> chars = new HashMap<>(pairList.length);
        for (String pair : pairList) {
            if (pair.length() == 2) {
                char sc = pair.charAt(0);
                char tc = pair.charAt(1);
                if (sc != tc) {
                    chars.put(sc, tc);
                }
            }
        }
        CHAR_MAP = Collections.unmodifiableMap(chars);
    }

    private ZhHantConverter() {
    }

    /**
     * Converts a Simplified Chinese string into Traditional Chinese.
     */
    public static String toTraditional(String simplified) {
        if (simplified == null || simplified.isEmpty()) {
            return simplified;
        }
        String working = simplified;
        for (Map.Entry<String, String> entry : PHRASE_MAP.entrySet()) {
            if (working.contains(entry.getKey())) {
                working = working.replace(entry.getKey(), entry.getValue());
            }
        }
        StringBuilder sb = new StringBuilder(working.length());
        for (int i = 0; i < working.length(); i++) {
            char c = working.charAt(i);
            sb.append(CHAR_MAP.getOrDefault(c, c));
        }
        return sb.toString();
    }
}
