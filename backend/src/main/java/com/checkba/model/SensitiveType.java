package com.checkba.model;

import lombok.Getter;

import java.util.regex.Pattern;

/**
 * Enum representing sensitive data types with their patterns and masking strategies
 */
@Getter
public enum SensitiveType {
    PHONE(
        "PHONE",
        "手机号",
        "1[3-9]\\d{9}",
        "138****1234",
        "保留前3后4位"
    ),
    
    ID_CARD(
        "ID_CARD",
        "身份证号",
        "\\d{15}|\\d{17}[0-9Xx]",
        "3301**********1234",
        "保留前6后4位"
    ),
    
    EMAIL(
        "EMAIL",
        "邮箱",
        "[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,6}",
        "a***@example.com",
        "保留首字母和域名"
    ),
    
    BANK_CARD(
        "BANK_CARD",
        "银行卡号",
        "\\d{16,19}",
        "6222******8888",
        "保留前6后4位"
    ),
    
    CHINESE_NAME(
        "CHINESE_NAME",
        "中文姓名",
        "[\\u4e00-\\u9fa5]{2,4}",
        "张**",
        "保留姓氏"
    ),
    
    FIXED_PHONE(
        "FIXED_PHONE",
        "固定电话",
        "0\\d{2,3}-?\\d{7,8}",
        "010-****5678",
        "保留区号和后4位"
    ),
    
    ADDRESS(
        "ADDRESS",
        "地址",
        "[\\u4e00-\\u9fa5]{2,4}省[\\u4e00-\\u9fa5]{2,6}市[\\u4e00-\\u9fa5]{2,10}(区|县)[\\u4e00-\\u9fa5\\d]{4,}",
        "浙江省杭州市**区****",
        "保留省市"
    ),
    
    PASSWORD(
        "PASSWORD",
        "密码",
        "(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)[a-zA-Z\\d@$!%*?&]{8,}",
        "******",
        "完全遮蔽"
    ),
    
    CAR_LICENSE(
        "CAR_LICENSE",
        "车牌号",
        "[京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼使领][A-Z][A-Z0-9]{5}",
        "浙A***23",
        "保留前2后2位"
    ),
    
    IPV4(
        "IPV4",
        "IPv4地址",
        "((25[0-5]|2[0-4]\\d|[01]?\\d\\d?)\\.){3}(25[0-5]|2[0-4]\\d|[01]?\\d\\d?)",
        "192.168.*.*",
        "保留前两段"
    ),
    
    IPV6(
        "IPV6",
        "IPv6地址",
        "(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4})",
        "2001:0db8:****:****:****:****:****:****",
        "保留前两段"
    );

    private final String code;
    private final String label;
    private final Pattern pattern;
    private final String example;
    private final String description;

    SensitiveType(String code, String label, String regex, String example, String description) {
        this.code = code;
        this.label = label;
        this.pattern = Pattern.compile(regex);
        this.example = example;
        this.description = description;
    }

    /**
     * Mask the original string based on the type's strategy
     */
    public String mask(String original) {
        if (original == null || original.isEmpty()) {
            return original;
        }
        
        int len = original.length();
        
        switch (this) {
            case PHONE:
                if (len == 11) return original.substring(0, 3) + "****" + original.substring(7);
                break;
                
            case ID_CARD:
                if (len > 10) return original.substring(0, 6) + "********" + original.substring(len - 4);
                break;
                
            case EMAIL:
                int atIndex = original.indexOf("@");
                if (atIndex > 1) return original.substring(0, 1) + "***" + original.substring(atIndex);
                break;
                
            case BANK_CARD:
                if (len > 10) return original.substring(0, 6) + "******" + original.substring(len - 4);
                break;
                
            case CHINESE_NAME:
                if (len == 2) return original.substring(0, 1) + "*";
                if (len > 2) return original.substring(0, 1) + "**" + original.substring(len - 1);
                break;
                
            case FIXED_PHONE:
                // Handle formats like 010-12345678 or 01012345678
                String cleaned = original.replace("-", "");
                if (cleaned.length() >= 8) {
                    String areaCode = cleaned.substring(0, Math.min(4, cleaned.length() - 7));
                    String suffix = cleaned.substring(cleaned.length() - 4);
                    return areaCode + "-****" + suffix;
                }
                break;
                
            case ADDRESS:
                // Keep province and city, mask rest
                if (len > 10) return original.substring(0, Math.min(10, len)) + "****";
                break;
                
            case PASSWORD:
                return "******";
                
            case CAR_LICENSE:
                if (len == 7) return original.substring(0, 2) + "***" + original.substring(5);
                break;
                
            case IPV4:
                String[] parts = original.split("\\.");
                if (parts.length == 4) return parts[0] + "." + parts[1] + ".*.*";
                break;
                
            case IPV6:
                String[] segments = original.split(":");
                if (segments.length >= 2) {
                    return segments[0] + ":" + segments[1] + ":****:****:****:****:****:****";
                }
                break;
        }
        
        return original; // Fallback
    }

    /**
     * Get SensitiveType by code
     */
    public static SensitiveType fromCode(String code) {
        for (SensitiveType type : values()) {
            if (type.code.equals(code)) {
                return type;
            }
        }
        return null;
    }
}
