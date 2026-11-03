"""
Path utilities for handling MinerU file paths and prefix matching
"""
import os
import logging
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)


def convert_mineru_path_to_local(mineru_path: str, project_root: Optional[Path] = None) -> Optional[Path]:
    """
    将 /files/mineru/{extract_id}/{rel_path} 格式的路径转换为本地文件系统路径
    
    Args:
        mineru_path: MinerU URL 路径，格式为 /files/mineru/{extract_id}/{rel_path}
        project_root: 项目根目录路径（如果为 None，则自动计算）
        
    Returns:
        本地文件系统路径（Path 对象），如果转换失败则返回 None
    """
    try:
        if not mineru_path.startswith('/files/mineru/'):
            return None
        
        # Remove '/files/mineru/' prefix
        rel_path = mineru_path.replace('/files/mineru/', '')
        
        # Get project root if not provided
        if project_root is None:
            # Navigate to project root (assuming this file is in backend/utils/)
            current_file = Path(__file__).resolve()
            backend_dir = current_file.parent.parent
            project_root = backend_dir.parent
        
        # Construct full path: {project_root}/uploads/mineru_files/{rel_path}
        base_dir = os.path.realpath(os.path.join(str(project_root), 'uploads', 'mineru_files'))
        resolved_path = os.path.realpath(os.path.join(base_dir, rel_path))
        if not resolved_path.startswith(base_dir + os.sep):
            return None
        
        return Path(resolved_path)
    except Exception as e:
        logger.warning(f"Failed to convert MinerU path to local: {mineru_path}, error: {str(e)}")
        return None


def find_mineru_file_with_prefix(mineru_path: str, project_root: Optional[Path] = None) -> Optional[Path]:
    """
    查找 MinerU 文件，支持前缀匹配
    
    首先尝试直接路径匹配，如果失败则尝试前缀匹配。
    前缀匹配逻辑：如果文件名看起来像是一个前缀+扩展名（前缀长度 >= 5），
    则在目录中查找以该前缀开头的文件。
    
    Args:
        mineru_path: MinerU URL 路径，格式为 /files/mineru/{extract_id}/{rel_path}
        project_root: 项目根目录路径（如果为 None，则自动计算）
        
    Returns:
        找到的文件路径（Path 对象），如果未找到则返回 None
    """
    # First try direct path conversion
    local_path = convert_mineru_path_to_local(mineru_path, project_root)
    
    if local_path is None:
        return None
    
    # Direct file matching
    if local_path.exists() and local_path.is_file():
        return local_path
    
    # Try prefix match using the generic function
    return find_file_with_prefix(local_path)


def find_file_with_prefix(file_path: Path) -> Optional[Path]:
    """
    查找文件，支持前缀匹配
    
    首先检查文件是否存在，如果不存在则尝试前缀匹配。
    前缀匹配逻辑：如果文件名看起来像是一个前缀+扩展名（前缀长度 >= 5），
    则在目录中查找以该前缀开头的文件。
    
    Args:
        file_path: 要查找的文件路径（Path 对象）
        
    Returns:
        找到的文件路径（Path 对象），如果未找到则返回 None
    """
    allowed_root = os.path.realpath(os.environ.get("PPTX_ALLOWED_ROOT") or os.path.abspath(os.sep))
    resolved_file = os.path.realpath(os.path.abspath(str(file_path)))
    if not resolved_file.startswith(allowed_root):
        return None

    # Direct file matching
    if os.path.exists(resolved_file) and os.path.isfile(resolved_file):
        return Path(resolved_file)
    
    # Try prefix match if not found and filename looks like a prefix with extension
    filename = os.path.basename(resolved_file)
    dirpath = os.path.realpath(os.path.dirname(resolved_file))
    if not dirpath.startswith(allowed_root):
        return None
    
    if '.' in filename and os.path.exists(dirpath) and os.path.isdir(dirpath):
        prefix, ext = os.path.splitext(filename)
        if len(prefix) >= 5:
            try:
                for fname in os.listdir(dirpath):
                    fp, fe = os.path.splitext(fname)
                    if fp.lower().startswith(prefix.lower()) and fe.lower() == ext.lower():
                        matched_str = os.path.realpath(os.path.join(dirpath, fname))
                        if matched_str.startswith(dirpath + os.sep) and os.path.isfile(matched_str):
                            matched_path = Path(matched_str)
                            logger.debug(f"Prefix match found: {file_path} -> {matched_path}")
                            return matched_path
            except OSError as e:
                logger.warning(f"Failed to list directory {dirpath}: {str(e)}")
    
    return None

