// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
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

    /** 设了打开密码的 Office 文件抽不出文本/比对不了；kind 与前端 DIAG_DOC_ENCRYPTED 同名。 */
    public static final String DOC_ENCRYPTED = "DOC_ENCRYPTED";

    public static VersionException passwordProtected(String message) {
        return new VersionException(message, true, DOC_ENCRYPTED);
    }

    /**
     * C12：版本里有大文件 / 音视频，交稿要先开文件云端备份。kind 回给前端，交稿处弹一个不会自己
     * 消失、带「开启文件云端备份」按钮的说明，不靠匹配文案去猜。
     */
    public static final String LARGE_FILES_NEED_BACKUP = "LARGE_FILES_NEED_BACKUP";

    public static VersionException largeFilesNeedBackup(String message) {
        return new VersionException(message, true, LARGE_FILES_NEED_BACKUP);
    }

    public String getKind() { return kind; }

    public boolean isUserFacing() {
        return userFacing;
    }
}
