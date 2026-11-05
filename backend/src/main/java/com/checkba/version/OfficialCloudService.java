// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.version;

import cn.hutool.http.HttpRequest;
import cn.hutool.http.HttpResponse;
import cn.hutool.json.JSONObject;
import cn.hutool.json.JSONUtil;
import com.checkba.model.entity.CloudConnection;
import com.checkba.repository.CloudConnectionRepository;
import com.checkba.service.LangText;
import com.checkba.service.account.AccountIdentitySync;
import com.checkba.service.account.AccountService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.Map;

/**
 * 官方团队案件库的零配置直连（dev-board#439）。
 *
 * <p>用官网账号登录桌面端之后，律师不该再被要求「填服务器地址、填账号、填密码」——
 * 那三样他一样也不知道。本类把这一步做掉：地址由 {@link OfficialCloudEndpoint} 派生，
 * 身份用本机已有的 {@code awdk_} 账户 Key 去官方案件库换一枚长期设备令牌
 * （{@code POST {base}/api/auth/awdk-login}），换回来的结果就是一条普通的
 * {@link CloudConnection}——**往后所有协作动作与手工连接的那条路完全同形**，
 * 共享/上传/更新/裁决一行都不用改。
 *
 * <p>形状照 {@code MobileRelayClientService} 的既有先例（同一条 awdk 桥、同一套
 * 账户指纹机制）：指纹没变就复用已有令牌，换了官网账户就地重桥。
 *
 * <p>刻意**不**并进 {@link CloudSyncService}：那个类只认识 Git 与云端同步语义，
 * 把「官网账户」这层身份塞进去会让它同时依赖账户体系；而且它的构造器被四个
 * 测试类手工 new，加参数是纯 churn。
 */
@Service
public class OfficialCloudService {

    private static final Logger log = LoggerFactory.getLogger(OfficialCloudService.class);

    private final String configuredBaseUrl;
    private final String accountBaseUrl;
    private com.checkba.service.site.SiteProfileService siteProfileService;
    private final AccountService accountService;
    private final CloudConnectionRepository connectionRepository;
    private final CloudSyncService cloudSyncService;

    public OfficialCloudService(
            @Value("${cloud.collab.base-url:}") String configuredBaseUrl,
            @Value("${ai.account.base-url:https://www.aiworkdeck.com}") String accountBaseUrl,
            AccountService accountService,
            CloudConnectionRepository connectionRepository,
            CloudSyncService cloudSyncService) {
        // 配错地址（明文 http）在启动期就炸掉，不静默降级——同 AwdkLoginService 的做法
        OfficialCloudEndpoint.resolve(configuredBaseUrl, accountBaseUrl);
        this.configuredBaseUrl = configuredBaseUrl;
        this.accountBaseUrl = accountBaseUrl;
        this.accountService = accountService;
        this.connectionRepository = connectionRepository;
        this.cloudSyncService = cloudSyncService;
    }

    @org.springframework.beans.factory.annotation.Autowired
    public OfficialCloudService(
            @Value("${cloud.collab.base-url:}") String configuredBaseUrl,
            @Value("${ai.account.base-url:https://www.aiworkdeck.com}") String accountBaseUrl,
            AccountService accountService, CloudConnectionRepository connectionRepository,
            CloudSyncService cloudSyncService, com.checkba.service.site.SiteProfileService siteProfileService) {
        this(configuredBaseUrl, accountBaseUrl, accountService, connectionRepository, cloudSyncService);
        this.siteProfileService = siteProfileService;
    }

    /** 官方案件库地址；null = 本站暂不提供（国际站）。 */
    public String officialBaseUrl() {
        return OfficialCloudEndpoint.resolve(configuredBaseUrl, siteProfileService == null ? accountBaseUrl : siteProfileService.baseUrl());
    }

    public boolean available() {
        return officialBaseUrl() != null;
    }

    /**
     * 界面用的一行状态：{@code {available, connected, serverUrl, username}}。
     * 与 {@code CloudController.connectionListItem} 同一条纪律——**绝不带 deviceToken**。
     */
    public Map<String, Object> status(Long userId) {
        Map<String, Object> m = new HashMap<>();
        m.put("available", available());
        m.put("serverUrl", officialBaseUrl());
        CloudConnection conn = existingOfficial(userId);
        m.put("connected", conn != null);
        m.put("username", conn == null ? null : conn.getUsername());
        return m;
    }

    /**
     * 连上官方案件库（幂等）：已有连接且账户没换过就直接复用；账户换了人就地重桥换令牌，
     * 不留下第二条连接（否则 CollabDialog 的案件库选择器会冒出一串同地址的死连接）。
     */
    public CloudConnection connectOfficial(Long userId) {
        return connect(userId, false);
    }

    /**
     * 律师在协作弹窗里明确点了「重新连接云端」：指纹没变也重桥一次换新令牌（教程第 11 集）。
     *
     * <p>默认的 {@link #connectOfficial} 指纹不变就复用旧连接——旧令牌已被云端撤掉时
     * （0.78 之前改名会换令牌），按钮点了等于没点。这里就地重桥：同一行（已入库案卷的
     * {@code ProjectRemote} 都挂在它上面）、新令牌，旧的那枚尽力撤掉，再把这条连接下已入库
     * 案卷的写门禁换到新令牌上（awdCloudScope 指纹含令牌，不换就全卡在「请明确重新连接」）。
     * <b>只许律师的明确动作调用</b>——IM/工作流/后台一律走 {@link #connectOfficial}。
     */
    public CloudConnection reconnectOfficial(Long userId) {
        return connect(userId, true);
    }

    private CloudConnection connect(Long userId, boolean reconnect) {
        AccountService.ConnectionSnapshot snapshot = accountService.connectionSnapshot();
        String base = OfficialCloudEndpoint.resolve(configuredBaseUrl, snapshot.baseUrl());
        if (userId == null) {
            throw new VersionException("connectOfficial 缺少本机用户 id");
        }
        String fingerprint = snapshot.fingerprint();
        CloudConnection existing = connectionRepository.findFirstByUserIdAndServerUrl(userId, base).orElse(null);
        boolean sameAccount = existing != null && fingerprint != null
                && fingerprint.equals(existing.getAccountFingerprint());
        if (!reconnect && sameAccount) {
            return existing;
        }
        String key = snapshot.key();
        if (key == null) {
            // 文案不含「登录」「未授权」「请先」——那三个词会被读成掉线（licensing 地雷 1）。
            // 抛 AccountException(NOT_CONNECTED, reason=team)：全局处理器回 4011，
            // 前端就地弹登录层、登录后由调用方重试（登录后置，dev-board#1046）
            throw com.checkba.service.account.AccountRequired.exception(
                    com.checkba.service.account.AccountRequired.REASON_TEAM, LangText.of(
                    "这台电脑还没连上 AI WorkDeck 账户，连好账户就能用官方团队案件库了",
                    "This computer is not linked to an AI WorkDeck account yet — link one to use the official Team Case Library"));
        }
        String oldToken = existing == null ? null : existing.getDeviceToken();
        Long oldTokenId = existing == null ? null : existing.getTokenId();
        CloudConnection conn = bridge(base, userId, key, fingerprint, existing, snapshot);
        // 只在同一个账户上换令牌时才跟着换门禁：本机换了人，上一个人的案卷门禁照拦（地雷 #58）
        if (reconnect && sameAccount && oldToken != null && !oldToken.equals(conn.getDeviceToken())) {
            cloudSyncService.revokeRemoteToken(base, oldTokenId, oldToken);
            try {
                cloudSyncService.refenceConnectionProjects(conn.getId(), userId);
            } catch (RuntimeException e) {
                // 新令牌已落库；还换不过来的案卷由律师在弹窗里「重新绑定这份案卷」
                log.warn("重新连接后换写门禁未完成: user={} {}", userId, e.getMessage());
            }
        }
        return conn;
    }

    /**
     * 一键放进案件库：没指定案件库就自动连官方的再共享；指定了就照它来
     * （自建/多库场景，也是 CollabDialog 在连了多个库时必须指名的那条路）。
     *
     * <p>「先开启版本记录」的守卫留在 {@link CloudSyncService#shareToCloud} 里不动。
     */
    public Map<String, Object> shareProject(long projectId, Long userId, Long connectionId) {
        long target = connectionId != null ? connectionId : connectOfficial(userId).getId();
        return cloudSyncService.shareToCloud(projectId, target, userId);
    }

    /**
     * 本机展示名随官网刷新之后（{@link AccountIdentitySync} 的事件：连接账户、每次
     * {@code GET /api/account/status}、改昵称之后），把官方案件库那边的也跟上。
     */
    @EventListener
    @Async("taskExecutor")
    public void onDisplayNameSynced(AccountIdentitySync.DisplayNameSynced event) {
        refreshDisplayName(event.userId(), event.displayName());
    }

    /**
     * 官方连接上的展示名与官网不一致时就地重桥（v0.38.2 发版走查）。
     *
     * <p>案件库侧没有单独的「刷新我的展示名」端点，现成的入口就是桥接本身——
     * {@code awdk-login} 每次都按官网 /me 刷新服务端用户的展示名（PR#797）。
     * 而 {@link #connectOfficial} 在指纹不变时一直复用旧连接、从不重桥，于是改完昵称
     * 案件库参与人列表里自己还是旧名字，本机合并署名 {@code conn.displayName} 也是旧值。
     *
     * <p>重桥会签出一枚新令牌，但连接<b>继续用旧令牌</b>、新的那枚当场撤掉：令牌参与已入库
     * 案卷的写门禁指纹（{@link CloudGitEpochClient} 的 awdCloudScope），换了令牌，已放进案件库的
     * 案卷后台同步会全部卡在「请明确重新连接」，且没有重新绑定的入口（问题 126，dev-board#1713）。
     * 账户真的换了走 {@link #connectOfficial} 的指纹判断照旧换令牌，门禁照旧拦。
     * 桥接回来的名字若仍是旧的（旧版案件库不刷新展示名），本机连接照样记官网那份：
     * 合并署名以官网为准，也不会因为两边一直对不上而每次 status 都重桥一次。
     *
     * <p>尽力而为：没有官方连接、没有账户 Key、官网或案件库不可达，一律安静跳过。
     * {@code synchronized}：连发的两次事件并发重桥会多换出一枚没人撤的令牌。
     */
    synchronized void refreshDisplayName(Long userId, String displayName) {
        if (displayName == null || displayName.isBlank()) return;
        String name = displayName.trim();
        AccountService.ConnectionSnapshot snapshot;
        synchronized (accountService) {
            if (!name.equals(accountService.currentDisplayNameOrNull())) return;
            snapshot = accountService.connectionSnapshot();
        }
        String base = OfficialCloudEndpoint.resolve(configuredBaseUrl, snapshot.baseUrl());
        CloudConnection existing = connectionRepository.findFirstByUserIdAndServerUrl(userId, base).orElse(null);
        if (existing == null || name.equals(existing.getDisplayName())) return;
        String key = snapshot.key();
        if (key == null) return;
        try {
            JSONObject data = requestBridge(existing.getServerUrl(), key);
            try {
                synchronized (accountService) {
                    if (!accountService.isCurrentConnection(snapshot)) return;
                    // 桥接在途时「重新连接云端」可能已把新令牌落库：重读再改名，不拿旧副本整行写回旧令牌
                    CloudConnection current = connectionRepository.findById(existing.getId()).orElse(null);
                    if (current == null) return;
                    current.setDisplayName(name);
                    connectionRepository.save(current);
                }
            } finally {
                cloudSyncService.revokeRemoteToken(base, data.getLong("tokenId", null), data.getStr("token"));
            }
        } catch (RuntimeException e) {
            log.warn("官方案件库展示名刷新跳过（下次同步再试）: user={} {}", userId, e.getMessage());
        }
    }

    // ==================== 内部 ====================

    private CloudConnection existingOfficial(Long userId) {
        String officialBaseUrl = officialBaseUrl();
        if (officialBaseUrl == null || userId == null) return null;
        return connectionRepository.findFirstByUserIdAndServerUrl(userId, officialBaseUrl).orElse(null);
    }

    private CloudConnection bridge(String base, Long userId, String key,
                                   String fingerprint, CloudConnection existing, AccountService.ConnectionSnapshot snapshot) {
        JSONObject data = requestBridge(base, key);
        synchronized (accountService) {
            if (!accountService.isCurrentConnection(snapshot)) throw VersionException.userFacing(LangText.of(
                    "账户已变化，请重试", "Account changed; please try again"));
            CloudConnection conn = existing != null ? existing : new CloudConnection();
            conn.setUserId(userId);
            conn.setServerUrl(base);
            conn.setUsername(data.getStr("username"));
            conn.setDisplayName(data.getStr("displayName"));
            conn.setDeviceToken(data.getStr("token"));
            conn.setTokenId(data.getLong("tokenId", null));
            // 案件库那一侧的 userId：协作事件行判「这条是不是我干的」只能靠它
            conn.setRemoteUserId(data.getLong("userId", null));
            conn.setAccountFingerprint(fingerprint);
            if (conn.getCreatedAt() == null) {
                conn.setCreatedAt(LocalDateTime.now());
            }
            log.info("已连上官方团队案件库: {} user={} as {}", base, userId, conn.getUsername());
            return connectionRepository.save(conn);
        }
    }

    /** 调 awdk-login 桥接，回 data（token/tokenId/username/displayName/userId）；不落库。 */
    private JSONObject requestBridge(String base, String key) {
        Map<String, String> bridgeBody = new java.util.LinkedHashMap<>();
        bridgeBody.put("key", key);
        // 设备名让协作事件行分得清「你在另一台电脑」是哪一台。取不到主机名就不传
        // （案件库侧回落成「账户桥接」），绝不让一个可有可无的标签挡住桥接本身。
        String deviceName = localHostName();
        if (deviceName != null) bridgeBody.put("deviceName", deviceName);
        JSONObject resp = JSONUtil.parseObj(
                httpPost(base + "/api/auth/awdk-login", JSONUtil.toJsonStr(bridgeBody)));
        if (resp.getInt("code", 1) != 0) {
            throw VersionException.userFacing(LangText.of(
                    "没能连上官方团队案件库：" + resp.getStr("message", "稍后再试一次"),
                    "Couldn't reach the official Team Case Library: " + resp.getStr("message", "please try again later")));
        }
        return resp.getJSONObject("data");
    }

    /** 本机主机名，取不到回 null（无网/无 DNS 的机器上 getLocalHost 会抛）。 */
    private static String localHostName() {
        try {
            String name = java.net.InetAddress.getLocalHost().getHostName();
            return name == null || name.isBlank() ? null : name.trim();
        } catch (Exception e) {
            return null;
        }
    }

    /** 单测覆写此 seam 打桩，形制同 CloudSyncService.httpPost。 */
    protected String httpPost(String url, String jsonBody) {
        HttpRequest req = HttpRequest.post(url)
                .header("Content-Type", "application/json")
                .body(jsonBody)
                .setConnectionTimeout(5000)
                .setReadTimeout(15000);
        try (HttpResponse resp = req.execute()) {
            if (resp.getStatus() != 200) {
                throw new IllegalStateException("官方案件库请求失败 (HTTP " + resp.getStatus() + ")");
            }
            return resp.body();
        } catch (IllegalStateException e) {
            throw e;
        } catch (Exception e) {
            throw new IllegalStateException("官方案件库不可达: " + e.getMessage(), e);
        }
    }
}
