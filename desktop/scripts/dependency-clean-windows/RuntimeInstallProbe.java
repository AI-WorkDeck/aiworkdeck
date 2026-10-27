// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import com.checkba.service.pack.NativePackService;
import com.checkba.service.pack.PackProperties;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Compile against installed app.jar/lib with CI javac; run with the installed application JRE. */
public class RuntimeInstallProbe {
    public static void main(String[] args) throws Exception {
        Path root = Path.of(args[0]);
        var props = new PackProperties();
        props.setDir(root.resolve("packs").toString());
        props.setAutoUpgrade(false);
        var service = new NativePackService(props, Files.readString(Path.of(args[1])), args[2]);
        var result = new LinkedHashMap<String, Object>();
        result.put("javaHome", System.getProperty("java.home"));
        result.put("platform", System.getProperty("os.name") + " " + System.getProperty("os.arch"));
        result.put("sources", props.getBaseUrls());
        var packs = new ArrayList<Map<String, Object>>();
        result.put("packs", packs);
        try {
            for (String id : List.of("asr-runtime", "kokoro-runtime")) {
                if (service.isReady(id)) throw new AssertionError("Probe requires a fresh pack directory: " + id);
                String version = service.install(id);
                if (!service.isReady(id)) throw new AssertionError("Installed pack not ready: " + id);
                var evidence = new LinkedHashMap<String, Object>();
                evidence.put("id", id);
                evidence.put("version", version);
                evidence.put("state", service.status(id).getState());
                evidence.put("current", Files.readString(root.resolve("packs/" + id + "/current.json")));
                for (String component : List.of("lib", "app")) {
                    Path dir = service.componentDir(id, component).orElseThrow();
                    byte[] hashes = Files.readAllBytes(dir.resolve("contents.sha256"));
                    evidence.put(component, dir.toString());
                    evidence.put(component + "ContentsSha256", HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(hashes)));
                }
                packs.add(evidence);
            }
            result.put("passed", true);
        } catch (Throwable failure) {
            result.put("passed", false);
            result.put("error", failure.toString());
            throw failure;
        } finally {
            service.shutdown();
            new ObjectMapper().writerWithDefaultPrettyPrinter().writeValue(root.resolve("runtime-install.json").toFile(), result);
        }
    }
}
