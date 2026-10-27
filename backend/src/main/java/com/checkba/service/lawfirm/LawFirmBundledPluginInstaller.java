// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.lawfirm;

import com.checkba.service.LangText;
import com.checkba.service.ai.PluginService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.Map;

/**
 * 律所管理官方插件随包内置（dev-board#1282）。
 *
 * <p>插件是纯 Web（无 JAR），代码来自与宿主同一个 app.jar 的 {@code bundled-plugins/}，
 * 信任等级等同宿主前端本身，因此不走广场验签链路。落盘到 {@code ai.plugins.dir} 后由
 * {@link PluginService#rescan()} 正常登记，后续与广场插件一样可停用/卸载。
 *
 * <p>本机已存在同版本时不覆盖（保留用户的停用意愿与 .awd-dev 开发版本）。
 */
@Service
@Slf4j
public class LawFirmBundledPluginInstaller {

    public static final String PLUGIN_ID = "lawfirm-management";
    private static final String BUNDLE_ROOT = "bundled-plugins/" + PLUGIN_ID + "/";

    private final PluginService pluginService;
    private final String pluginsDir;

    public LawFirmBundledPluginInstaller(PluginService pluginService,
                                         @Value("${ai.plugins.dir:plugins}") String pluginsDir) {
        this.pluginService = pluginService;
        this.pluginsDir = pluginsDir;
    }

    /** @return {installed, updated, enabled, version} */
    public synchronized Map<String, Object> ensureInstalledAndEnabled() throws IOException {
        PathMatchingResourcePatternResolver resolver = new PathMatchingResourcePatternResolver();
        Resource manifest = resolver.getResource("classpath:" + BUNDLE_ROOT + "manifest.json");
        if (!manifest.exists()) {
            throw new IllegalStateException(LangText.of("当前版本未内置律所管理插件，请从插件中心安装", "Law Firm Management plugin is not bundled in this version; please install it from the Plugin Center"));
        }
        String bundledManifest;
        try (InputStream in = manifest.getInputStream()) {
            bundledManifest = new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
        String bundledVersion = cn.hutool.json.JSONUtil.parseObj(bundledManifest).getStr("version", "0.0.0");

        Path target = Path.of(pluginsDir).toAbsolutePath().normalize().resolve(PLUGIN_ID);
        boolean devInstall = Files.exists(target.resolve(".awd-dev"));
        String localVersion = null;
        if (Files.isRegularFile(target.resolve("manifest.json"))) {
            try {
                localVersion = cn.hutool.json.JSONUtil.parseObj(
                        Files.readString(target.resolve("manifest.json"), StandardCharsets.UTF_8)).getStr("version");
            } catch (Exception e) {
                localVersion = null;
            }
        }
        boolean needWrite = !devInstall && (localVersion == null
                || com.checkba.util.Semver.isSemver(bundledVersion) && com.checkba.util.Semver.isSemver(localVersion)
                   && com.checkba.util.Semver.compare(bundledVersion, localVersion) > 0);

        boolean installed = false;
        if (needWrite) {
            Files.createDirectories(target.getParent());
            Path staging = Files.createTempDirectory(target.getParent(), ".staging-" + PLUGIN_ID + "-");
            try {
                for (Resource r : resolver.getResources("classpath*:" + BUNDLE_ROOT + "**")) {
                    if (!r.isReadable()) continue;
                    String url = r.getURL().toString();
                    int idx = url.lastIndexOf(BUNDLE_ROOT);
                    if (idx < 0) continue;
                    String rel = url.substring(idx + BUNDLE_ROOT.length());
                    if (rel.isEmpty() || rel.endsWith("/") || rel.contains("..")) continue;
                    Path dest = staging.resolve(rel).normalize();
                    if (!dest.startsWith(staging)) continue;
                    Files.createDirectories(dest.getParent());
                    try (InputStream in = r.getInputStream()) {
                        Files.copy(in, dest, StandardCopyOption.REPLACE_EXISTING);
                    }
                }
                if (!Files.isRegularFile(staging.resolve("manifest.json"))
                        || !Files.isRegularFile(staging.resolve("web/index.html"))) {
                    throw new IllegalStateException(LangText.of("内置律所管理插件不完整，已中止安装", "Bundled Law Firm Management plugin is incomplete; installation aborted"));
                }
                if (Files.exists(target)) {
                    cn.hutool.core.io.FileUtil.del(target.toFile());
                }
                try {
                    Files.move(staging, target, StandardCopyOption.ATOMIC_MOVE);
                } catch (java.nio.file.AtomicMoveNotSupportedException e) {
                    Files.move(staging, target, StandardCopyOption.REPLACE_EXISTING);
                }
                installed = true;
            } finally {
                if (Files.exists(staging)) cn.hutool.core.io.FileUtil.del(staging.toFile());
            }
            pluginService.rescan();
        } else if (pluginService.getPlugin(PLUGIN_ID) == null) {
            pluginService.rescan();
        }

        if (pluginService.getPlugin(PLUGIN_ID) == null) {
            throw new IllegalStateException(LangText.of("律所管理插件登记失败，请查看日志", "Failed to register Law Firm Management plugin; please check the logs"));
        }
        String incompatible = pluginService.incompatibleReason(PLUGIN_ID);
        if (incompatible != null) throw new IllegalStateException(incompatible);
        if (!pluginService.isEnabled(PLUGIN_ID)) {
            pluginService.setEnabled(PLUGIN_ID, true);
        }
        log.info("Bundled plugin {} ensured (installed={}, version={})", PLUGIN_ID, installed, bundledVersion);
        return Map.of("installed", installed, "enabled", true, "version", bundledVersion, "pluginId", PLUGIN_ID);
    }
}
