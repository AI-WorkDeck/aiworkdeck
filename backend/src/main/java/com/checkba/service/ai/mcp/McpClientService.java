package com.checkba.service.ai.mcp;

import cn.hutool.json.JSONObject;
import cn.hutool.json.JSONUtil;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.beans.factory.annotation.Value;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * MCP Client Service for managing connections to MCP servers.
 * Implements "streamableHttp" (JSON-RPC over HTTP POST) manually
 * as the SDK's SSE transport is not compatible with PKULaw's current endpoint.
 */
@Service
public class McpClientService {
    private static final Logger log = LoggerFactory.getLogger(McpClientService.class);


    @Autowired
    private SystemSettingService systemSettingService;

    // PKULaw Token
    @Value("${external.pkulaw.token:}")
    private String defaultPkulawToken;
    
    // PKULaw MCP Server URLs
    private static final Map<String, String> SERVER_URLS = Map.of(
        "pkulaw-semantic", "https://apim-gateway.pkulaw.com/mcp-law-search-service",
        "pkulaw-keyword", "https://apim-gateway.pkulaw.com/mcp-law", 
        "pkulaw-recognition", "https://apim-gateway.pkulaw.com/law_recognition"
    );
    
    // Connection timeout
    private static final Duration REQUEST_TIMEOUT = Duration.ofSeconds(60);
    
    private final HttpClient httpClient;

    public McpClientService() {
        this.httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .build();
    }

    /**
     * Call a tool on the specified MCP server using JSON-RPC over HTTP.
     *
     * @param serverName The name of the server (e.g., "pkulaw-semantic")
     * @param toolName   The name of the tool to call
     * @param args       The arguments to pass to the tool
     * @return The result as a string
     */
    public String callTool(String serverName, String toolName, Map<String, Object> args) {
        log.info("MCP callTool: server={}, tool={}, args={}", serverName, toolName, args);
        
        String url = SERVER_URLS.get(serverName);
        if (url == null) {
            return "Error: Unknown MCP server: " + serverName;
        }

        try {
            JSONObject params = new JSONObject();
            params.set("name", toolName);
            params.set("arguments", args);
            
            JSONObject requestBody = new JSONObject();
            requestBody.set("jsonrpc", "2.0");
            requestBody.set("method", "tools/call");
            requestBody.set("params", params);
            requestBody.set("id", UUID.randomUUID().toString());
            
            String jsonPayload = requestBody.toString();
            log.debug("MCP Payload: {}", jsonPayload);

            String pkulawToken = systemSettingService.get("external.pkulaw.token", defaultPkulawToken);



            HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(url))
                .header("Content-Type", "application/json")
                .header("Authorization", "Bearer " + pkulawToken)
                .header("Accept", "application/json, text/event-stream")
                .POST(HttpRequest.BodyPublishers.ofString(jsonPayload))
                .timeout(REQUEST_TIMEOUT)
                .build();

            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            String responseBody = response.body();
            
            // Log RAW response for debugging - Critical for diagnosing format mismatches
            if (response.statusCode() >= 200 && response.statusCode() < 300) {
                log.info("MCP Raw Response (Success): {}", responseBody);
            } else {
                log.error("MCP Raw Response (Error {}): {}", response.statusCode(), responseBody);
                return "Error calling MCP server (" + response.statusCode() + "): " + responseBody;
            }

            // --- Robust Parsing Logic ---
            String trimmedResponse = responseBody.trim();
            
            // Case 1: SSE / StreamableHTTP (starts with "data:")
            if (trimmedResponse.startsWith("data:")) {
                log.debug("Detected SSE response format");
                StringBuilder fullContent = new StringBuilder();
                String[] lines = responseBody.split("\n");
                for (String line : lines) {
                    line = line.trim();
                    if (line.startsWith("data:")) {
                        String dataContent = line.substring(5).trim();
                        if (!dataContent.isEmpty() && !"[DONE]".equals(dataContent)) {
                            // Recursively parse the JSON content of the data line if needed, 
                            // but usually we just want to extract the meaningful content.
                            // For flexibility, let's treat the accumulated data parts as the result.
                            fullContent.append(dataContent);
                        }
                    }
                }
                // Try to parse the accumulated content as JSON if possible, otherwise return string
                String accumulated = fullContent.toString();
                if (accumulated.startsWith("{") || accumulated.startsWith("[")) {
                     // Recurse or fall through to JSON parsing with the extracted content
                     trimmedResponse = accumulated;
                } else {
                    return accumulated;
                }
            }

            // Case 2: JSON Array [...]
            if (trimmedResponse.startsWith("[")) {
                log.debug("Detected JSON Array response format");
                cn.hutool.json.JSONArray jsonArray = JSONUtil.parseArray(trimmedResponse);
                return jsonArray.toStringPretty();
            }

            // Case 3: JSON Object {...}
            if (trimmedResponse.startsWith("{")) {
                log.debug("Detected JSON Object response format");
                JSONObject jsonResponse = JSONUtil.parseObj(trimmedResponse);

                // Sub-case 3a: Standard Direct API Response (code/data or message)
                // E.g. { "code": "ok", "data": [...] }
                if (jsonResponse.containsKey("code") && "ok".equalsIgnoreCase(jsonResponse.getStr("code"))) {
                    if (jsonResponse.containsKey("data")) {
                        Object data = jsonResponse.get("data");
                        return (data instanceof cn.hutool.json.JSON) ? 
                               ((cn.hutool.json.JSON) data).toStringPretty() : data.toString();
                    }
                }

                // Sub-case 3b: Standard MCP JSON-RPC Response (result/content)
                if (jsonResponse.containsKey("result")) {
                    JSONObject result = jsonResponse.getJSONObject("result");
                    if (result.containsKey("content")) {
                        cn.hutool.json.JSONArray content = result.getJSONArray("content");
                        StringBuilder sb = new StringBuilder();
                        for (Object item : content) {
                            if (item instanceof JSONObject) {
                                JSONObject itemJson = (JSONObject) item;
                                if ("text".equals(itemJson.getStr("type"))) {
                                    sb.append(itemJson.getStr("text"));
                                }
                            }
                        }
                        return sb.toString();
                    }
                    return result.toString();
                }

                // Sub-case 3c: Error response
                if (jsonResponse.containsKey("error")) {
                    return "Error from MCP server: " + jsonResponse.get("error");
                }
                
                // Fallback: Just return the whole object pretty printed
                return jsonResponse.toStringPretty();
            }

            // Case 4: Unknown format
            log.warn("Unknown response format: {}", trimmedResponse);
            return trimmedResponse;

        } catch (Exception e) {
            log.error("MCP tool call failed: server={}, tool={}, error={}", serverName, toolName, e.getMessage(), e);
            return "Error calling MCP tool: " + e.getMessage();
        }
    }
}
