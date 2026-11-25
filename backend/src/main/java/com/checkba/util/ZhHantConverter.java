// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
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
        // 并 defaults to 並 ("and"); merge words keep 併 (readiness Q4)
        phrases.put("合并", "合併");
        phrases.put("兼并", "兼併");
        phrases.put("吞并", "吞併");
        phrases.put("并购", "併購");
        phrases.put("并入", "併入");
        phrases.put("归并", "歸併");
        phrases.put("并案", "併案");
        // 签 defaults to 簽 (sign); tag/label words use 籤
        phrases.put("标签", "標籤");
        phrases.put("书签", "書籤");
        // 制 stays 制 (控制, 制度); make/produce words use 製
        phrases.put("制作", "製作");
        phrases.put("制造", "製造");
        phrases.put("绘制", "繪製");
        phrases.put("印制", "印製");
        phrases.put("定制", "訂製");
        // 注 stays 注 (注意); register/annotate words use 註
        phrases.put("注册", "註冊");
        phrases.put("注释", "註釋");
        phrases.put("备注", "備註");
        phrases.put("批注", "批註");
        phrases.put("标注", "標註");
        phrases.put("注销", "註銷");
        phrases.put("附注", "附註");
        // 尽 defaults to 盡; 儘 in these words
        phrases.put("尽量", "儘量");
        phrases.put("尽管", "儘管");
        PHRASE_MAP = Collections.unmodifiableMap(phrases);

        String[] pairList = {
            "请請", "设設", "账賬", "户戶", "团團", "队隊", "项項", "软軟", "盘盤", "检檢",
            "审審", "权權", "录錄", "错錯", "误誤", "败敗", "暂暫", "时時", "师師", "诉訴",
            "讼訟", "签簽", "约約", "证證", "据據", "档檔", "编編", "辑輯", "删刪", "复復",
            "贴貼", "导導", "预預", "览覽", "关關", "闭閉", "开開", "启啟", "选選",
            "择擇", "确確", "认認", "创創", "员員", "码碼", "机機", "号號", "额額", "数數",
            "单單", "笔筆", "过過", "余餘", "币幣", "库庫", "应應", "务務", "动動", "态態",
            "统統", "计計", "连連", "结結", "断斷", "线線", "网網", "络絡", "传傳", "输輸",
            "载載", "试試", "验驗", "费費", "订訂", "阅閱", "购購", "买買", "卖賣", "退退",
            "发發", "总總", "价價", "优優", "惠惠", "兑兌", "换換", "积積", "励勵", "邀邀",
            "链鏈", "维維", "扫掃", "绑綁", "改改", "邮郵", "电電", "话話", "讯訊", "标標",
            "类類", "筛篩", "寻尋", "询詢", "无無", "记記", "历歷", "详詳", "说說",
            "帮幫", "馈饋", "于於", "协協", "议議", "条條", "隐隱", "绝絕", "撤撤", "销銷",
            "备備", "云雲", "离離", "进進", "续續", "险險", "级級", "格格", "宽寬", "长長",
            "颜顏", "体體", "划劃", "齐齊", "单單", "并並", "数數", "图圖", "灯燈", "页頁",
            "节節", "题題", "较較", "对對", "异異", "险險", "规規", "律律", "处處",
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
        // Common one-to-one characters that used to be missing, leaving Simplified text inside zh-TW strings
        // (readiness Q5). Only unambiguous pairs; ambiguous ones (发/干/台/里/系/范/准/着/面 ...) need phrases.
        String extraPairs = "这這别別将將则則内內后後还還让讓给給从從现現点點击擊样樣实實显顯与與区區报報产產运運达達张張万萬专專业業两兩么麼尽盡当當细細侧側状狀种種稳穩头頭层層组組织織经經营營际際难難质質贵貴转轉轮輪轻輕边邊远遠违違适適递遞逻邏遗遺释釋针針钟鐘钱錢银銀锁鎖键鍵镜鏡阶階陆陸随隨顶頂顺順须須顾顧领領风風飞飛馆館驱驅鱼魚龙龍乱亂争爭亚亞亿億仅僅众眾伟偉债債储儲儿兒党黨兴興养養决決况況减減凭憑刚剛剧劇劝勸办辦劳勞势勢医醫华華卫衛却卻厂廠厅廳压壓县縣双雙变變叶葉吗嗎听聽响響园園围圍圆圓场場坏壞块塊坚堅墙牆声聲够夠夺奪奖獎妇婦学學宁寧宝寶宪憲尔爾属屬岁歲岛島帐帳带帶广廣庄莊庆慶废廢弃棄弹彈强強彻徹径徑怀懷恶惡惊驚惯慣愿願战戰扩擴扬揚扰擾担擔拟擬拥擁挂掛挡擋挥揮损損携攜摄攝摆擺敌敵旧舊晓曉术術杀殺杂雜极極构構柜櫃树樹桥橋梦夢欢歡毕畢气氣汇匯汉漢没沒沟溝济濟浅淺测測浏瀏润潤涨漲渐漸湾灣满滿滚滾灭滅灵靈灾災热熱烦煩爱愛牵牽犹猶独獨环環画畫畅暢疗療盖蓋监監础礎硕碩碍礙礼禮称稱穷窮竞競简簡紧緊纠糾红紅纪紀纯純纳納纷紛纸紙练練终終绍紹绕繞绘繪继繼绩績绪緒综綜绿綠缓緩缘緣缩縮缴繳罗羅罚罰职職联聯肤膚胜勝脑腦脱脫艺藝苏蘇荐薦药藥获獲虑慮虽雖补補装裝触觸讨討赶趕趋趨跃躍践踐踪蹤辅輔辆輛辞辭迁遷迟遲邻鄰鉴鑑钢鋼钥鑰铁鐵闪閃阳陽阴陰阵陣陈陳顿頓颗顆饰飾驳駁驶駛驻駐驾駕骗騙骤驟龄齡冲衝册冊军軍农農劲勁叠疊唤喚嘱囑垫墊届屆巩鞏帜幟忧憂恼惱悬懸惨慘惩懲抚撫抛拋抢搶护護拦攔拨撥挤擠捡撿搁擱栏欄楼樓残殘泽澤洁潔渗滲湿濕溃潰滞滯滤濾滥濫潜潛烧燒盐鹽筹籌纤纖绳繩缔締耻恥胀脹胆膽胶膠脸臉舆輿艰艱荣榮蓝藍袭襲诱誘谜謎轨軌迹跡钞鈔钻鑽阐闡辩辯鸟鳥齿齒鲜鮮";
        for (int i = 0; i + 1 < extraPairs.length(); i += 2) {
            chars.putIfAbsent(extraPairs.charAt(i), extraPairs.charAt(i + 1));
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
