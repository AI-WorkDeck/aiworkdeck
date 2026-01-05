"""
AI服务Mock测试

验证AI服务被正确mock，不会真正调用外部API
"""

import pytest
from unittest.mock import patch, MagicMock


class TestAIMock:
    """AI Mock测试"""
    
    def test_ai_service_is_mocked(self, mock_ai_service):
        """验证AI服务被正确mock"""
        # 调用mock的方法
        outline = mock_ai_service.generate_outline("测试prompt")
        
        # 验证返回mock数据
        assert len(outline) == 2
        assert outline[0]['title'] == '测试页面1'
        
        # 验证方法被调用
        mock_ai_service.generate_outline.assert_called_once_with("测试prompt")
    
    def test_description_generation_mocked(self, mock_ai_service):
        """验证描述生成被mock"""
        desc = mock_ai_service.generate_page_description(
            "idea", [], {}, 1
        )
        
        assert desc['title'] == '测试标题'
        assert 'text_content' in desc
    
    def test_image_generation_mocked(self, mock_ai_service):
        """验证图片生成被mock"""
        image = mock_ai_service.generate_image("prompt", "ref.png")
        
        # 应该返回一个PIL Image对象
        assert image is not None
        assert image.size == (1920, 1080)
    
    def test_no_real_api_calls(self, mock_ai_service):
        """确保没有真实API调用"""
        # 多次调用
        for _ in range(10):
            mock_ai_service.generate_outline("test")
            mock_ai_service.generate_page_description("idea", [], {}, 1)
        
        # 验证调用次数
        assert mock_ai_service.generate_outline.call_count == 10
        assert mock_ai_service.generate_page_description.call_count == 10


class TestEnvironmentFlags:
    """环境标志测试"""
    
    def test_testing_flag_is_set(self):
        """验证测试标志已设置"""
        import os
        assert os.environ.get('TESTING') == 'true'
    
    def test_mock_ai_flag_is_set(self):
        """验证mock AI标志已设置"""
        import os
        assert os.environ.get('USE_MOCK_AI') == 'true'

