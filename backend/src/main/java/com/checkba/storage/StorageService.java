package com.checkba.storage;

import org.springframework.core.io.Resource;

import java.io.InputStream;

/**
 * 文件存储服务接口
 * 
 * 统一抽象文件存储操作，支持本地文件系统和对象存储（OSS/S3等）
 * 实现类需要处理：
 * - 文件上传/保存
 * - 文件下载/读取
 * - 文件删除
 * - 文件是否存在检查
 */
public interface StorageService {

    /**
     * 保存文件
     * 
     * @param fileId 文件ID（用于生成存储路径）
     * @param inputStream 文件输入流
     * @return 存储路径（用于数据库记录）
     * @throws StorageException 存储异常
     */
    String save(String fileId, InputStream inputStream) throws StorageException;

    /**
     * 读取文件
     * 
     * @param fileId 文件ID
     * @return 文件资源
     * @throws StorageException 存储异常
     */
    Resource load(String fileId) throws StorageException;

    /**
     * 删除文件
     * 
     * @param fileId 文件ID
     * @throws StorageException 存储异常
     */
    void delete(String fileId) throws StorageException;

    /**
     * 检查文件是否存在
     * 
     * @param fileId 文件ID
     * @return 是否存在
     */
    boolean exists(String fileId);

    /**
     * 获取文件的访问URL（用于对象存储的预签名URL或直接访问URL）
     * 
     * @param fileId 文件ID
     * @return 访问URL，如果不需要URL则返回null
     */
    String getUrl(String fileId);
}

