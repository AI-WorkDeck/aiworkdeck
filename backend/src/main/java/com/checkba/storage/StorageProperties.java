package com.checkba.storage;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * 存储服务配置属性
 */
@Data
@Component
@ConfigurationProperties(prefix = "storage")
public class StorageProperties {

    /**
     * 存储类型：local（本地文件系统）或 oss（对象存储）
     */
    private String type = "local";

    /**
     * 本地存储配置
     */
    private Local local = new Local();

    /**
     * 对象存储配置
     */
    private Oss oss = new Oss();

    @Data
    public static class Local {
        /**
         * 本地存储根目录（相对于项目根目录或绝对路径）
         * 默认：data/wps-files
         */
        private String rootPath = "data/wps-files";

        /**
         * 模板文件路径（用于新建文档的初始内容）
         * 默认：docs/template.docx
         */
        private String templatePath = "docs/template.docx";
    }

    @Data
    public static class Oss {
        /**
         * 对象存储类型：aliyun（阿里云OSS）、aws（AWS S3）、minio（MinIO）
         */
        private String provider = "aliyun";

        /**
         * 访问密钥ID
         */
        private String accessKeyId;

        /**
         * 访问密钥Secret
         */
        private String accessKeySecret;

        /**
         * 存储桶名称（Bucket）
         */
        private String bucketName;

        /**
         * 存储桶所在区域（Region）
         * 例如：oss-cn-hangzhou（阿里云）、us-east-1（AWS）
         */
        private String region;

        /**
         * 自定义端点（Endpoint），用于MinIO或私有部署的对象存储
         * 如果为空，则使用默认端点
         */
        private String endpoint;

        /**
         * 文件存储路径前缀（可选）
         * 例如：wps-files/ 或 project-files/
         */
        private String pathPrefix = "";

        /**
         * 是否使用HTTPS
         */
        private boolean useHttps = true;

        /**
         * CDN域名（可选，用于加速访问）
         * 如果配置了CDN，文件访问URL将使用CDN域名
         */
        private String cdnDomain;
    }
}

