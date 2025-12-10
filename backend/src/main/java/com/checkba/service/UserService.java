package com.checkba.service;

import com.checkba.model.entity.User;
import com.checkba.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.time.LocalDateTime;
import java.util.Optional;

@Service
@RequiredArgsConstructor
public class UserService {

    private final UserRepository userRepository;

    /**
     * 用户注册
     */
    public User register(String username, String password, String displayName) {
        if (!StringUtils.hasText(username)) {
            throw new IllegalArgumentException("用户名不能为空");
        }
        if (!StringUtils.hasText(password)) {
            throw new IllegalArgumentException("密码不能为空");
        }
        if (password.length() < 6) {
            throw new IllegalArgumentException("密码长度不能少于6位");
        }

        // 检查用户名是否已存在
        if (userRepository.findByUsername(username).isPresent()) {
            throw new IllegalArgumentException("用户名已存在");
        }

        User user = new User();
        user.setUsername(username);
        // 简单密码存储（实际生产环境应使用 BCrypt 加密）
        // TODO: 后续接入 Spring Security 后使用 BCryptPasswordEncoder
        user.setPassword(password); // 临时存储明文，后续改为加密
        user.setDisplayName(StringUtils.hasText(displayName) ? displayName : username);
        user.setCreatedAt(LocalDateTime.now());
        user.setUpdatedAt(LocalDateTime.now());

        return userRepository.save(user);
    }

    /**
     * 用户登录
     */
    public User login(String username, String password) {
        if (!StringUtils.hasText(username)) {
            throw new IllegalArgumentException("用户名不能为空");
        }
        if (!StringUtils.hasText(password)) {
            throw new IllegalArgumentException("密码不能为空");
        }

        Optional<User> userOpt = userRepository.findByUsername(username);
        if (userOpt.isEmpty()) {
            throw new IllegalArgumentException("用户名或密码错误");
        }

        User user = userOpt.get();
        // 简单密码验证（实际生产环境应使用 BCrypt 验证）
        // TODO: 后续接入 Spring Security 后使用 BCryptPasswordEncoder.matches()
        if (!password.equals(user.getPassword())) {
            throw new IllegalArgumentException("用户名或密码错误");
        }

        return user;
    }

    /**
     * 根据 ID 获取用户
     */
    public User getUserById(Long id) {
        return userRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("用户不存在: " + id));
    }

    /**
     * 根据用户名获取用户
     */
    public Optional<User> getUserByUsername(String username) {
        return userRepository.findByUsername(username);
    }
}

