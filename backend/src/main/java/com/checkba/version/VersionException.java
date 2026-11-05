// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.version;

/**
 * 版本记录相关异常。调用方一律捕获后降级，不得阻断主流程。
 *
 * message 默认视为技术性内部消息（可能带 Git 术语/分支名），不得原样回显给前端——
 * VersionController 的异常处理器只会展示业务措辞。极少数消息本来就是写给律师看的
 * 业务话术（例如"当前没有进行中的工作"），需要原样展示时用 {@link #userFacing}
 * 显式标记，不靠字符串匹配去猜。
 */
public class VersionException extends RuntimeException {

    private final boolean userFacing;
    private final String kind;

    public VersionException(String message, Throwable cause) {
        super(message, cause);
        this.userFacing = false;
        this.kind = null;
    }

    public VersionException(String message) {
        super(message);
        this.userFacing = false;
        this.kind = null;
    }

    private VersionException(String message, boolean userFacing, String kind) {
        super(message);
        this.userFacing = userFacing;
        this.kind = kind;
    }

    /** 业务性错误：message 本身就是写给律师看的话术，可以原样回显给前端。 */
    public static VersionException userFacing(String message) {
        return new VersionException(message, true, null);
    }

    /**
     * 云端写权限门禁（权限代次）对不上、要律师明确重新连接云端。kind 回给前端，
     * 协作弹窗据此显示「重新连接云端」按钮，不靠匹配文案去猜。
     */
    public static final String CLOUD_RECONNECT_REQUIRED = "CLOUD_RECONNECT_REQUIRED";

    public static VersionException cloudReconnectRequired(String message) {
        return new VersionException(message, true, CLOUD_RECONNECT_REQUIRED);
    }

    public static VersionException busy(String message) {
        return new VersionException(message, true, "VERSION_BUSY");
    }

    public String getKind() { return kind; }

    public boolean isUserFacing() {
        return userFacing;
    }
}
