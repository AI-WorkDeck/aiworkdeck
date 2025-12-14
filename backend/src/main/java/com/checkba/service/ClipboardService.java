package com.checkba.service;

import com.checkba.model.entity.ClipboardItem;
import com.checkba.repository.ClipboardItemRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.time.LocalDateTime;
import java.util.List;

@Service
@RequiredArgsConstructor
public class ClipboardService {

    private final ClipboardItemRepository repository;

    public List<ClipboardItem> list(Long userId, String query, int limit) {
        int size = Math.max(1, Math.min(200, limit));
        if (StringUtils.hasText(query)) {
            return repository.search(userId, query.trim(), PageRequest.of(0, size));
        }
        return repository.findByUserIdOrderByCreatedAtDesc(userId, PageRequest.of(0, size));
    }

    @Transactional
    public ClipboardItem saveText(Long userId, String text) {
        if (userId == null) throw new IllegalArgumentException("userId 不能为空");
        if (!StringUtils.hasText(text)) throw new IllegalArgumentException("text 不能为空");

        ClipboardItem item = new ClipboardItem();
        item.setUserId(userId);
        item.setType("TEXT");
        item.setText(text);
        item.setCreatedAt(LocalDateTime.now());
        return repository.save(item);
    }

    @Transactional
    public void delete(Long id, Long userId) {
        ClipboardItem item = repository.findById(id).orElseThrow(() -> new IllegalArgumentException("记录不存在"));
        if (!item.getUserId().equals(userId)) {
            throw new IllegalArgumentException("无权删除该记录");
        }
        repository.delete(item);
    }
}


