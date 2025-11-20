// Global state
let selectedFiles = [];
let pendingVerifications = []; // Store extracted data pending verification

// DOM elements
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const fileList = document.getElementById('fileList');
const uploadBtn = document.getElementById('uploadBtn');
const uploadProgress = document.getElementById('uploadProgress');
const progressBar = document.getElementById('progressBar');
const progressText = document.getElementById('progressText');
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

// Upload files - now extracts but doesn't save
uploadBtn.addEventListener('click', async () => {
    if (selectedFiles.length === 0) return;
    
    uploadBtn.disabled = true;
    uploadProgress.classList.remove('hidden');
    progressBar.style.width = '0%';
    progressText.textContent = 'Uploading and extracting data...';
    
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
        progressText.textContent = `Extraction complete! Please verify data below.`;
        
        // Store results for verification
        pendingVerifications = response.data.results.filter(r => r.status === 'success');
        
        // Show results summary
        const successCount = pendingVerifications.length;
        const failCount = response.data.results.filter(r => r.status === 'failed').length;
        
        if (failCount > 0) {
            alert(`Extraction complete!\n✓ Success: ${successCount}\n✗ Failed: ${failCount}\n\nPlease verify the extracted data and click "Save to Table" to save.`);
        }
        
        // Reset form
        selectedFiles = [];
        fileInput.value = '';
        updateFileList();
        
        // Display verification results
        displayVerificationResults();
        
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

// Display verification results
function displayVerificationResults() {
    if (pendingVerifications.length === 0) {
        resultsContainer.innerHTML = `
            <p class="text-gray-500 text-center py-8">No data pending verification. Upload some images to get started!</p>
        `;
        return;
    }
    
    resultsContainer.innerHTML = `
        <div class="bg-yellow-50 border-2 border-yellow-400 rounded-lg p-4 mb-6">
            <div class="flex items-start gap-3">
                <i class="fas fa-exclamation-triangle text-yellow-600 text-2xl mt-1"></i>
                <div class="flex-1">
                    <h3 class="font-bold text-yellow-800 text-lg mb-2">Please Verify Extracted Data</h3>
                    <p class="text-yellow-700 mb-4">Review the extracted information below and make any corrections if needed. Click "Save to Table" when you're ready to save all verified data.</p>
                    <div class="flex gap-3">
                        <button onclick="saveAllToTable()" class="bg-green-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-green-700 transition-colors flex items-center gap-2">
                            <i class="fas fa-save"></i>
                            Save All to Table (${pendingVerifications.length} records)
                        </button>
                        <button onclick="discardAll()" class="bg-red-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-red-700 transition-colors flex items-center gap-2">
                            <i class="fas fa-trash"></i>
                            Discard All
                        </button>
                    </div>
                </div>
            </div>
        </div>
        
        ${pendingVerifications.map((result, index) => {
            const data = result.parsedData || {};
            return `
                <div class="border-2 border-blue-300 bg-blue-50 rounded-lg p-6 mb-4">
                    <div class="flex justify-between items-start mb-4">
                        <div>
                            <h3 class="font-bold text-gray-800 text-lg flex items-center gap-2">
                                <i class="fas fa-file-image text-blue-600"></i>
                                ${result.filename}
                            </h3>
                            <span class="inline-block px-3 py-1 bg-blue-600 text-white text-xs font-semibold rounded-full mt-2">
                                ${result.extractionMethod || 'Extracted'}
                            </span>
                        </div>
                        <button onclick="removeVerification(${index})" class="text-red-600 hover:text-red-800 font-semibold">
                            <i class="fas fa-times"></i> Remove
                        </button>
                    </div>
                    
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 bg-white rounded-lg p-4">
                        <div>
                            <label class="block text-sm font-semibold text-gray-700 mb-1">Class</label>
                            <input type="text" id="class_${index}" value="${data.Class || ''}" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                        </div>
                        <div>
                            <label class="block text-sm font-semibold text-gray-700 mb-1">Subject</label>
                            <input type="text" id="subject_${index}" value="${data.Subject || ''}" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                        </div>
                        <div class="md:col-span-2">
                            <label class="block text-sm font-semibold text-gray-700 mb-1">Teacher-in-charge</label>
                            <input type="text" id="teacher_${index}" value="${data.Teacher_in_charge || ''}" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                        </div>
                        <div>
                            <label class="block text-sm font-semibold text-gray-700 mb-1">No. of Pages (Original)</label>
                            <input type="number" id="pages_${index}" value="${data.No_of_pages_original_copy || ''}" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                        </div>
                        <div>
                            <label class="block text-sm font-semibold text-gray-700 mb-1">No. of Copies</label>
                            <input type="number" id="copies_${index}" value="${data.No_of_copies || ''}" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                        </div>
                        <div>
                            <label class="block text-sm font-semibold text-gray-700 mb-1">Total Printed Pages</label>
                            <input type="number" id="total_${index}" value="${data.Total_No_of_printed_pages || ''}" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                        </div>
                        <div>
                            <label class="block text-sm font-semibold text-gray-700 mb-1">Ricoh (if circled)</label>
                            <input type="text" id="ricoh_${index}" value="${data.Ricoh || ''}" class="w-full px-3 py-2 border border-gray-300 rounded-lg bg-yellow-50 focus:ring-2 focus:ring-blue-500">
                        </div>
                        <div>
                            <label class="block text-sm font-semibold text-gray-700 mb-1">Toshiba (if circled)</label>
                            <input type="text" id="toshiba_${index}" value="${data.Toshiba || ''}" class="w-full px-3 py-2 border border-gray-300 rounded-lg bg-blue-50 focus:ring-2 focus:ring-blue-500">
                        </div>
                    </div>
                </div>
            `;
        }).join('')}
    `;
}

// Remove single verification
function removeVerification(index) {
    if (confirm('Remove this record from verification?')) {
        pendingVerifications.splice(index, 1);
        displayVerificationResults();
    }
}

// Discard all verifications
function discardAll() {
    if (confirm('Discard all extracted data without saving?')) {
        pendingVerifications = [];
        resultsContainer.innerHTML = `
            <p class="text-gray-500 text-center py-8">All data discarded. Upload some images to get started!</p>
        `;
    }
}

// Save all verified data to table
async function saveAllToTable() {
    if (pendingVerifications.length === 0) {
        alert('No data to save!');
        return;
    }
    
    if (!confirm(`Save ${pendingVerifications.length} verified record(s) to the table?`)) {
        return;
    }
    
    // Collect verified data from inputs
    const verifiedData = pendingVerifications.map((result, index) => ({
        imageId: result.imageId,
        filename: result.filename,
        data: {
            Class: document.getElementById(`class_${index}`).value,
            Subject: document.getElementById(`subject_${index}`).value,
            Teacher_in_charge: document.getElementById(`teacher_${index}`).value,
            No_of_pages_original_copy: parseInt(document.getElementById(`pages_${index}`).value) || null,
            No_of_copies: parseInt(document.getElementById(`copies_${index}`).value) || null,
            Total_No_of_printed_pages: parseInt(document.getElementById(`total_${index}`).value) || null,
            Ricoh: document.getElementById(`ricoh_${index}`).value,
            Toshiba: document.getElementById(`toshiba_${index}`).value
        }
    }));
    
    try {
        // Show saving progress
        resultsContainer.innerHTML = `
            <div class="text-center py-12">
                <i class="fas fa-spinner fa-spin text-6xl text-blue-600 mb-4"></i>
                <p class="text-xl text-gray-700 font-semibold">Saving ${verifiedData.length} record(s) to table...</p>
            </div>
        `;
        
        // Save to database via API
        const response = await axios.post('/api/save-verified', { records: verifiedData });
        
        // Success!
        alert(`✓ Successfully saved ${response.data.saved} record(s) to the table!`);
        
        // Clear pending verifications
        pendingVerifications = [];
        
        // Show success message
        resultsContainer.innerHTML = `
            <div class="bg-green-50 border-2 border-green-500 rounded-lg p-8 text-center">
                <i class="fas fa-check-circle text-6xl text-green-600 mb-4"></i>
                <h3 class="text-2xl font-bold text-green-800 mb-2">Data Saved Successfully!</h3>
                <p class="text-green-700 mb-6">${response.data.saved} record(s) have been saved to the table.</p>
                <a href="/table" class="inline-block bg-indigo-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-indigo-700 transition-colors">
                    <i class="fas fa-table mr-2"></i>
                    View Table
                </a>
            </div>
        `;
        
    } catch (error) {
        console.error('Save error:', error);
        alert('Failed to save data: ' + (error.response?.data?.error || error.message));
        displayVerificationResults(); // Show form again
    }
}

// Refresh button - no more loading images, just reset
refreshBtn.addEventListener('click', () => {
    pendingVerifications = [];
    resultsContainer.innerHTML = `
        <p class="text-gray-500 text-center py-8">Upload some images to get started!</p>
    `;
});

// Initialize
resultsContainer.innerHTML = `
    <p class="text-gray-500 text-center py-8">No data yet. Upload some images to get started!</p>
`;
