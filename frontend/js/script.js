document.addEventListener('DOMContentLoaded', function() {
    // DOM Elements
    const uploadArea = document.getElementById('upload-area');
    const fileInput = document.getElementById('resume-upload');
    const analyzeBtn = document.getElementById('analyze-btn');
    const jobTitleInput = document.getElementById('job-title');
    const experienceLevelSelect = document.getElementById('experience-level');
    const reviewSection = document.getElementById('review-section');
    const resultsSection = document.getElementById('results-section');
    const overallScoreElement = document.getElementById('overall-score');
    const overallFeedbackElement = document.getElementById('overall-feedback');
    const feedbackList = document.getElementById('feedback-list');
    const tryAnotherBtn = document.getElementById('try-another');
    const themeToggle = document.getElementById('theme-toggle');
    const themeIcon = themeToggle.querySelector('i');
    
    // Metrics elements
    const metrics = {
        ats: document.getElementById('ats-score'),
        content: document.getElementById('content-score'),
        keyword: document.getElementById('keyword-score'),
        format: document.getElementById('format-score')
    };
    
    // Initialize theme
    const currentTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', currentTheme);
    updateThemeIcon(currentTheme);
    
    // Set current year in footer
    document.getElementById('current-year').textContent = new Date().getFullYear();
    
    // Event Listeners
    uploadArea.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', handleFileSelect);
    analyzeBtn.addEventListener('click', analyzeResume);
    tryAnotherBtn.addEventListener('click', resetForm);
    themeToggle.addEventListener('click', toggleTheme);
    
    // Drag and Drop
    ['dragover', 'dragleave', 'drop'].forEach(event => {
        uploadArea.addEventListener(event, e => {
            e.preventDefault();
            e.stopPropagation();
            uploadArea.style.borderColor = 
                event === 'dragover' ? 'var(--primary-color)' : 'var(--border-color)';
            uploadArea.style.backgroundColor = 
                event === 'dragover' ? 'var(--light-gray)' : 'var(--card-bg)';
            if (event === 'drop' && e.dataTransfer.files.length) {
                fileInput.files = e.dataTransfer.files;
                updateFileDisplay(e.dataTransfer.files[0]);
            }
        });
    });
    
    // Functions
    function handleFileSelect(e) {
        if (e.target.files.length) updateFileDisplay(e.target.files[0]);
    }
    
    function updateFileDisplay(file) {
        const validTypes = ['pdf', 'doc', 'docx', 'txt'];
        const fileType = file.name.split('.').pop().toLowerCase();
        
        if (!validTypes.includes(fileType)) {
            alert('Please upload PDF, DOC, DOCX, or TXT');
            return;
        }
        
        uploadArea.innerHTML = `
            <i class="fas fa-file-alt"></i>
            <p>${file.name}</p>
            <small>${(file.size / 1024).toFixed(1)} KB</small>
        `;
        validateInputs();
    }
    
    function validateInputs() {
        analyzeBtn.disabled = !(fileInput.files.length && jobTitleInput.value.trim());
    }
    
    async function analyzeResume() {
        const file = fileInput.files[0];
        const jobTitle = jobTitleInput.value.trim();
        
        if (!file || !jobTitle) {
            alert('Please upload resume and enter job title');
            return;
        }
        
        analyzeBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Analyzing...';
        analyzeBtn.disabled = true;
        
        try {
            const formData = new FormData();
            formData.append('resume', file);
            formData.append('job_title', jobTitle);
            formData.append('experience_level', experienceLevelSelect.value);
            
            const response = await fetch('http://localhost:5000/api/analyze', {
                method: 'POST',
                body: formData
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Analysis failed');
            }
            
            const result = await response.json();
            
            if (!result.success) {
                if (result.error && result.error.includes('model')) {
                    showModelError();
                } else {
                    alert(result.error || 'Analysis failed');
                }
                return;
            }
            
            displayResults(result.result);
            reviewSection.classList.add('hidden');
            resultsSection.classList.remove('hidden');
            resultsSection.scrollIntoView({ behavior: 'smooth' });
            
        } catch (error) {
            console.error('Error:', error);
            if (error.message.includes('Failed to fetch')) {
                showConnectionError();
            } else {
                showModelError();
            }
        } finally {
            analyzeBtn.innerHTML = 'Analyze Resume';
            analyzeBtn.disabled = false;
        }
    }
    
    function displayResults(results) {
        // Overall Score
        overallScoreElement.textContent = results.overall_score;
        overallFeedbackElement.textContent = results.feedback.overallMessage;
        document.querySelector('.score-circle').style.backgroundColor = 
            getScoreColor(results.overall_score);
        
        // Metrics
        Object.keys(results.scores).forEach(metric => {
            const score = results.scores[metric];
            const element = metrics[metric];
            const fill = element.querySelector('.progress-fill');
            const feedback = element.querySelector('.metric-feedback');
            
            fill.style.width = `${score}%`;
            fill.style.backgroundColor = getScoreColor(score);
            feedback.textContent = getFeedbackText(score);
        });
        
        // Detailed Feedback
        feedbackList.innerHTML = '';
        results.feedback.detailedFeedback.forEach(item => {
            const feedbackItem = document.createElement('div');
            feedbackItem.className = `feedback-item feedback-${item.type || 'neutral'}`;
            feedbackItem.innerHTML = `
                <div class="feedback-icon">
                    <i class="fas ${getFeedbackIcon(item.type)}"></i>
                </div>
                <div class="feedback-content">
                    <h5>${item.title || 'Feedback'}</h5>
                    <p>${item.message}</p>
                </div>
            `;
            feedbackList.appendChild(feedbackItem);
        });

        // Debug: Log feedback data
        console.log("Feedback data:", results.feedback.detailedFeedback);

        // Clear and rebuild feedback
        feedbackList.innerHTML = '';
        
        if (results.feedback.detailedFeedback && results.feedback.detailedFeedback.length > 0) {
            results.feedback.detailedFeedback.forEach(item => {
            const feedbackItem = document.createElement('div');
            feedbackItem.className = `feedback-item feedback-${item.type || 'neutral'}`;
            feedbackItem.innerHTML = `
                <div class="feedback-icon">
                <i class="fas ${getFeedbackIcon(item.type)}"></i>
                </div>
                <div class="feedback-content">
                <h5>${item.title || 'Feedback'}</h5>
                <p>${item.message || 'No specific feedback provided.'}</p>
                </div>
            `;
            feedbackList.appendChild(feedbackItem);
            });
        } else {
            feedbackList.innerHTML = `
            <div class="feedback-item feedback-neutral">
                <p>No detailed feedback was generated for this resume.</p>
            </div>
            `;
        }

    }
    
    function getScoreColor(score) {
        return score >= 80 ? 'var(--success-color)' : 
               score >= 60 ? 'var(--warning-color)' : 'var(--danger-color)';
    }
    
    function getFeedbackText(score) {
        return score >= 80 ? 'Excellent' : 
               score >= 60 ? 'Good' : 'Needs Work';
    }
    
    function getFeedbackIcon(type) {
        return type === 'positive' ? 'fa-check-circle' : 
               type === 'negative' ? 'fa-exclamation-circle' : 'fa-info-circle';
    }
    
    function showModelError() {
        resultsSection.classList.remove('hidden');
        feedbackList.innerHTML = `
            <div class="llm-error">
                <i class="fas fa-robot"></i>
                <h3>Llama3 Model Required</h3>
                <p>Please ensure you have Llama3 installed:</p>
                <ol>
                    <li>Open terminal and run: <code>ollama pull llama3</code></li>
                    <li>Make sure Ollama is running: <code>ollama serve</code></li>
                    <li>Refresh this page and try again</li>
                </ol>
                <button id="retry-btn" class="btn btn-primary">Try Again</button>
            </div>
        `;
        document.getElementById('retry-btn').addEventListener('click', analyzeResume);
    }
    
    function showConnectionError() {
        resultsSection.classList.remove('hidden');
        feedbackList.innerHTML = `
            <div class="llm-error">
                <i class="fas fa-plug"></i>
                <h3>Connection Error</h3>
                <p>Could not connect to the analysis service:</p>
                <ol>
                    <li>Ensure the backend server is running</li>
                    <li>Check your network connection</li>
                    <li>Refresh this page and try again</li>
                </ol>
                <button id="retry-btn" class="btn btn-primary">Try Again</button>
            </div>
        `;
        document.getElementById('retry-btn').addEventListener('click', analyzeResume);
    }
    
    function resetForm() {
        fileInput.value = '';
        jobTitleInput.value = '';
        experienceLevelSelect.value = 'mid';
        uploadArea.innerHTML = `
            <i class="fas fa-cloud-upload-alt"></i>
            <p>Drag & drop your resume here or click to browse</p>
        `;
        analyzeBtn.disabled = true;
        reviewSection.classList.remove('hidden');
        resultsSection.classList.add('hidden');
        reviewSection.scrollIntoView({ behavior: 'smooth' });
    }
    
    function toggleTheme() {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const newTheme = currentTheme === 'light' ? 'dark' : 'light';
        
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
        updateThemeIcon(newTheme);
    }
    
    function updateThemeIcon(theme) {
        if (theme === 'dark') {
            themeIcon.classList.remove('fa-moon');
            themeIcon.classList.add('fa-sun');
        } else {
            themeIcon.classList.remove('fa-sun');
            themeIcon.classList.add('fa-moon');
        }
    }
    
    // Initial validation
    validateInputs();
    jobTitleInput.addEventListener('input', validateInputs);
});