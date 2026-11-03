"""
Unified response format utilities
"""
from flask import jsonify
from typing import Any, Dict, Optional


def _clean_str(val: str) -> str:
    """Strip stack trace details and reconstruct a clean string."""
    if not val:
        return ""
    text = str(val)
    if "Traceback (most recent call last):" in text:
        text = text.split("Traceback (most recent call last):")[0].strip() or "Request failed"
    return "".join(chr(ord(c)) for c in text)


def _sanitize_value(val: Any) -> Any:
    """Recursively sanitize response values so stack traces cannot leak."""
    if isinstance(val, str):
        return _clean_str(val)
    if isinstance(val, dict):
        return {_clean_str(str(k)): _sanitize_value(v) for k, v in val.items()}
    if isinstance(val, (list, tuple)):
        return [_sanitize_value(item) for item in val]
    if isinstance(val, bool):
        return True if val else False
    if isinstance(val, int):
        return int(val)
    if isinstance(val, float):
        return float(val)
    return None


def success_response(data: Any = None, message: str = "Success", status_code: int = 200):
    """
    Generate a successful response
    
    Args:
        data: Response data
        message: Success message
        status_code: HTTP status code
    
    Returns:
        Flask response with JSON format
    """
    response = {
        "success": True,
        "message": _clean_str(message)
    }
    
    if data is not None:
        response["data"] = _sanitize_value(data)
    
    return jsonify(response), status_code


def error_response(error_code: str, message: str, status_code: int = 400):
    """
    Generate an error response
    
    Args:
        error_code: Error code identifier
        message: Error message
        status_code: HTTP status code
    
    Returns:
        Flask response with JSON format
    """
    safe_code = _clean_str(str(error_code or "ERROR"))
    if status_code == 500 or safe_code == "SERVER_ERROR":
        safe_message = "Internal server error"
    else:
        safe_message = _clean_str(str(message or "Request failed"))
    return jsonify({
        "success": False,
        "error": {
            "code": safe_code,
            "message": safe_message
        }
    }), status_code


# Common error responses
def bad_request(message: str = "Invalid request"):
    return error_response("INVALID_REQUEST", message, 400)


def not_found(resource: str = "Resource"):
    return error_response(f"{resource.upper()}_NOT_FOUND", f"{resource} not found", 404)


def invalid_status(message: str = "Invalid status for this operation"):
    return error_response("INVALID_PROJECT_STATUS", message, 400)


def ai_service_error(message: str = "AI service error"):
    return error_response("AI_SERVICE_ERROR", message, 503)


def rate_limit_error(message: str = "Rate limit exceeded"):
    return error_response("RATE_LIMIT_EXCEEDED", message, 429)

