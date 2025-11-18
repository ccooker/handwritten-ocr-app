// Global state
let selectedFiles = [];

// DOM elements
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const fileList = document.getElementById('fileList');
const uploadBtn = document.getElementById('uploadBtn');
const uploadProgress = document.getElementById('uploadProgress');
const progressBar = document.getElementById('progressBar');
const progressText = document.getElementById('progressText');
const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const refreshBtn = document.getElementById('refreshBtn');
const resultsContainer = document.getElementById('resultsContainer');

// Drag and drop handlers
dropZone.addEventListener('click', () => fileInput.click());

dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    
    const files = Array.from(e.dataTransfer.files).filter(file => file.type.startsWith('image/'));
    handleFiles(files);
});

fileInput.addEventListener('change', (e) => {
    const files = Array.from(e.target.files).filter(file => file.type.startsWith('image/'));
    handleFiles(files);
});

// Handle selected files
function handleFiles(files) {
    selectedFiles = [...selectedFiles, ...files];
    updateFileList();
    uploadBtn.disabled = selectedFiles.length === 0;
}

// Update file list display
function updateFileList() {
    if (selectedFiles.length === 0) {
        fileList.innerHTML = '';
        return;
    }
    
    fileList.innerHTML = selectedFiles.map((file, index) => `
        <div class="flex items-center justify-between bg-gray-50 p-3 rounded-lg">
            <div class="flex items-center gap-3">
                <i class="fas fa-file-image text-blue-500 text-xl"></i>
                <div>
                    <p class="font-medium text-gray-800">${file.name}</p>
                    <p class="text-sm text-gray-500">${formatFileSize(file.size)}</p>
                </div>
            </div>
            <button onclick="removeFile(${index})" class="text-red-500 hover:text-red-700">
                <i class="fas fa-times"></i>
            </button>
        </div>
    `).join('');
}

// Remove file from list
function removeFile(index) {
    selectedFiles.splice(index, 1);
    updateFileList();
    uploadBtn.disabled = selectedFiles.length === 0;
}

// Format file size
function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

// Upload files
uploadBtn.addEventListener('click', async () => {
    if (selectedFiles.length === 0) return;
    
    uploadBtn.disabled = true;
    uploadProgress.classList.remove('hidden');
    progressBar.style.width = '0%';
    progressText.textContent = 'Uploading files...';
    
    const formData = new FormData();
    selectedFiles.forEach(file => {
        formData.append('files', file);
    });
    
    try {
        progressBar.style.width = '50%';
        
        const response = await axios.post('/api/upload', formData, {
            headers: {
                'Content-Type': 'multipart/form-data'
            }
        });
        
        progressBar.style.width = '100%';
        progressText.textContent = `Successfully processed ${response.data.processed} file(s)`;
        
        // Show results summary
        const successCount = response.data.results.filter(r => r.status === 'success').length;
        const failCount = response.data.results.filter(r => r.status === 'failed').length;
        
        alert(`Processing complete!\n✓ Success: ${successCount}\n✗ Failed: ${failCount}`);
        
        // Reset form
        selectedFiles = [];
        fileInput.value = '';
        updateFileList();
        
        // Refresh results
        loadImages();
        
        setTimeout(() => {
            uploadProgress.classList.add('hidden');
            uploadBtn.disabled = false;
        }, 2000);
        
    } catch (error) {
        console.error('Upload error:', error);
        progressText.textContent = 'Upload failed: ' + (error.response?.data?.error || error.message);
        progressBar.style.width = '0%';
        progressBar.classList.add('bg-red-600');
        
        setTimeout(() => {
            uploadProgress.classList.add('hidden');
            progressBar.classList.remove('bg-red-600');
            uploadBtn.disabled = false;
        }, 3000);
    }
});

// Load images
async function loadImages() {
    try {
        const response = await axios.get('/api/images');
        displayResults(response.data.images);
    } catch (error) {
        console.error('Error loading images:', error);
        resultsContainer.innerHTML = `
            <p class="text-red-500 text-center py-8">
                <i class="fas fa-exclamation-circle mr-2"></i>
                Error loading data: ${error.message}
            </p>
        `;
    }
}

// Display results
function displayResults(images) {
    if (!images || images.length === 0) {
        resultsContainer.innerHTML = `
            <p class="text-gray-500 text-center py-8">No data yet. Upload some images to get started!</p>
        `;
        return;
    }
    
    resultsContainer.innerHTML = images.map(img => {
        const statusColor = {
            'completed': 'text-green-600 bg-green-100',
            'pending': 'text-yellow-600 bg-yellow-100',
            'processing': 'text-blue-600 bg-blue-100',
            'failed': 'text-red-600 bg-red-100'
        }[img.processing_status] || 'text-gray-600 bg-gray-100';
        
        return `
            <div class="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
                <div class="flex justify-between items-start mb-3">
                    <div>
                        <h3 class="font-semibold text-gray-800 text-lg">${img.filename}</h3>
                        <p class="text-sm text-gray-500">
                            <i class="fas fa-calendar mr-1"></i>
                            ${new Date(img.upload_date).toLocaleString()}
                        </p>
                    </div>
                    <div class="flex items-center gap-2">
                        <span class="px-3 py-1 rounded-full text-xs font-semibold ${statusColor}">
                            ${img.processing_status.toUpperCase()}
                        </span>
                        <button onclick="deleteImage(${img.id})" class="text-red-500 hover:text-red-700">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
                
                ${img.extracted_text ? `
                    <div class="bg-gray-50 rounded-lg p-4 mb-2">
                        <h4 class="font-semibold text-gray-700 mb-2">
                            <i class="fas fa-file-alt mr-2 text-blue-500"></i>
                            Extracted Text:
                        </h4>
                        <p class="text-gray-800 whitespace-pre-wrap">${img.extracted_text}</p>
                        ${img.confidence ? `
                            <div class="mt-2 flex items-center gap-2">
                                <span class="text-sm text-gray-600">Confidence:</span>
                                <div class="flex-1 bg-gray-200 rounded-full h-2 max-w-xs">
                                    <div class="bg-green-500 h-2 rounded-full" style="width: ${img.confidence * 100}%"></div>
                                </div>
                                <span class="text-sm font-semibold text-gray-700">${(img.confidence * 100).toFixed(1)}%</span>
                            </div>
                        ` : ''}
                    </div>
                ` : img.processing_status === 'failed' ? `
                    <div class="bg-red-50 border border-red-200 rounded-lg p-3">
                        <p class="text-red-700">
                            <i class="fas fa-exclamation-triangle mr-2"></i>
                            Error: ${img.error_message || 'Processing failed'}
                        </p>
                    </div>
                ` : ''}
                
                <div class="text-xs text-gray-500 mt-2">
                    <span><i class="fas fa-file mr-1"></i> ${formatFileSize(img.file_size)}</span>
                    <span class="ml-3"><i class="fas fa-image mr-1"></i> ${img.mime_type}</span>
                    ${img.language ? `<span class="ml-3"><i class="fas fa-language mr-1"></i> ${img.language.toUpperCase()}</span>` : ''}
                </div>
            </div>
        `;
    }).join('');
}

// Delete image
async function deleteImage(id) {
    if (!confirm('Are you sure you want to delete this image and its data?')) {
        return;
    }
    
    try {
        await axios.delete(`/api/images/${id}`);
        loadImages();
    } catch (error) {
        console.error('Error deleting image:', error);
        alert('Failed to delete image: ' + error.message);
    }
}

// Search functionality
searchBtn.addEventListener('click', performSearch);
searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') performSearch();
});

async function performSearch() {
    const query = searchInput.value.trim();
    
    if (!query) {
        loadImages();
        return;
    }
    
    try {
        const response = await axios.get(`/api/search?q=${encodeURIComponent(query)}`);
        displayResults(response.data.results);
    } catch (error) {
        console.error('Search error:', error);
        resultsContainer.innerHTML = `
            <p class="text-red-500 text-center py-8">
                <i class="fas fa-exclamation-circle mr-2"></i>
                Search failed: ${error.message}
            </p>
        `;
    }
}

// Refresh button
refreshBtn.addEventListener('click', () => {
    searchInput.value = '';
    loadImages();
});

// Initialize - load existing data
loadImages();
