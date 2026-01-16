package com.checkba.config;

import jakarta.servlet.*;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.Ordered;

import java.io.IOException;

/**
 * 全局 CORS 配置
 * 解决跨域问题（支持 cpolar 内网穿透等场景）
 * 
 * 使用自定义过滤器处理所有 CORS 请求，设置最高优先级确保在其他过滤器之前执行
 */
@Configuration
public class CorsConfig {

    /**
     * 自定义 CORS 过滤器，确保 OPTIONS 预检请求能正确响应
     * 设置最高优先级，在所有其他过滤器之前执行
     */
    @Bean
    public FilterRegistrationBean<Filter> corsFilterRegistration() {
        FilterRegistrationBean<Filter> bean = new FilterRegistrationBean<>();
        bean.setFilter(new CorsPreflightFilter());
        bean.addUrlPatterns("/*");
        bean.setOrder(Ordered.HIGHEST_PRECEDENCE);
        bean.setName("corsPreflightFilter");
        return bean;
    }

    /**
     * 自定义过滤器：处理所有 CORS 请求，特别是 OPTIONS 预检请求
     */
    public static class CorsPreflightFilter implements Filter {
        
        @Override
        public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain)
                throws IOException, ServletException {
            HttpServletResponse response = (HttpServletResponse) res;
            HttpServletRequest request = (HttpServletRequest) req;
            
            // 获取请求来源
            String origin = request.getHeader("Origin");
            
            // 设置 CORS 响应头
            if (origin != null && !origin.isEmpty()) {
                // 有 Origin 头时，使用具体的 origin（支持 credentials）
                response.setHeader("Access-Control-Allow-Origin", origin);
                response.setHeader("Access-Control-Allow-Credentials", "true");
            } else {
                // 没有 Origin 头时（如直接 curl 访问），允许所有来源但不支持 credentials
                response.setHeader("Access-Control-Allow-Origin", "*");
                // 注意：当 Allow-Origin 为 * 时，不能设置 Allow-Credentials 为 true
            }
            
            response.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, PATCH, HEAD");
            response.setHeader("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization, X-Session-Id, Cache-Control, Pragma, X-File-Offset, X-File-Total-Size");
            response.setHeader("Access-Control-Max-Age", "3600");
            response.setHeader("Access-Control-Expose-Headers", "Content-Disposition, X-Suggested-Filename");
            
            // 对于 OPTIONS 预检请求，直接返回 200，不继续处理
            if ("OPTIONS".equalsIgnoreCase(request.getMethod())) {
                response.setStatus(HttpServletResponse.SC_OK);
                return;
            }
            
            chain.doFilter(req, res);
        }
        
        @Override
        public void init(FilterConfig filterConfig) {}
        
        @Override
        public void destroy() {}
    }
}
