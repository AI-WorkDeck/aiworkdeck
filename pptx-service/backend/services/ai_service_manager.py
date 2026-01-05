"""
AIService singleton manager for optimizing provider initialization

This module provides a singleton pattern implementation for AIService to avoid
repeated initialization of AI providers (TextProvider and ImageProvider) on every request.

Benefits:
- Reuses AI provider instances across requests
- Reduces initialization overhead
- Better resource management
- Thread-safe for Flask multi-threaded environment

Usage:
    from services.ai_service_manager import get_ai_service
    
    # In your controller - default singleton
    ai_service = get_ai_service()
    
    # With dynamic model configuration from main backend
    model_config = {
        'provider': 'openai',
        'api_key': 'sk-xxx',
        'api_base': 'https://openrouter.ai/api/v1',
        'text_model': 'google/gemini-3-pro-preview',
        # 注意：图片生成需要使用支持图片生成的模型 (Nano Banana Pro)
        # 参考：https://openrouter.ai/google/gemini-3-pro-image-preview
        'image_model': 'google/gemini-3-pro-image-preview'
    }
    ai_service = get_ai_service(model_config=model_config)
"""

import logging
from threading import Lock
from typing import Optional, Dict, Any
from flask import current_app, has_app_context
from .ai_service import AIService
from .ai_providers import get_text_provider, get_image_provider, TextProvider, ImageProvider
from .ai_providers.text import OpenAITextProvider, GenAITextProvider
from .ai_providers.image import OpenAIImageProvider, GenAIImageProvider

logger = logging.getLogger(__name__)

# Global singleton instance
_ai_service_instance: Optional[AIService] = None
_lock = Lock()

# Provider cache to avoid re-initialization when models don't change
_text_provider_cache: dict = {}
_image_provider_cache: dict = {}
_cache_lock = Lock()


def _get_cached_text_provider(model: str) -> TextProvider:
    """
    Get or create a cached text provider instance
    
    Args:
        model: Model name to use
        
    Returns:
        Cached or new TextProvider instance
    """
    with _cache_lock:
        if model not in _text_provider_cache:
            logger.info(f"Creating new TextProvider for model: {model}")
            _text_provider_cache[model] = get_text_provider(model=model)
        else:
            logger.debug(f"Reusing cached TextProvider for model: {model}")
        return _text_provider_cache[model]


def _get_cached_image_provider(model: str) -> ImageProvider:
    """
    Get or create a cached image provider instance
    
    Args:
        model: Model name to use
        
    Returns:
        Cached or new ImageProvider instance
    """
    with _cache_lock:
        if model not in _image_provider_cache:
            logger.info(f"Creating new ImageProvider for model: {model}")
            _image_provider_cache[model] = get_image_provider(model=model)
        else:
            logger.debug(f"Reusing cached ImageProvider for model: {model}")
        return _image_provider_cache[model]


def create_ai_service_with_config(model_config: Dict[str, Any]) -> AIService:
    """
    Create a new AIService instance with the provided model configuration.
    
    This is used when the main backend passes model configuration dynamically,
    allowing PPTX service to use the same AI model that user selected in frontend.
    
    Args:
        model_config: Model configuration dictionary with keys:
            - provider: 'openai' or 'gemini'
            - api_key: API key for the provider
            - api_base: API base URL (e.g., https://openrouter.ai/api/v1)
            - text_model: Model name for text generation
            - image_model: Model name for image generation
              注意：图片生成需要使用支持图片生成的模型
              参考：https://openrouter.ai/google/gemini-3-pro-image-preview
            
    Returns:
        New AIService instance configured with the provided settings
    """
    provider = model_config.get('provider', 'openai')
    api_key = model_config.get('api_key')
    api_base = model_config.get('api_base')
    text_model = model_config.get('text_model', 'google/gemini-3-pro-preview')
    # 使用支持图片生成的模型 (Nano Banana Pro)
    image_model = model_config.get('image_model', 'google/gemini-3-pro-image-preview')
    
    logger.info(f"Creating AIService with dynamic config: provider={provider}, text_model={text_model}, image_model={image_model}")
    
    # Create text provider based on provider type
    if provider == 'gemini':
        text_provider = GenAITextProvider(
            api_key=api_key,
            api_base=api_base,
            model=text_model
        )
        image_provider = GenAIImageProvider(
            api_key=api_key,
            api_base=api_base,
            model=image_model
        )
    else:  # 'openai' format (includes OpenRouter)
        text_provider = OpenAITextProvider(
            api_key=api_key,
            api_base=api_base,
            model=text_model
        )
        image_provider = OpenAIImageProvider(
            api_key=api_key,
            api_base=api_base,
            model=image_model
        )
    
    return AIService(
        text_provider=text_provider,
        image_provider=image_provider
    )


def get_ai_service(force_new: bool = False, model_config: Dict[str, Any] = None) -> AIService:
    """
    Get the singleton AIService instance with optimized provider caching
    
    This function creates and returns a singleton AIService instance that reuses
    AI providers (TextProvider and ImageProvider) across requests, significantly
    reducing initialization overhead.
    
    Args:
        force_new: If True, forces creation of a new instance (useful for testing)
        model_config: Optional model configuration dict. If provided, creates a new
                      AIService with the specified configuration instead of using singleton.
                      This allows the main backend to pass dynamic model settings.
        
    Returns:
        AIService instance (singleton or newly created based on model_config)
        
    Note:
        When model_config is provided, a new instance is created each time.
        When model_config is None, the singleton pattern is used with provider caching.
    """
    # If model_config is provided, create a new instance with that config
    if model_config:
        return create_ai_service_with_config(model_config)
    
    global _ai_service_instance
    
    if force_new:
        with _lock:
            logger.info("Force creating new AIService instance")
            _ai_service_instance = None
    
    if _ai_service_instance is None:
        with _lock:
            # Double-check locking pattern
            if _ai_service_instance is None:
                logger.info("Initializing AIService singleton with provider caching")
                
                # Get model names from Flask config or use defaults
                from config import get_config
                config = get_config()
                
                if has_app_context() and current_app and hasattr(current_app, "config"):
                    text_model = current_app.config.get("TEXT_MODEL", config.TEXT_MODEL)
                    image_model = current_app.config.get("IMAGE_MODEL", config.IMAGE_MODEL)
                else:
                    text_model = config.TEXT_MODEL
                    image_model = config.IMAGE_MODEL
                
                # Get cached providers
                text_provider = _get_cached_text_provider(text_model)
                image_provider = _get_cached_image_provider(image_model)
                
                # Create AIService with cached providers
                _ai_service_instance = AIService(
                    text_provider=text_provider,
                    image_provider=image_provider
                )
                
                logger.info(f"AIService singleton created with models: text={text_model}, image={image_model}")
    
    return _ai_service_instance


def clear_ai_service_cache():
    """
    Clear the AIService singleton and provider cache
    
    This is useful when:
    - Configuration changes (API keys, endpoints, models)
    - Testing scenarios requiring fresh instances
    - Memory cleanup needed
    
    Note:
    - Uses nested locks to ensure atomic cache clearing operation
    - Prevents race conditions where new instances could be created
      with stale cached providers during the clearing process
    """
    global _ai_service_instance
    
    with _lock:
        _ai_service_instance = None
        logger.info("AIService singleton cache cleared")
        with _cache_lock:
            _text_provider_cache.clear()
            _image_provider_cache.clear()
            logger.info("Provider cache cleared")


def get_provider_cache_info() -> dict:
    """
    Get information about cached providers (for debugging/monitoring)
    
    Returns:
        Dictionary with cache statistics
    """
    with _cache_lock:
        return {
            "text_providers": list(_text_provider_cache.keys()),
            "image_providers": list(_image_provider_cache.keys()),
            "total_cached": len(_text_provider_cache) + len(_image_provider_cache)
        }

