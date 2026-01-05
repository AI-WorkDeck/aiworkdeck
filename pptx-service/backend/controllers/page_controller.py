"""
Page Controller - handles page-related endpoints
"""
import logging
from flask import Blueprint, request, current_app
from models import db, Project, Page, PageImageVersion, Task
from utils import success_response, error_response, not_found, bad_request
from services import FileService, ProjectContext
from services.ai_service_manager import get_ai_service
from services.task_manager import task_manager, generate_single_page_image_task, edit_page_image_task
from datetime import datetime
from pathlib import Path
from werkzeug.utils import secure_filename
import shutil
import tempfile
import json

logger = logging.getLogger(__name__)

page_bp = Blueprint('pages', __name__, url_prefix='/api/projects')


@page_bp.route('/<project_id>/pages', methods=['POST'])
def create_page(project_id):
    """
    POST /api/projects/{project_id}/pages - Add new page
    
    Request body:
    {
        "order_index": 2,
        "part": "optional",
        "outline_content": {"title": "...", "points": [...]}
    }
    """
    try:
        project = Project.query.get(project_id)
        
        if not project:
            return not_found('Project')
        
        data = request.get_json()
        
        if not data or 'order_index' not in data:
            return bad_request("order_index is required")
        
        # Create new page
        page = Page(
            project_id=project_id,
            order_index=data['order_index'],
            part=data.get('part'),
            status='DRAFT'
        )
        
        if 'outline_content' in data:
            page.set_outline_content(data['outline_content'])
        
        db.session.add(page)
        
        # Update other pages' order_index if necessary
        other_pages = Page.query.filter(
            Page.project_id == project_id,
            Page.order_index >= data['order_index']
        ).all()
        
        for p in other_pages:
            if p.id != page.id:
                p.order_index += 1
        
        project.updated_at = datetime.utcnow()
        db.session.commit()
        
        return success_response(page.to_dict(), status_code=201)
    
    except Exception as e:
        db.session.rollback()
        return error_response('SERVER_ERROR', str(e), 500)


@page_bp.route('/<project_id>/pages/<page_id>', methods=['DELETE'])
def delete_page(project_id, page_id):
    """
    DELETE /api/projects/{project_id}/pages/{page_id} - Delete page
    """
    try:
        page = Page.query.get(page_id)
        
        if not page or page.project_id != project_id:
            return not_found('Page')
        
        # Delete page image if exists
        file_service = FileService(current_app.config['UPLOAD_FOLDER'])
        file_service.delete_page_image(project_id, page_id)
        
        # Delete page
        db.session.delete(page)
        
        # Update project
        project = Project.query.get(project_id)
        if project:
            project.updated_at = datetime.utcnow()
        
        db.session.commit()
        
        return success_response(message="Page deleted successfully")
    
    except Exception as e:
        db.session.rollback()
        return error_response('SERVER_ERROR', str(e), 500)


@page_bp.route('/<project_id>/pages/<page_id>/outline', methods=['PUT'])
def update_page_outline(project_id, page_id):
    """
    PUT /api/projects/{project_id}/pages/{page_id}/outline - Edit page outline
    
    Request body:
    {
        "outline_content": {"title": "...", "points": [...]}
    }
    """
    try:
        page = Page.query.get(page_id)
        
        if not page or page.project_id != project_id:
            return not_found('Page')
        
        data = request.get_json()
        
        if not data or 'outline_content' not in data:
            return bad_request("outline_content is required")
        
        page.set_outline_content(data['outline_content'])
        page.updated_at = datetime.utcnow()
        
        # Update project
        project = Project.query.get(project_id)
        if project:
            project.updated_at = datetime.utcnow()
        
        db.session.commit()
        
        return success_response(page.to_dict())
    
    except Exception as e:
        db.session.rollback()
        return error_response('SERVER_ERROR', str(e), 500)


@page_bp.route('/<project_id>/pages/<page_id>/description', methods=['PUT'])
def update_page_description(project_id, page_id):
    """
    PUT /api/projects/{project_id}/pages/{page_id}/description - Edit description
    
    Request body:
    {
        "description_content": {
            "title": "...",
            "text_content": ["...", "..."],
            "layout_suggestion": "..."
        }
    }
    """
    try:
        page = Page.query.get(page_id)
        
        if not page or page.project_id != project_id:
            return not_found('Page')
        
        data = request.get_json()
        
        if not data or 'description_content' not in data:
            return bad_request("description_content is required")
        
        page.set_description_content(data['description_content'])
        page.updated_at = datetime.utcnow()
        
        # Update project
        project = Project.query.get(project_id)
        if project:
            project.updated_at = datetime.utcnow()
        
        db.session.commit()
        
        return success_response(page.to_dict())
    
    except Exception as e:
        db.session.rollback()
        return error_response('SERVER_ERROR', str(e), 500)


@page_bp.route('/<project_id>/pages/<page_id>/generate/description', methods=['POST'])
def generate_page_description(project_id, page_id):
    """
    POST /api/projects/{project_id}/pages/{page_id}/generate/description - Generate single page description
    
    Request body:
    {
        "force_regenerate": false
    }
    """
    try:
        page = Page.query.get(page_id)
        
        if not page or page.project_id != project_id:
            return not_found('Page')
        
        project = Project.query.get(project_id)
        if not project:
            return not_found('Project')
        
        data = request.get_json() or {}
        force_regenerate = data.get('force_regenerate', False)
        language = data.get('language', current_app.config.get('OUTPUT_LANGUAGE', 'zh'))
        
        # Check if already generated
        if page.get_description_content() and not force_regenerate:
            return bad_request("Description already exists. Set force_regenerate=true to regenerate")
        
        # Get outline content
        outline_content = page.get_outline_content()
        if not outline_content:
            return bad_request("Page must have outline content first")
        
        # Reconstruct full outline
        all_pages = Page.query.filter_by(project_id=project_id).order_by(Page.order_index).all()
        outline = []
        for p in all_pages:
            oc = p.get_outline_content()
            if oc:
                page_data = oc.copy()
                if p.part:
                    page_data['part'] = p.part
                outline.append(page_data)
        
        # Initialize AI service
        ai_service = get_ai_service()
        
        # Get reference files content and create project context
        from controllers.project_controller import _get_project_reference_files_content
        reference_files_content = _get_project_reference_files_content(project_id)
        project_context = ProjectContext(project, reference_files_content)
        
        # Generate description
        page_data = outline_content.copy()
        if page.part:
            page_data['part'] = page.part
        
        desc_text = ai_service.generate_page_description(
            project_context,
            outline,
            page_data,
            page.order_index + 1,
            language=language
        )
        
        # Save description
        desc_content = {
            "text": desc_text,
            "generated_at": datetime.utcnow().isoformat()
        }
        
        page.set_description_content(desc_content)
        page.status = 'DESCRIPTION_GENERATED'
        page.updated_at = datetime.utcnow()
        
        db.session.commit()
        
        return success_response(page.to_dict())
    
    except Exception as e:
        db.session.rollback()
        return error_response('AI_SERVICE_ERROR', str(e), 503)


@page_bp.route('/<project_id>/pages/<page_id>/generate/image', methods=['POST'])
def generate_page_image(project_id, page_id):
    """
    POST /api/projects/{project_id}/pages/{page_id}/generate/image - Generate single page image
    
    Request body:
    {
        "use_template": true,
        "force_regenerate": false
    }
    """
    try:
        page = Page.query.get(page_id)
        
        if not page or page.project_id != project_id:
            return not_found('Page')
        
        project = Project.query.get(project_id)
        if not project:
            return not_found('Project')
        
        data = request.get_json() or {}
        use_template = data.get('use_template', True)
        force_regenerate = data.get('force_regenerate', False)
        language = data.get('language', current_app.config.get('OUTPUT_LANGUAGE', 'zh'))
        
        # Check if already generated
        if page.generated_image_path and not force_regenerate:
            return bad_request("Image already exists. Set force_regenerate=true to regenerate")
        
        # Get description content
        desc_content = page.get_description_content()
        if not desc_content:
            return bad_request("Page must have description content first")
        
        # Reconstruct full outline with part structure
        all_pages = Page.query.filter_by(project_id=project_id).order_by(Page.order_index).all()
        outline = []
        current_part = None
        current_part_pages = []
        
        for p in all_pages:
            oc = p.get_outline_content()
            if not oc:
                continue
                
            page_data = oc.copy()
            
            # 如果当前页面属于一个 part
            if p.part:
                # 如果这是新的 part，先保存之前的 part（如果有）
                if current_part and current_part != p.part:
                    outline.append({
                        "part": current_part,
                        "pages": current_part_pages
                    })
                    current_part_pages = []
                
                current_part = p.part
                # 移除 part 字段，因为它在顶层
                if 'part' in page_data:
                    del page_data['part']
                current_part_pages.append(page_data)
            else:
                # 如果当前页面不属于任何 part，先保存之前的 part（如果有）
                if current_part:
                    outline.append({
                        "part": current_part,
                        "pages": current_part_pages
                    })
                    current_part = None
                    current_part_pages = []
                
                # 直接添加页面
                outline.append(page_data)
        
        # 保存最后一个 part（如果有）
        if current_part:
            outline.append({
                "part": current_part,
                "pages": current_part_pages
            })
        
        # Initialize services
        ai_service = get_ai_service()
        
        file_service = FileService(current_app.config['UPLOAD_FOLDER'])
        
        # Get template path
        ref_image_path = None
        if use_template:
            ref_image_path = file_service.get_template_path(project_id)
        
        # 检查是否有模板图片或风格描述
        # 如果都没有，则返回错误
        if not ref_image_path and not project.template_style:
            return bad_request("No template image or style description found for project")
        
        # Generate prompt
        page_data = page.get_outline_content() or {}
        if page.part:
            page_data['part'] = page.part
        
        # 获取描述文本（可能是 text 字段或 text_content 数组）
        desc_text = desc_content.get('text', '')
        if not desc_text and desc_content.get('text_content'):
            # 如果 text 字段不存在，尝试从 text_content 数组获取
            text_content = desc_content.get('text_content', [])
            if isinstance(text_content, list):
                desc_text = '\n'.join(text_content)
            else:
                desc_text = str(text_content)
        
        # 从当前页面的描述内容中提取图片 URL（在生成 prompt 之前提取，以便告知 AI）
        additional_ref_images = []
        has_material_images = False
        
        # 从描述文本中提取图片
        if desc_text:
            image_urls = ai_service.extract_image_urls_from_markdown(desc_text)
            if image_urls:
                logger.info(f"Found {len(image_urls)} image(s) in page {page_id} description")
                additional_ref_images = image_urls
                has_material_images = True
        
        # 合并额外要求和风格描述
        combined_requirements = project.extra_requirements or ""
        if project.template_style:
            style_requirement = f"\n\nppt页面风格描述：\n\n{project.template_style}"
            combined_requirements = combined_requirements + style_requirement
        
        # Create async task for image generation
        task = Task(
            project_id=project_id,
            task_type='GENERATE_PAGE_IMAGE',
            status='PENDING'
        )
        task.set_progress({
            'total': 1,
            'completed': 0,
            'failed': 0
        })
        db.session.add(task)
        db.session.commit()
        
        # Get app instance for background task
        app = current_app._get_current_object()
        
        # Submit background task
        task_manager.submit_task(
            task.id,
            generate_single_page_image_task,
            project_id,
            page_id,
            ai_service,
            file_service,
            outline,
            use_template,
            current_app.config['DEFAULT_ASPECT_RATIO'],
            current_app.config['DEFAULT_RESOLUTION'],
            app,
            combined_requirements if combined_requirements.strip() else None,
            language
        )
        
        # Return task_id immediately
        return success_response({
            'task_id': task.id,
            'page_id': page_id,
            'status': 'PENDING'
        }, status_code=202)
    
    except Exception as e:
        db.session.rollback()
        return error_response('AI_SERVICE_ERROR', str(e), 503)


@page_bp.route('/<project_id>/pages/<page_id>/edit/image', methods=['POST'])
def edit_page_image(project_id, page_id):
    """
    POST /api/projects/{project_id}/pages/{page_id}/edit/image - Edit page image
    
    Request body (JSON or multipart/form-data):
    {
        "edit_instruction": "更改文本框样式为虚线",
        "context_images": {
            "use_template": true,  // 是否使用template图片
            "desc_image_urls": ["url1", "url2"],  // desc中的图片URL列表
            "uploaded_image_ids": ["file1", "file2"]  // 上传的图片文件ID列表（在multipart中）
        }
    }
    
    For multipart/form-data:
    - edit_instruction: text field
    - use_template: text field (true/false)
    - desc_image_urls: JSON array string
    - context_images: file uploads (multiple files with key "context_images")
    """
    try:
        page = Page.query.get(page_id)
        
        if not page or page.project_id != project_id:
            return not_found('Page')
        
        if not page.generated_image_path:
            return bad_request("Page must have generated image first")
        
        project = Project.query.get(project_id)
        if not project:
            return not_found('Project')
        
        # Initialize services
        ai_service = get_ai_service()
        
        file_service = FileService(current_app.config['UPLOAD_FOLDER'])
        
        # Parse request data (support both JSON and multipart/form-data)
        if request.is_json:
            data = request.get_json()
            uploaded_files = []
        else:
            # multipart/form-data
            data = request.form.to_dict()
            # Get uploaded files
            uploaded_files = request.files.getlist('context_images')
            # Parse JSON fields
            if 'desc_image_urls' in data and data['desc_image_urls']:
                try:
                    data['desc_image_urls'] = json.loads(data['desc_image_urls'])
                except:
                    data['desc_image_urls'] = []
            else:
                data['desc_image_urls'] = []
        
        if not data or 'edit_instruction' not in data:
            return bad_request("edit_instruction is required")
        
        # Get current image path
        current_image_path = file_service.get_absolute_path(page.generated_image_path)
        
        # Get original description if available
        original_description = None
        desc_content = page.get_description_content()
        if desc_content:
            # Extract text from description_content
            original_description = desc_content.get('text') or ''
            # If text is not available, try to construct from text_content
            if not original_description and desc_content.get('text_content'):
                if isinstance(desc_content['text_content'], list):
                    original_description = '\n'.join(desc_content['text_content'])
                else:
                    original_description = str(desc_content['text_content'])
        
        # Collect additional reference images
        additional_ref_images = []
        
        # 1. Add template image if requested
        context_images = data.get('context_images', {})
        if isinstance(context_images, dict):
            use_template = context_images.get('use_template', False)
        else:
            use_template = data.get('use_template', 'false').lower() == 'true'
        
        if use_template:
            template_path = file_service.get_template_path(project_id)
            if template_path:
                additional_ref_images.append(template_path)
        
        # 2. Add desc image URLs if provided
        if isinstance(context_images, dict):
            desc_image_urls = context_images.get('desc_image_urls', [])
        else:
            desc_image_urls = data.get('desc_image_urls', [])
        
        if desc_image_urls:
            if isinstance(desc_image_urls, str):
                try:
                    desc_image_urls = json.loads(desc_image_urls)
                except:
                    desc_image_urls = []
            if isinstance(desc_image_urls, list):
                additional_ref_images.extend(desc_image_urls)
        
        # 3. Save and add uploaded files to a persistent location
        temp_dir = None
        if uploaded_files:
            # Create a temporary directory in the project's upload folder
            import tempfile
            import shutil
            from werkzeug.utils import secure_filename
            temp_dir = Path(tempfile.mkdtemp(dir=current_app.config['UPLOAD_FOLDER']))
            try:
                for uploaded_file in uploaded_files:
                    if uploaded_file.filename:
                        # Save to temp directory
                        temp_path = temp_dir / secure_filename(uploaded_file.filename)
                        uploaded_file.save(str(temp_path))
                        additional_ref_images.append(str(temp_path))
            except Exception as e:
                # Clean up temp directory on error
                if temp_dir and temp_dir.exists():
                    shutil.rmtree(temp_dir)
                raise e
        
        # Create async task for image editing
        task = Task(
            project_id=project_id,
            task_type='EDIT_PAGE_IMAGE',
            status='PENDING'
        )
        task.set_progress({
            'total': 1,
            'completed': 0,
            'failed': 0
        })
        db.session.add(task)
        db.session.commit()
        
        # Get app instance for background task
        app = current_app._get_current_object()
        
        # Submit background task
        task_manager.submit_task(
            task.id,
            edit_page_image_task,
            project_id,
            page_id,
            data['edit_instruction'],
            ai_service,
            file_service,
            current_app.config['DEFAULT_ASPECT_RATIO'],
            current_app.config['DEFAULT_RESOLUTION'],
            original_description,
            additional_ref_images if additional_ref_images else None,
            str(temp_dir) if temp_dir else None,
            app
        )
        
        # Return task_id immediately
        return success_response({
            'task_id': task.id,
            'page_id': page_id,
            'status': 'PENDING'
        }, status_code=202)
    
    except Exception as e:
        db.session.rollback()
        return error_response('AI_SERVICE_ERROR', str(e), 503)



@page_bp.route('/edit-standalone-image', methods=['POST'])
def edit_standalone_image():
    """
    POST /api/projects/edit-standalone-image - Edit a standalone image with AI
    
    This API allows editing any image (not tied to a project) using AI.
    Useful for modifying pages from existing PPT files.
    
    Request body (multipart/form-data):
        - image: The image file to edit (required)
        - edit_instruction: Natural language edit instruction (required)
    
    OR JSON body:
        - image_url: URL to the image (required)
        - edit_instruction: Natural language edit instruction (required)
    
    Returns:
        JSON with edited image URL
    """
    try:
        from services.ai_service_manager import get_ai_service
        import tempfile
        import os
        import uuid
        from PIL import Image as PILImage
        import requests
        import io
        
        ai_service = get_ai_service()
        
        # Parse request
        if request.is_json:
            data = request.get_json()
            image_url = data.get('image_url')
            edit_instruction = data.get('edit_instruction')
            
            if not image_url:
                return bad_request("image_url is required for JSON request")
            
            # Download image from URL
            response = requests.get(image_url, timeout=30)
            response.raise_for_status()
            img = PILImage.open(io.BytesIO(response.content))
            
            # Save to temp file
            with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as tmp:
                if img.mode in ('RGBA', 'LA', 'P'):
                    img = img.convert('RGB')
                img.save(tmp, format='PNG')
                image_path = tmp.name
        else:
            # multipart/form-data
            if 'image' not in request.files:
                return bad_request("image file is required")
            
            image_file = request.files['image']
            edit_instruction = request.form.get('edit_instruction')
            
            # Save uploaded file to temp
            with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as tmp:
                image_file.save(tmp)
                image_path = tmp.name
        
        if not edit_instruction:
            return bad_request("edit_instruction is required")
        
        logger.info(f"Editing standalone image with instruction: {edit_instruction[:50]}...")
        
        # Edit image using AI
        edited_image = ai_service.edit_image(
            edit_instruction,
            image_path,
            aspect_ratio=current_app.config.get('DEFAULT_ASPECT_RATIO', '16:9'),
            resolution=current_app.config.get('DEFAULT_RESOLUTION', '2K'),
            original_description=None,
            additional_ref_images=None
        )
        
        # Clean up temp input file
        if os.path.exists(image_path):
            os.remove(image_path)
        
        if not edited_image:
            return error_response('AI_SERVICE_ERROR', 'Failed to edit image', 503)
        
        # Convert Google GenAI Image to PIL Image if needed
        if not isinstance(edited_image, PILImage.Image):
            if hasattr(edited_image, '_pil_image'):
                edited_image = edited_image._pil_image
            else:
                return error_response('SERVER_ERROR', f'Unexpected image type: {type(edited_image)}', 500)
        
        # Save edited image to uploads folder
        output_filename = f"standalone_edit_{uuid.uuid4().hex[:8]}.png"
        output_dir = Path(current_app.config['UPLOAD_FOLDER']) / 'standalone_edits'
        output_dir.mkdir(parents=True, exist_ok=True)
        output_path = output_dir / output_filename
        
        if edited_image.mode in ('RGBA', 'LA', 'P'):
            edited_image = edited_image.convert('RGB')
        edited_image.save(str(output_path), format='PNG')
        
        # Build download URL
        download_path = f"/files/standalone_edits/{output_filename}"
        base_url = request.url_root.rstrip("/")
        download_url_absolute = f"{base_url}{download_path}"
        
        logger.info(f"Standalone image edited successfully: {output_path}")
        
        return success_response({
            'image_url': download_path,
            'image_url_absolute': download_url_absolute
        })
    
    except requests.exceptions.RequestException as e:
        return error_response('NETWORK_ERROR', f'Failed to download image: {str(e)}', 400)
    except Exception as e:
        logger.exception("Error editing standalone image")
        return error_response('SERVER_ERROR', str(e), 500)


@page_bp.route('/<project_id>/pages/<page_id>/image-versions', methods=['GET'])
def get_page_image_versions(project_id, page_id):
    """
    GET /api/projects/{project_id}/pages/{page_id}/image-versions - Get all image versions for a page
    """
    try:
        page = Page.query.get(page_id)
        
        if not page or page.project_id != project_id:
            return not_found('Page')
        
        versions = PageImageVersion.query.filter_by(page_id=page_id)\
            .order_by(PageImageVersion.version_number.desc()).all()
        
        return success_response({
            'versions': [v.to_dict() for v in versions]
        })
    
    except Exception as e:
        return error_response('SERVER_ERROR', str(e), 500)


@page_bp.route('/edit-pptx-slide', methods=['POST'])
def edit_pptx_slide():
    """
    POST /api/projects/edit-pptx-slide - Edit a slide in an existing PPTX file
    
    This API allows editing a specific slide in a PPTX file using AI.
    It extracts the slide image, edits it with AI, and replaces it back.
    
    Request (multipart/form-data):
        - pptx_file: The PPTX file (required)
        - slide_index: Slide index (1-based, required)
        - edit_instruction: Natural language edit instruction (required)
        - model_config: AI model configuration JSON (optional, for API key and model settings)
    
    Returns:
        Modified PPTX file as download
    """
    try:
        from services.ai_service_manager import get_ai_service
        from services.export_service import ExportService
        import tempfile
        import os
        import uuid
        import json
        
        # Parse model_config if provided (for using main backend's AI configuration)
        model_config_str = request.form.get('model_config')
        model_config = None
        if model_config_str:
            try:
                model_config = json.loads(model_config_str)
                logger.info(f"[DEBUG] edit_pptx_slide received model_config: provider={model_config.get('provider')}, image_model={model_config.get('image_model')}")
            except json.JSONDecodeError as e:
                logger.warning(f"Failed to parse model_config: {e}")
        
        # Get AI service with model config (uses main backend's API key and model)
        ai_service = get_ai_service(model_config=model_config)
        
        # Validate request
        if 'pptx_file' not in request.files:
            return bad_request("pptx_file is required")
        
        pptx_file = request.files['pptx_file']
        slide_index_str = request.form.get('slide_index')
        edit_instruction = request.form.get('edit_instruction')
        
        if not slide_index_str:
            return bad_request("slide_index is required")
        
        try:
            slide_index = int(slide_index_str)
        except ValueError:
            return bad_request("slide_index must be an integer")
        
        if not edit_instruction:
            return bad_request("edit_instruction is required")
        
        logger.info(f"Editing PPTX slide {slide_index} with instruction: {edit_instruction[:50]}...")
        
        # Save uploaded file to temp
        with tempfile.NamedTemporaryFile(suffix='.pptx', delete=False) as tmp:
            pptx_file.save(tmp)
            input_pptx_path = tmp.name
        
        # Create output path
        output_pptx_path = tempfile.mktemp(suffix='.pptx')
        
        # Edit the slide
        success, message, result_path = ExportService.edit_slide_with_ai(
            pptx_path=input_pptx_path,
            slide_index=slide_index,
            edit_instruction=edit_instruction,
            ai_service=ai_service,
            output_path=output_pptx_path
        )
        
        # Clean up input file
        if os.path.exists(input_pptx_path):
            os.remove(input_pptx_path)
        
        if not success:
            if os.path.exists(output_pptx_path):
                os.remove(output_pptx_path)
            return error_response('EDIT_FAILED', message, 400)
        
        # Save edited file to uploads folder for download
        output_filename = f"edited_slide_{uuid.uuid4().hex[:8]}.pptx"
        output_dir = Path(current_app.config['UPLOAD_FOLDER']) / 'edited_pptx'
        output_dir.mkdir(parents=True, exist_ok=True)
        final_output_path = output_dir / output_filename
        
        # Move temp file to output dir
        import shutil
        shutil.move(output_pptx_path, str(final_output_path))
        
        # Build download URL
        download_path = f"/files/edited_pptx/{output_filename}"
        base_url = request.url_root.rstrip("/")
        download_url_absolute = f"{base_url}{download_path}"
        
        logger.info(f"PPTX slide edited successfully: {final_output_path}")
        
        return success_response({
            'download_url': download_path,
            'download_url_absolute': download_url_absolute,
            'message': message,
            'slide_index': slide_index
        })
    
    except Exception as e:
        logger.exception("Error editing PPTX slide")
        return error_response('SERVER_ERROR', str(e), 500)


@page_bp.route('/<project_id>/pages/<page_id>/image-versions/<version_id>/set-current', methods=['POST'])
def set_current_image_version(project_id, page_id, version_id):
    """
    POST /api/projects/{project_id}/pages/{page_id}/image-versions/{version_id}/set-current
    Set a specific version as the current one
    """
    try:
        page = Page.query.get(page_id)
        
        if not page or page.project_id != project_id:
            return not_found('Page')
        
        version = PageImageVersion.query.get(version_id)
        
        if not version or version.page_id != page_id:
            return not_found('Image Version')
        
        # Mark all versions as not current
        PageImageVersion.query.filter_by(page_id=page_id).update({'is_current': False})
        
        # Set this version as current
        version.is_current = True
        page.generated_image_path = version.image_path
        page.updated_at = datetime.utcnow()
        
        db.session.commit()
        
        return success_response(page.to_dict(include_versions=True))
    
    except Exception as e:
        db.session.rollback()
        return error_response('SERVER_ERROR', str(e), 500)
