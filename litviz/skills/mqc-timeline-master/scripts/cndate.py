#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""汉字数字写的日期换成阿拉伯数字，**只用于识别，不用于显示**。

起因是真实运行记录：判决书、裁定书的落款日期一律是「二〇二五年十二月二十九日」
这种写法，而读日期（pick.dates_in）与到日判断（check_model_output._has_day）只认
阿拉伯数字。后果有两个，都在真材料上出现过：
  · 模型把落款判成 exact，被拦下（「该句没有到日的表述」），只好改判成「起止同一天
    的区间」来凑过校验；另一个模型干脆把落款句判成「判决落款、非事实」，图上一审
    判决那一项就没有日期。
  · 按时间段勾选时，落款句被当成没有日期，过筛失去依据。
不同的 PDF 抽取工具还会让落款变成「二 〇 二 六 年 四 月 九 日」（字间带空格），
所以字与字之间允许空白。

判据卡得死：年份必须是四个「〇零一二三四五六七八九」（不含「十」），后面紧跟
「年」，再跟月（一至十二）；「第一百五十七条」「一审」「三笔费用」都不会被认成日期。
原文一个字不改 —— raw 仍然必须逐字出现在原句里，这里换出来的文本只拿去做匹配。
"""
import re

_D = "〇零一二三四五六七八九"
_SP = r"[\s\u3000]*"
_Y = _SP.join([f"([{_D}])"] * 4)
_NUM = f"([一二三四五六七八九十](?:{_SP}[一二三四五六七八九十]){{0,2}})"
_FULL = re.compile(_Y + _SP + "年" + _SP + _NUM + _SP + "月" + _SP + _NUM + _SP + "日")
_YM = re.compile(_Y + _SP + "年" + _SP + _NUM + _SP + "月(?!" + _SP + "[一二三四五六七八九十])")


def _small(t):
    """一至三十一。十 = 10，十二 = 12，二十九 = 29，三十一 = 31。认不出返回 None。"""
    t = re.sub(r"\s", "", t)
    d = "一二三四五六七八九"
    if "十" in t:
        a, _, b = t.partition("十")
        if (a and a not in d) or (b and b not in d) or t.count("十") > 1:
            return None
        v = (d.index(a) + 1 if a else 1) * 10 + (d.index(b) + 1 if b else 0)
    elif len(t) == 1 and t in d:
        v = d.index(t) + 1
    else:
        return None
    return v


_DIGIT = {"〇": 0, "零": 0, "一": 1, "二": 2, "三": 3, "四": 4,
          "五": 5, "六": 6, "七": 7, "八": 8, "九": 9}


def _year(m):
    return "".join(str(_DIGIT[m.group(k)]) for k in range(1, 5))


def arabize(s):
    """把句中汉字日期换成「2025年12月29日」「2025年12月」，其余一字不动。"""
    if not s or "年" not in s:
        return s

    def full(m):
        mo, da = _small(m.group(5)), _small(m.group(6))
        if not (mo and da and 1 <= mo <= 12 and 1 <= da <= 31):
            return m.group(0)
        return f"{_year(m)}年{mo}月{da}日"

    def ym(m):
        mo = _small(m.group(5))
        if not (mo and 1 <= mo <= 12):
            return m.group(0)
        return f"{_year(m)}年{mo}月"

    return _YM.sub(ym, _FULL.sub(full, s))
