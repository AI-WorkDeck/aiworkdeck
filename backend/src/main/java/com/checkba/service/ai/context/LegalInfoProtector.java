package com.checkba.service.ai.context;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 法律信息保护器
 * 识别并保护法律关键信息，确保在上下文压缩时不被丢失
 */
@Service
public class LegalInfoProtector {
    private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(LegalInfoProtector.class);

    // 需要保护的法律信息类型及其正则模式
    private static final List<ProtectedPattern> PROTECTED_PATTERNS = Arrays.asList(
            // 法律法规名称及条款
            new ProtectedPattern("《[^》]+》(?:第[一二三四五六七八九十百千万]+条)?(?:第[一二三四五六七八九十]+款)?", 
                    ProtectionLevel.CRITICAL, "法律引用"),
            
            // 日期（多种格式）
            new ProtectedPattern("\\d{4}年\\d{1,2}月\\d{1,2}日", 
                    ProtectionLevel.CRITICAL, "日期"),
            new ProtectedPattern("\\d{4}-\\d{2}-\\d{2}", 
                    ProtectionLevel.HIGH, "日期"),
            
            // 金额
            new ProtectedPattern("[\\d,]+\\.?\\d*\\s*(万元|亿元|元|万|亿)", 
                    ProtectionLevel.CRITICAL, "金额"),
            new ProtectedPattern("人民币[\\d,]+\\.?\\d*", 
                    ProtectionLevel.CRITICAL, "金额"),
            
            // 统一社会信用代码
            new ProtectedPattern("统一社会信用代码[：:]?\\s*[0-9A-Z]{18}", 
                    ProtectionLevel.HIGH, "信用代码"),
            new ProtectedPattern("[0-9A-Z]{18}", 
                    ProtectionLevel.MEDIUM, "信用代码"),
            
            // 当事人
            new ProtectedPattern("(甲方|乙方|丙方|丁方|发行人|标的公司|上市公司|交易对方)[：:：]\\s*[^\\n,，。]+", 
                    ProtectionLevel.CRITICAL, "当事人"),
            
            // 合同编号
            new ProtectedPattern("(合同|协议|编号)[：:]\\s*[A-Za-z0-9\\-]+", 
                    ProtectionLevel.HIGH, "合同编号"),
            
            // 股权比例
            new ProtectedPattern("\\d+\\.?\\d*\\s*%", 
                    ProtectionLevel.HIGH, "比例"),
            
            // 期限
            new ProtectedPattern("\\d+\\s*(个月|年|日|天|工作日)", 
                    ProtectionLevel.HIGH, "期限"),
            
            // 法院/仲裁机构
            new ProtectedPattern("[\\u4e00-\\u9fa5]+(?:人民法院|仲裁委员会)", 
                    ProtectionLevel.HIGH, "司法机构")
    );

    /**
     * 保护级别
     */
    public enum ProtectionLevel {
        CRITICAL(1.0),   // 绝对不能丢失
        HIGH(0.9),       // 非常重要
        MEDIUM(0.7);     // 较重要

        private final double score;

        ProtectionLevel(double score) {
            this.score = score;
        }

        public double getScore() {
            return score;
        }
    }

    /**
     * 保护模式
     */
    /**
     * 保护模式
     */
    public static class ProtectedPattern {
        private String pattern;
        private ProtectionLevel level;
        private String type;

        public ProtectedPattern(String pattern, ProtectionLevel level, String type) {
            this.pattern = pattern;
            this.level = level;
            this.type = type;
        }
        
        public String getPattern() { return pattern; }
        public void setPattern(String pattern) { this.pattern = pattern; }
        public ProtectionLevel getLevel() { return level; }
        public void setLevel(ProtectionLevel level) { this.level = level; }
        public String getType() { return type; }
        public void setType(String type) { this.type = type; }
    }

    /**
     * 受保护的内容片段
     */
    public static class ProtectedSegment {
        private int start;
        private int end;
        private String content;
        private ProtectionLevel level;
        private String type;

        public ProtectedSegment(int start, int end, String content, ProtectionLevel level, String type) {
            this.start = start;
            this.end = end;
            this.content = content;
            this.level = level;
            this.type = type;
        }
        
        public int getStart() { return start; }
        public void setStart(int start) { this.start = start; }
        public int getEnd() { return end; }
        public void setEnd(int end) { this.end = end; }
        public String getContent() { return content; }
        public void setContent(String content) { this.content = content; }
        public ProtectionLevel getLevel() { return level; }
        public void setLevel(ProtectionLevel level) { this.level = level; }
        public String getType() { return type; }
        public void setType(String type) { this.type = type; }
    }

    /**
     * 标记内容中的受保护信息
     */
    public List<ProtectedSegment> markProtectedInfo(String content) {
        if (content == null || content.isEmpty()) {
            return Collections.emptyList();
        }

        List<ProtectedSegment> segments = new ArrayList<>();

        for (ProtectedPattern pp : PROTECTED_PATTERNS) {
            try {
                Pattern pattern = Pattern.compile(pp.getPattern());
                Matcher matcher = pattern.matcher(content);
                while (matcher.find()) {
                    segments.add(new ProtectedSegment(
                            matcher.start(),
                            matcher.end(),
                            matcher.group(),
                            pp.getLevel(),
                            pp.getType()
                    ));
                }
            } catch (Exception e) {
                log.warn("Failed to match pattern {}: {}", pp.getPattern(), e.getMessage());
            }
        }

        // 按位置排序并去重
        segments.sort(Comparator.comparingInt(ProtectedSegment::getStart));
        return mergeOverlappingSegments(segments);
    }

    /**
     * 合并重叠的片段
     */
    private List<ProtectedSegment> mergeOverlappingSegments(List<ProtectedSegment> segments) {
        if (segments.size() <= 1) {
            return segments;
        }

        List<ProtectedSegment> merged = new ArrayList<>();
        ProtectedSegment current = segments.get(0);

        for (int i = 1; i < segments.size(); i++) {
            ProtectedSegment next = segments.get(i);
            if (next.getStart() <= current.getEnd()) {
                // 重叠，合并
                int newEnd = Math.max(current.getEnd(), next.getEnd());
                ProtectionLevel higherLevel = current.getLevel().getScore() >= next.getLevel().getScore() 
                        ? current.getLevel() : next.getLevel();
                current = new ProtectedSegment(
                        current.getStart(),
                        newEnd,
                        current.getContent(),  // 保留第一个的内容
                        higherLevel,
                        current.getType()
                );
            } else {
                merged.add(current);
                current = next;
            }
        }
        merged.add(current);

        return merged;
    }

    /**
     * 安全压缩：确保受保护信息不被丢失
     * 返回压缩后的内容和保护的信息列表
     */
    public CompressedResult safeCompress(String content, int targetLength) {
        List<ProtectedSegment> protectedSegments = markProtectedInfo(content);
        
        // 计算受保护内容的总长度
        int protectedLength = protectedSegments.stream()
                .mapToInt(s -> s.getContent().length())
                .sum();

        log.info("Safe compress: contentLength={}, targetLength={}, protectedLength={}, protectedCount={}",
                content.length(), targetLength, protectedLength, protectedSegments.size());

        if (protectedLength >= targetLength) {
            // 受保护内容已超过目标长度，只保留最关键的受保护内容
            StringBuilder sb = new StringBuilder();
            sb.append("[上下文已压缩，保留法律关键信息]\n\n");
            
            // 只保留 CRITICAL 级别的
            protectedSegments.stream()
                    .filter(s -> s.getLevel() == ProtectionLevel.CRITICAL)
                    .forEach(s -> sb.append("• ").append(s.getType()).append(": ")
                            .append(s.getContent()).append("\n"));
            
            return new CompressedResult(sb.toString(), protectedSegments, true);
        }

        // 还有空间保留其他内容
        int availableForOther = targetLength - protectedLength - 100; // 留100字符余量
        
        if (content.length() <= targetLength) {
            // 不需要压缩
            return new CompressedResult(content, protectedSegments, false);
        }

        // 需要压缩：保留受保护内容 + 非保护内容的摘要
        StringBuilder result = new StringBuilder();
        int lastEnd = 0;
        
        for (ProtectedSegment segment : protectedSegments) {
            // 添加段前的部分内容（如果有空间）
            if (segment.getStart() > lastEnd && availableForOther > 0) {
                String before = content.substring(lastEnd, segment.getStart());
                int takeLength = Math.min(before.length(), availableForOther / protectedSegments.size());
                if (takeLength > 20) {
                    result.append(before.substring(0, takeLength)).append("...");
                    availableForOther -= takeLength;
                }
            }
            
            // 添加受保护内容
            result.append(segment.getContent());
            lastEnd = segment.getEnd();
        }
        
        return new CompressedResult(result.toString(), protectedSegments, true);
    }

    /**
     * 压缩结果
     */
    @Data
    @AllArgsConstructor
    public static class CompressedResult {
        private String content;
        private List<ProtectedSegment> protectedSegments;
        private boolean wasCompressed;
    }

    /**
     * 验证压缩后的内容是否安全
     */
    public ValidationResult validate(String original, String compressed) {
        List<ProtectedSegment> originalSegments = markProtectedInfo(original);
        List<ProtectedSegment> compressedSegments = markProtectedInfo(compressed);

        List<String> missing = new ArrayList<>();
        
        // 检查 CRITICAL 级别的内容是否都保留了
        for (ProtectedSegment os : originalSegments) {
            if (os.getLevel() == ProtectionLevel.CRITICAL) {
                boolean found = compressedSegments.stream()
                        .anyMatch(cs -> cs.getContent().contains(os.getContent()) || 
                                os.getContent().contains(cs.getContent()));
                if (!found) {
                    missing.add(os.getType() + ": " + os.getContent());
                }
            }
        }

        if (!missing.isEmpty()) {
            log.warn("Compression validation failed: missing {} critical items", missing.size());
            return new ValidationResult(false, missing);
        }

        log.info("Compression validation passed: {} critical items preserved", 
                originalSegments.stream().filter(s -> s.getLevel() == ProtectionLevel.CRITICAL).count());
        return new ValidationResult(true, Collections.emptyList());
    }

    /**
     * 验证结果
     */
    @Data
    @AllArgsConstructor
    public static class ValidationResult {
        private boolean passed;
        private List<String> missingItems;
    }

    /**
     * 提取所有法律引用
     */
    public List<String> extractLegalReferences(String content) {
        List<String> refs = new ArrayList<>();
        Pattern pattern = Pattern.compile("《[^》]+》(?:第[一二三四五六七八九十百千万]+条)?");
        Matcher matcher = pattern.matcher(content);
        while (matcher.find()) {
            String ref = matcher.group();
            if (!refs.contains(ref)) {
                refs.add(ref);
            }
        }
        return refs;
    }

    /**
     * 提取所有金额
     */
    public List<String> extractAmounts(String content) {
        List<String> amounts = new ArrayList<>();
        Pattern pattern = Pattern.compile("[\\d,]+\\.?\\d*\\s*(万元|亿元|元)");
        Matcher matcher = pattern.matcher(content);
        while (matcher.find()) {
            amounts.add(matcher.group());
        }
        return amounts;
    }

    /**
     * 提取所有日期
     */
    public List<String> extractDates(String content) {
        List<String> dates = new ArrayList<>();
        Pattern pattern = Pattern.compile("\\d{4}年\\d{1,2}月\\d{1,2}日");
        Matcher matcher = pattern.matcher(content);
        while (matcher.find()) {
            dates.add(matcher.group());
        }
        return dates;
    }
}

