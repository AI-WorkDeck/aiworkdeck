"""
健康检查API单元测试
"""

import pytest


class TestHealthEndpoint:
    """健康检查端点测试"""
    
    def test_health_check_returns_ok(self, client):
        """测试健康检查返回正常状态"""
        response = client.get('/health')
        
        assert response.status_code == 200
        data = response.get_json()
        assert data['status'] == 'ok'
        assert 'message' in data
    
    def test_health_check_response_format(self, client):
        """测试健康检查响应格式"""
        response = client.get('/health')
        
        data = response.get_json()
        assert isinstance(data, dict)
        assert 'status' in data
        assert 'message' in data

