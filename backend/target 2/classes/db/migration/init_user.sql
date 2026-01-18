-- 初始化默认用户数据
-- 说明：如果数据库中还没有用户，执行此脚本创建默认用户

-- 插入默认用户（如果不存在）
INSERT INTO `user` (`id`, `username`, `display_name`, `avatar_url`, `email`, `created_at`, `updated_at`)
SELECT 1, 'user1', '用户', NULL, NULL, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM `user` WHERE `id` = 1);

-- 为现有项目设置默认用户 ID（如果项目没有 userId）
UPDATE `project` SET `user_id` = 1 WHERE `user_id` IS NULL;

