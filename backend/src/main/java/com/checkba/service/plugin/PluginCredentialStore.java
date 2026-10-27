// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.plugin;

import com.checkba.service.SystemSettingService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.LinkOption;
import java.nio.file.attribute.PosixFilePermissions;
import java.security.SecureRandom;
import java.util.Base64;

/** User/connection scoped encrypted credentials. The wrapping key never enters the settings database. */
@Service
public class PluginCredentialStore {
    private final SystemSettingService settings;
    private final Path keyPath;
    private final SecureRandom random = new SecureRandom();

    public PluginCredentialStore(SystemSettingService settings,
            @Value("${ai.plugins.credential-key-file:${user.home}/.aiworkdeck/plugin-credentials.key}") String keyPath) {
        this.settings = settings;
        this.keyPath = Path.of(keyPath);
    }

    public void put(String scope, String value) {
        try {
            byte[] nonce = new byte[12];
            random.nextBytes(nonce);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key(), "AES"), new GCMParameterSpec(128, nonce));
            cipher.updateAAD(scope.getBytes(StandardCharsets.UTF_8));
            byte[] ciphertext = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
            settings.set("plugin.credentials." + scope, Base64.getEncoder().encodeToString(nonce)
                    + "." + Base64.getEncoder().encodeToString(ciphertext));
        } catch (Exception e) {
            throw new IllegalStateException("Unable to save plugin credential", e);
        }
    }

    public String get(String scope) {
        String value = settings.get("plugin.credentials." + scope, "");
        if (value.isEmpty()) return "";
        try {
            String[] parts = value.split("\\.", 2);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(key(), "AES"),
                    new GCMParameterSpec(128, Base64.getDecoder().decode(parts[0])));
            cipher.updateAAD(scope.getBytes(StandardCharsets.UTF_8));
            return new String(cipher.doFinal(Base64.getDecoder().decode(parts[1])), StandardCharsets.UTF_8);
        } catch (Exception e) {
            throw new IllegalStateException("Plugin credential unavailable; reconnect this service", e);
        }
    }

    public void remove(String scope) { settings.set("plugin.credentials." + scope, ""); }

    private synchronized byte[] key() throws Exception {
        if (Files.isSymbolicLink(keyPath)) throw new IllegalStateException("Credential key cannot be a symbolic link");
        if (!Files.exists(keyPath, LinkOption.NOFOLLOW_LINKS)) {
            Files.createDirectories(keyPath.getParent());
            byte[] generated = new byte[32];
            random.nextBytes(generated);
            try {
                Files.createFile(keyPath, PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------")));
            } catch (UnsupportedOperationException e) {
                Files.createFile(keyPath);
                if (!keyPath.toFile().setReadable(false, false) || !keyPath.toFile().setReadable(true, true)
                        || !keyPath.toFile().setWritable(false, false) || !keyPath.toFile().setWritable(true, true)) {
                    throw new IllegalStateException("Cannot restrict credential key permissions");
                }
            }
            Files.write(keyPath, generated);
        }
        byte[] key = Files.readAllBytes(keyPath);
        if (key.length != 32) throw new IllegalStateException("Invalid credential key");
        return key;
    }
}
