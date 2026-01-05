package com.checkba.controller.ai;

import com.checkba.service.ai.WpsActionService;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.web.bind.annotation.*;

/**
 * WPS 操作结果接收控制器
 * 
 * 接收前端执行 WPS 操作后的结果回调
 */
@RestController
@RequestMapping("/api/ai/agent")
@CrossOrigin(origins = "*")
@RequiredArgsConstructor
@Slf4j
public class WpsResultController {

    private final WpsActionService wpsActionService;

    /**
     * 接收 WPS 操作结果
     * 
     * 前端执行完 WPS 操作后，调用此接口返回结果
     */
    @PostMapping("/wps-result")
    public WpsResultResponse receiveWpsResult(@RequestBody WpsResultPayload payload) {
        log.info("Received WPS result: requestId={}, success={}", payload.getRequestId(), payload.isSuccess());
        
        try {
            wpsActionService.completeWpsAction(
                    payload.getRequestId(),
                    payload.isSuccess(),
                    payload.getData(),
                    payload.getError()
            );
            
            return new WpsResultResponse(true, "Result received");
            
        } catch (Exception e) {
            log.error("Failed to process WPS result", e);
            return new WpsResultResponse(false, e.getMessage());
        }
    }

    /**
     * WPS 结果请求体
     */
    @Data
    public static class WpsResultPayload {
        /**
         * 请求 ID（与 SSE 发送的 requestId 对应）
         */
        private String requestId;
        
        /**
         * 会话 ID
         */
        private String conversationId;
        
        /**
         * 是否成功
         */
        private boolean success;
        
        /**
         * 结果数据（成功时）
         */
        private Object data;
        
        /**
         * 错误信息（失败时）
         */
        private String error;
    }

    /**
     * WPS 结果响应
     */
    @Data
    public static class WpsResultResponse {
        private final boolean received;
        private final String message;
    }
}

