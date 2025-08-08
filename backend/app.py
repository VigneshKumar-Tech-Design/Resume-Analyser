import os
from flask import Flask, request, jsonify
from werkzeug.utils import secure_filename
from flask_cors import CORS
import PyPDF2
import docx
from dotenv import load_dotenv
import re
from datetime import datetime
import ollama
from concurrent.futures import ThreadPoolExecutor, TimeoutError
import functools

# Load environment variables
load_dotenv()

app = Flask(__name__)
CORS(app)

# Configuration
UPLOAD_FOLDER = 'uploads'
ALLOWED_EXTENSIONS = {'pdf', 'doc', 'docx', 'txt'}
MAX_CONTENT_LENGTH = 5 * 1024 * 1024  # 5MB
PROCESSING_TIMEOUT = 180  # 3 minutes

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = MAX_CONTENT_LENGTH

# Ollama configuration
OLLAMA_MODEL = os.getenv('OLLAMA_MODEL', 'llama3')

# Create upload directory if it doesn't exist
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def extract_text_from_file(filepath, filename):
    try:
        if filename.endswith('.pdf'):
            with open(filepath, 'rb') as file:
                reader = PyPDF2.PdfReader(file)
                text = ""
                for page in reader.pages:
                    text += page.extract_text()
                return text
        elif filename.endswith(('.doc', '.docx')):
            doc = docx.Document(filepath)
            return "\n".join([para.text for para in doc.paragraphs])
        elif filename.endswith('.txt'):
            with open(filepath, 'r', encoding='utf-8') as file:
                return file.read()
    except Exception as e:
        print(f"Error extracting file: {e}")
        return None

def clean_text(text):
    """Clean and normalize extracted text"""
    if not text:
        return None
    text = re.sub(r'\s+', ' ', text)
    return text.strip()

def analyze_with_ollama(resume_text, job_title, experience_level):
    """Analyze resume using Ollama with timeout protection"""
    prompt = f"""
    Analyze this resume for a {job_title} position ({experience_level} level) and provide:
    
    1. Scores (0-100) in this exact format:
    Overall Score: [0-100]
    ATS Compatibility: [0-100]
    Content Quality: [0-100]
    Keyword Optimization: [0-100]
    Formatting: [0-100]
    
    2. Specific improvement suggestions as bullet points:
    - First suggestion
    - Second suggestion
    - Third suggestion
    
    Resume Content:
    {resume_text[:6000]}
    """
    
    try:
        response = ollama.generate(
            model=OLLAMA_MODEL,
            prompt=prompt,
            options={
                'temperature': 0.5,
                'num_ctx': 4096,
                'num_predict': 400,
                'top_k': 40,
                'top_p': 0.9
            }
        )
        return response['response']
    except Exception as e:
        print(f"Ollama API error: {str(e)}")
        return None

def parse_llm_response(response):
    """Parse response with strict validation"""
    if not response:
        return {'error': 'Empty response from AI model', 'success': False}
    
    try:
        result = {
            'scores': {},
            'feedback': {
                'detailedFeedback': []
            }
        }
        
        # Score extraction
        score_patterns = {
            'overall_score': r'Overall Score:\s*(\d+)',
            'ats': r'ATS Compatibility:\s*(\d+)',
            'content': r'Content Quality:\s*(\d+)',
            'keyword': r'Keyword Optimization:\s*(\d+)',
            'format': r'Formatting:\s*(\d+)'
        }
        
        for key, pattern in score_patterns.items():
            match = re.search(pattern, response, re.IGNORECASE)
            if match:
                score = min(100, max(0, int(match.group(1))))
                if key == 'overall_score':
                    result['overall_score'] = score
                else:
                    result['scores'][key] = score
        
        # Verify we got all required scores
        if not result.get('overall_score') or len(result['scores']) < 4:
            return {
                'error': 'Incomplete score data in response',
                'response_sample': response[:300],
                'success': False
            }

        # Feedback extraction
        feedback_items = re.findall(r'-\s*(.+?)(?=\n-|\n\n|\Z)', response, re.DOTALL)
        if feedback_items:
            for item in feedback_items[:10]:  # Limit to 5 suggestions
                item = item.strip()
                if len(item) < 15:  # Minimum length check
                    continue
                    
                result['feedback']['detailedFeedback'].append({
                    'type': (
                        'positive' if re.search(r'\b(excellent|strong|good)\b', item, re.I) else
                        'negative' if re.search(r'\b(improve|weak|lack|missing)\b', item, re.I) else
                        'neutral'
                    ),
                    'title': 'Suggestion',
                    'message': item
                })
        
        if not result['feedback']['detailedFeedback']:
            return {
                'success': True,
                'result': result,
                'warning': 'No actionable feedback suggestions were generated'
            }
        
        return {'success': True, 'result': result}
    
    except Exception as e:
        return {
            'error': f'Error parsing response: {str(e)}',
            'response_sample': response[:300],
            'success': False
        }

@app.route('/api/analyze', methods=['POST'])
def analyze_resume():
    if 'resume' not in request.files:
        return jsonify({'error': 'No file uploaded', 'success': False}), 400
    
    file = request.files['resume']
    job_title = request.form.get('job_title', '').strip()
    experience_level = request.form.get('experience_level', 'mid')
    
    if not file or file.filename == '':
        return jsonify({'error': 'No selected file', 'success': False}), 400
    
    if not allowed_file(file.filename):
        return jsonify({'error': 'Invalid file type', 'success': False}), 400
    
    if not job_title:
        return jsonify({'error': 'Job title is required', 'success': False}), 400
    
    try:
        # Save file
        filename = secure_filename(f"{datetime.now().timestamp()}-{file.filename}")
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(filepath)
        
        # Extract and clean text
        text = extract_text_from_file(filepath, filename)
        if not text:
            return jsonify({'error': 'Could not extract text from file', 'success': False}), 400
        
        cleaned_text = clean_text(text)
        if not cleaned_text:
            return jsonify({'error': 'Extracted text was empty', 'success': False}), 400
        
        # Process with timeout
        with ThreadPoolExecutor() as executor:
            future = executor.submit(
                functools.partial(
                    analyze_with_ollama,
                    cleaned_text, job_title, experience_level
                )
            )
            try:
                llm_response = future.result(timeout=PROCESSING_TIMEOUT)
            except TimeoutError:
                return jsonify({
                    'error': 'Analysis timed out. Please try a shorter resume.',
                    'success': False
                }), 504
        
        # Parse response
        parsed = parse_llm_response(llm_response)
        if not parsed.get('success'):
            return jsonify(parsed), 400
        
        return jsonify({
            'success': True,
            'result': parsed['result'],
            'filename': filename,
            'truncated': len(cleaned_text) > 3000,
            'warning': parsed.get('warning')
        })
        
    except Exception as e:
        return jsonify({
            'error': f'Server error: {str(e)}',
            'success': False
        }), 500

@app.route('/api/health', methods=['GET'])
def health_check():
    try:
        return jsonify({
            'status': 'running',
            'service': 'resume-analyzer',
            'version': '1.0'
        })
    except Exception as e:
        return jsonify({
            'status': 'error',
            'error': str(e)
        }), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)