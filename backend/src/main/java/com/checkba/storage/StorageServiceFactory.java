package com.checkba.storage;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Primary;
import org.springframework.stereotype.Component;

/**
 * 存储服务工厂
 * 根据配置自动选择使用本地存储或对象存储
 */
@Slf4j
@Component
@Primary
public class StorageServiceFactory {

    @Autowired
    private StorageProperties storageProperties;

    @Autowired
    private LocalFileStorageService localFileStorageService;

    @Autowired
    private OssStorageService ossStorageService;

    /**
     * 获取存储服务实例
     */
    public StorageService getStorageService() {
        String type = storageProperties.getType();
        
        log.info("获取存储服务，类型: {}", type);
        
        switch (type.toLowerCase()) {
            case "local":
                return localFileStorageService;
            case "oss":
            case "s3":
            case "object":
                return ossStorageService;
            default:
                log.warn("未知的存储类型: {}, 使用默认本地存储", type);
                return localFileStorageService;
        }
    }
}

