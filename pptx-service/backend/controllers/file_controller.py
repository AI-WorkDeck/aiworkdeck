"""
File Controller - handles static file serving
"""
from flask import Blueprint, send_from_directory, current_app
from utils import error_response, not_found
from utils.path_utils import find_file_with_prefix
import os
from pathlib import Path
from werkzeug.utils import secure_filename

file_bp = Blueprint('files', __name__, url_prefix='/files')


@file_bp.route('/<project_id>/<file_type>/<filename>', methods=['GET'])
def serve_file(project_id, file_type, filename):
    """
    GET /files/{project_id}/{type}/{filename} - Serve static files
    
    Args:
        project_id: Project UUID
        file_type: 'template' or 'pages'
        filename: File name
    """
    try:
        if file_type not in ['template', 'pages', 'materials', 'exports']:
            return not_found('File')
        
        safe_project_id = secure_filename(project_id)
        safe_filename = secure_filename(filename)
        if not safe_project_id or not safe_filename:
            return not_found('File')

        base_dir = os.path.realpath(os.path.abspath(current_app.config['UPLOAD_FOLDER']))
        file_dir = os.path.realpath(os.path.join(base_dir, safe_project_id, file_type))
        if not file_dir.startswith(base_dir + os.sep):
            return not_found('File')
        
        # Check if directory exists
        if not os.path.exists(file_dir):
            return not_found('File')
        
        # Check if file exists
        file_path = os.path.realpath(os.path.join(file_dir, safe_filename))
        if not file_path.startswith(file_dir + os.sep) or not os.path.exists(file_path):
            return not_found('File')
        
        # Serve file
        return send_from_directory(file_dir, safe_filename)
    
    except Exception as e:
        return error_response('SERVER_ERROR', str(e), 500)


@file_bp.route('/user-templates/<template_id>/<filename>', methods=['GET'])
def serve_user_template(template_id, filename):
    """
    GET /files/user-templates/{template_id}/{filename} - Serve user template files
    
    Args:
        template_id: Template UUID
        filename: File name
    """
    try:
        safe_template_id = secure_filename(template_id)
        safe_filename = secure_filename(filename)
        if not safe_template_id or not safe_filename:
            return not_found('File')

        base_dir = os.path.realpath(os.path.abspath(current_app.config['UPLOAD_FOLDER']))
        file_dir = os.path.realpath(os.path.join(base_dir, 'user-templates', safe_template_id))
        if not file_dir.startswith(base_dir + os.sep):
            return not_found('File')
        
        # Check if directory exists
        if not os.path.exists(file_dir):
            return not_found('File')
        
        # Check if file exists
        file_path = os.path.realpath(os.path.join(file_dir, safe_filename))
        if not file_path.startswith(file_dir + os.sep) or not os.path.exists(file_path):
            return not_found('File')
        
        # Serve file
        return send_from_directory(file_dir, safe_filename)
    
    except Exception as e:
        return error_response('SERVER_ERROR', str(e), 500)


@file_bp.route('/materials/<filename>', methods=['GET'])
def serve_global_material(filename):
    """
    GET /files/materials/{filename} - Serve global material files (not bound to a project)
    
    Args:
        filename: File name
    """
    try:
        safe_filename = secure_filename(filename)
        # Construct file path
        file_dir = os.path.join(
            current_app.config['UPLOAD_FOLDER'],
            'materials'
        )
        
        # Check if directory exists
        if not os.path.exists(file_dir):
            return not_found('File')
        
        # Check if file exists
        file_path = os.path.join(file_dir, safe_filename)
        if not os.path.exists(file_path):
            return not_found('File')
        
        # Serve file
        return send_from_directory(file_dir, safe_filename)
    
    except Exception as e:
        return error_response('SERVER_ERROR', str(e), 500)


@file_bp.route('/mineru/<extract_id>/<path:filepath>', methods=['GET'])
def serve_mineru_file(extract_id, filepath):
    """
    GET /files/mineru/{extract_id}/{filepath} - Serve MinerU extracted files.

    Args:
        extract_id: Extract UUID
        filepath: Relative file path within the extract
    """
    try:
        safe_extract_id = secure_filename(extract_id)
        if not safe_extract_id:
            return error_response('INVALID_PATH', 'Invalid file path', 403)

        base_dir = os.path.realpath(os.path.abspath(current_app.config['UPLOAD_FOLDER']))
        root_dir = os.path.realpath(os.path.join(base_dir, 'mineru_files', safe_extract_id))
        if not root_dir.startswith(base_dir + os.sep):
            return error_response('INVALID_PATH', 'Invalid file path', 403)

        resolved_full_path = os.path.realpath(os.path.join(root_dir, filepath))
        if not resolved_full_path.startswith(root_dir + os.sep):
            return error_response('INVALID_PATH', 'Invalid file path', 403)

        # Try to find file with prefix matching
        matched_path = find_file_with_prefix(Path(resolved_full_path))
        
        if matched_path is not None:
            resolved_matched_path = os.path.realpath(str(matched_path))
            if not resolved_matched_path.startswith(root_dir + os.sep):
                return error_response('INVALID_PATH', 'Invalid file path', 403)
            if not os.path.exists(resolved_matched_path) or not os.path.isfile(resolved_matched_path):
                return not_found('File')
            
            return send_from_directory(os.path.dirname(resolved_matched_path), os.path.basename(resolved_matched_path))

        return not_found('File')
    except Exception as e:
        return error_response('SERVER_ERROR', str(e), 500)

