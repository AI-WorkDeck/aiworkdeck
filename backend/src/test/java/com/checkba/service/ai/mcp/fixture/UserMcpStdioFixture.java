// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai.mcp.fixture;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;

/** A synthetic child process only; never loads real MCP packages or user credentials. */
public final class UserMcpStdioFixture {
    private static final ObjectMapper JSON = new ObjectMapper();
    public static final Map<String, Object> SCHEMA = Map.of("type", "object", "properties", Map.of("query", Map.of("type", "string")),
            "required", List.of("query"), "additionalProperties", false);
    private UserMcpStdioFixture() {}
    public static void main(String[] args) throws Exception {
        String mode = args[0];
        Path trace = Path.of(args[1]);
        Files.writeString(Path.of(trace + ".pid"), Long.toString(ProcessHandle.current().pid()));
        if (mode.equals("child")) { Thread.sleep(60000); return; }
        if (mode.equals("tree")) {
            Process child = new ProcessBuilder(Path.of(System.getProperty("java.home"), "bin", System.getProperty("os.name").startsWith("Windows") ? "java.exe" : "java").toString(), "-cp",
                    System.getProperty("java.class.path"), UserMcpStdioFixture.class.getName(), "child", trace + ".child").start();
            Files.writeString(Path.of(trace + ".child.pid"), Long.toString(child.pid()));
            Thread.sleep(60000); return;
        }
        if (mode.equals("stdout-log")) { System.out.println("secret stdout log"); Thread.sleep(60000); return; }
        if (mode.equals("oversize")) { System.out.print("x".repeat(2 * 1024 * 1024 + 1)); System.out.flush(); Thread.sleep(60000); return; }
        if (mode.equals("bad-utf8")) { System.out.write(new byte[]{(byte) 0xc3, 0x28, 0x0a}); System.out.flush(); Thread.sleep(60000); return; }
        if (mode.equals("exit")) return;
        if (mode.equals("stderr")) { System.err.print("synthetic-secret-do-not-return".repeat(10000)); System.err.flush(); }
        try (BufferedReader input = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8))) {
            String line;
            while ((line = input.readLine()) != null) {
                JsonNode request = JSON.readTree(line);
                if (!request.has("method")) { Files.writeString(trace, "server-response\n", StandardOpenOption.CREATE, StandardOpenOption.APPEND); continue; }
                String method = request.path("method").asText();
                Files.writeString(trace, method + "\n", StandardOpenOption.CREATE, StandardOpenOption.APPEND);
                Object result;
                if (method.equals("notifications/initialized")) continue;
                if (method.equals("initialize")) {
                    if (mode.equals("remote-error")) { emit(Map.of("jsonrpc", "2.0", "id", request.get("id"), "error", Map.of("code", -32603, "message", "synthetic-secret-do-not-return"))); continue; }
                    result = Map.of("protocolVersion", mode.equals("bad-version") ? "2099-01-01" : "2025-11-25", "capabilities", Map.of("tools", Map.of()), "serverInfo", Map.of("name", "synthetic", "version", "1"));
                } else if (method.equals("tools/list")) {
                    if (mode.equals("notification")) {
                        emit(Map.of("jsonrpc", "2.0", "method", "notifications/tools/list_changed"));
                        emit(Map.of("jsonrpc", "2.0", "id", "server-ping", "method", "ping"));
                    }
                    Object schema = mode.equals("schema-drift") ? Map.of("type", "object") : SCHEMA;
                    boolean first = !request.path("params").has("cursor");
                    if (mode.equals("pagination") || mode.equals("repeated-cursor")) {
                        result = first || mode.equals("repeated-cursor")
                                ? Map.of("tools", List.of(Map.of("name", first ? "first" : "second", "inputSchema", SCHEMA)), "nextCursor", "next")
                                : Map.of("tools", List.of(Map.of("name", "echo", "inputSchema", schema)));
                    } else result = Map.of("tools", List.of(Map.of("name", "echo", "inputSchema", schema)));
                } else if (method.equals("tools/call")) {
                    if (mode.equals("slow")) { Thread.sleep(60000); return; }
                    if (mode.equals("exit-call")) return;
                    Map<String, Object> payload = new LinkedHashMap<>();
                    payload.put("query", request.path("params").path("arguments").path("query").asText());
                    payload.put("env", System.getenv()); payload.put("cwd", Path.of("").toAbsolutePath().toString());
                    payload.put("argv", Arrays.asList(args).subList(2, args.length));
                    result = Map.of("content", List.of(Map.of("type", "text", "text", JSON.writeValueAsString(payload))), "isError", mode.equals("tool-error"));
                } else throw new IllegalStateException("Unexpected synthetic method");
                emit(Map.of("jsonrpc", "2.0", "id", request.get("id"), "result", result));
                if (method.equals("tools/list") && mode.equals("no-read-call")) Thread.sleep(60000);
            }
        }
    }
    private static void emit(Object value) throws Exception {
        System.out.write(JSON.writeValueAsBytes(value));
        System.out.write('\n');
        System.out.flush();
    }
}
