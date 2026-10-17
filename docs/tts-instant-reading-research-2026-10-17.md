<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# 长文本即时朗读：选型与验收（2026-10-17）

对应 dev-board#1337、#1338。用户需要长文本尽早起播、播放时即时调速和同步字幕。当前“全文生成后才播放”使首音等待随文章长度增长；Python KPipeline 虽产出分片，包装层会拼完 WAV，Java 和前端又等完整响应。原字幕只按字符占比猜时间，没有可见的字幕区。

## 上游核验

星数为 2026-10-17 GitHub API 快照，不把星数当稳定性或速度保证。调研核对上游文档与许可；没有安装并实测所有候选引擎。

| 上游 | 星数 | 维护/发布快照 | 与本任务相关能力和限制 |
|---|---:|---|---|
| [hexgrad/kokoro](https://github.com/hexgrad/kokoro) | 9,393 | 默认分支最近提交 2025-08-06 | 已用82M模型；generator逐段产音，中文可用；本轮无需更换依赖 |
| [remsky/Kokoro-FastAPI](https://github.com/remsky/Kokoro-FastAPI) | 5,555 | 最近提交2026-10-14；v0.9.0 | 分块PCM、字幕时间戳；支持原生macOS MPS，Mac Docker为CPU；整套替换会增加非必需功能 |
| [k2-fsa/sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) | 15,329 | 最近提交2026-10-17；v1.13.8 | ONNX Runtime，多平台CPU，支持Kokoro中英和生成回调；值得后续同音色A/B，未实测本机收益 |
| [OHF-Voice/piper1-gpl](https://github.com/OHF-Voice/piper1-gpl) | 5,902 | 最近提交2026-10-15；v1.8.0 | 轻量CPU逐块生成；代码GPL-3.0-or-later，中文音色许可不能按仓库总许可概括 |
| [QwenAudio/CosyVoice](https://github.com/QwenAudio/CosyVoice) | 24,013 | 最近提交2026-05-25 | 中文双流式、0.5B，依赖更重；不能把上游特定设备150ms指标当作桌面端保证 |

Kokoro代码及当前[中文v1.1模型](https://huggingface.co/hexgrad/Kokoro-82M-v1.1-zh)为Apache-2.0。Kokoro-FastAPI、sherpa-onnx、CosyVoice代码为Apache-2.0，模型须逐个核对；Piper中文[huayan模型卡](https://huggingface.co/rhasspy/piper-voices/blob/main/zh/zh_CN/huayan/medium/MODEL_CARD)标Dataset License: Unknown，不直接换入。没有新增供应商、网络请求目的地、模型或第三方源码。

## 本次决定

保留本地Kokoro与现有音色，用现有鉴权API逐句/限长分段合成，首段返回即播放，同时串行准备后段。语速采用浏览器保持音高的播放倍率，播放期间立即生效；每段按真实playing事件更新字幕，不估算全文字数时间轴。完整合成后导出标准WAV，文件保持原速，按钮明确说明。停止或离开面板中止客户端在途请求，未发起段不再生成；已进入Python的单段计算可能继续到该段结束，不能声称远端推理被立即杀死。

不立即换模型的依据是现有引擎热机实时率已明显小于1，主要瓶颈在首音等待全文。分段可能影响跨句韵律，本轮优先自然标点；首次初始化仍需数秒，不宣传无条件毫秒起播。

## 本机基线

主任务在独立Python进程调用已安装kokoro-runtime 1.0.1，使用已下载的中文模型和合成条款；HF_HUB_OFFLINE=1、TRANSFORMERS_OFFLINE=1，不访问用户合同或生产后端。CPU推理，PyTorch默认10线程。

| 输入 | 合成等待 | WAV字节 |
|---|---:|---:|
| 冷启动24字 | 5.400秒 | 280,844 |
| 热机744字全文 | 22.917秒 | 7,214,444 |
| 热机24字 | 0.952秒 | 280,844 |

上述为服务合成时间，不是浏览器首音实测。原始本机日志在 `/tmp/tts-1337-benchmark/baseline.log`，不提交机器运行日志。浏览器、队列、导出及实际首音验证记录在本次PR与台账；未发版，不把隔离验证称为用户客户端已升级。

## 浏览器实测

隔离服务 127.0.0.1:18937 复用已缓存模型；真实组件、真实 HTMLAudioElement，Chrome 默认自动播放策略、正常点击开始，音频输出静音。首音指标是从首个 HTTP 请求开始到首个媒体 playing 事件，不代表人工听音。Uni 元素使用最小 DOM 适配，API 绕过 Java/鉴权；未验正式 Electron、真实 Uni 自动滚动、文档编辑器高亮或 Windows。

子代理首轮在服务启动后第一次合成测得两段短文冷态首音 5.080 秒，热态 0.631 秒；主任务独立复跑通过，热态 0.596/0.555 秒。最终主任务用与旧基线完全相同的 744 字文本测得首音 **0.518 秒**，此时只准备好 1/36 段；全文仍在后台生成，28.027 秒完成。导出 WAV 完整解码为177秒，字幕拼接逐字还原原文。相较旧全文22.917秒的等待，改善在首音延迟；不宣称总合成算力提速。分段后音频时长与韵律可能改变，不能用 WAV 字节相同作成功条件。

最终浏览器验收还覆盖播放中1.5倍速不重发请求、暂停跨后续生成完成不续播、快速暂停/继续的迟到pause事件、真实下载与完整WAV解码、停止/卸载取消、第二段失败中止。14项reader测试、4项组件行为测试、1,481项项目页回归、95项可选组件回归、双语键校验、H5构建和后端4项TtsServiceTest通过。浏览器复跑命令与隔离服务启动方法见 `frontend/tests/tts-browser/README.md`；本机结果在 `/tmp/tts-1337-benchmark/ui-main-long/results.json`，不提交机器日志。
