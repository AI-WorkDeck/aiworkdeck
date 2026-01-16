package com.checkba.exception;

/**
 * 未授权异常
 * 用于用户未登录或登录过期的情况
 */
public class UnauthorizedException extends RuntimeException {

    public UnauthorizedException(String message) {
        super(message);
    }

    public UnauthorizedException() {
        super("请先登录");
    }
}
