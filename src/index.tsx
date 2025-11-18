import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from 'hono/cloudflare-workers'

type Bindings = {
  DB: D1Database;
  OCR_API_KEY?: string;
}

const app = new Hono<{ Bindings: Bindings }>()

// Enable CORS for API routes
app.use('/api/*', cors())

// Serve static files
app.use('/static/*', serveStatic({ root: './public' }))

// API route: Upload images and extract handwritten data
app.post('/api/upload', async (c) => {
  try {
    const formData = await c.req.formData()
    const files = formData.getAll('files') as File[]
    
    if (!files || files.length === 0) {
      return c.json({ error: 'No files uploaded' }, 400)
    }

    const { DB } = c.env
    const results = []

    for (const file of files) {
      // Validate file type
      if (!file.type.startsWith('image/')) {
        results.push({
          filename: file.name,
          status: 'failed',
          error: 'Invalid file type. Only images are allowed.'
        })
        continue
      }

      // Convert file to base64 for storage/OCR
      const arrayBuffer = await file.arrayBuffer()
      const base64 = arrayBufferToBase64(arrayBuffer)

      // Insert into database
      const insertResult = await DB.prepare(`
        INSERT INTO uploaded_images (filename, file_size, mime_type, processing_status)
        VALUES (?, ?, ?, ?)
      `).bind(file.name, file.size, file.type, 'pending').run()

      const imageId = insertResult.meta.last_row_id

      // Call OCR API (placeholder - will be implemented with actual OCR service)
      try {
        // For now, simulate OCR extraction
        const extractedText = await performOCR(base64, file.type, c.env)
        
        // Store extracted data
        await DB.prepare(`
          INSERT INTO extracted_data (image_id, extracted_text, confidence, language)
          VALUES (?, ?, ?, ?)
        `).bind(imageId, extractedText, 0.95, 'en').run()

        // Parse and store structured form data
        const parsedData = parsePrintingFormData(extractedText);
        await DB.prepare(`
          INSERT INTO printing_forms (
            image_id, RECEIVED_DATE, Class, Subject, Teacher_in_charge,
            Date_of_submission, Date_of_collection, Received_by,
            No_of_pages_original_copy, No_of_copies, Total_No_of_printed_pages,
            Other_request_Single_sided, Other_request_Double_sided,
            Other_request_Stapling, Other_request_No_stapling_required,
            Other_request_White_paper, Other_request_Newsprint_paper,
            Remarks, Signed_by, For_office_use_RICOH, For_office_use_Toshiba,
            Table_Form, Table_Class, Table_No_of_copies, Table_Teacher_in_Charge
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          imageId, parsedData.RECEIVED_DATE, parsedData.Class, parsedData.Subject,
          parsedData.Teacher_in_charge, parsedData.Date_of_submission,
          parsedData.Date_of_collection, parsedData.Received_by,
          parsedData.No_of_pages_original_copy, parsedData.No_of_copies,
          parsedData.Total_No_of_printed_pages, parsedData.Other_request_Single_sided,
          parsedData.Other_request_Double_sided, parsedData.Other_request_Stapling,
          parsedData.Other_request_No_stapling_required, parsedData.Other_request_White_paper,
          parsedData.Other_request_Newsprint_paper, parsedData.Remarks,
          parsedData.Signed_by, parsedData.For_office_use_RICOH,
          parsedData.For_office_use_Toshiba, parsedData.Table_Form,
          parsedData.Table_Class, parsedData.Table_No_of_copies,
          parsedData.Table_Teacher_in_Charge
        ).run()

        // Update status to completed
        await DB.prepare(`
          UPDATE uploaded_images SET processing_status = ? WHERE id = ?
        `).bind('completed', imageId).run()

        results.push({
          filename: file.name,
          status: 'success',
          imageId: imageId,
          extractedText: extractedText,
          parsedData: parsedData
        })
      } catch (ocrError: any) {
        // Update status to failed
        await DB.prepare(`
          UPDATE uploaded_images SET processing_status = ?, error_message = ? WHERE id = ?
        `).bind('failed', ocrError.message, imageId).run()

        results.push({
          filename: file.name,
          status: 'failed',
          error: ocrError.message
        })
      }
    }

    return c.json({ 
      success: true, 
      processed: results.length,
      results 
    })
  } catch (error: any) {
    return c.json({ error: error.message }, 500)
  }
})

// API route: Get all uploaded images with their extracted data
app.get('/api/images', async (c) => {
  try {
    const { DB } = c.env
    
    const result = await DB.prepare(`
      SELECT 
        ui.id,
        ui.filename,
        ui.file_size,
        ui.mime_type,
        ui.upload_date,
        ui.processing_status,
        ui.error_message,
        ed.extracted_text,
        ed.confidence,
        ed.language,
        ed.extraction_date
      FROM uploaded_images ui
      LEFT JOIN extracted_data ed ON ui.id = ed.image_id
      ORDER BY ui.upload_date DESC
    `).all()

    return c.json({ success: true, images: result.results })
  } catch (error: any) {
    return c.json({ error: error.message }, 500)
  }
})

// API route: Get specific image data
app.get('/api/images/:id', async (c) => {
  try {
    const { DB } = c.env
    const id = c.req.param('id')
    
    const imageResult = await DB.prepare(`
      SELECT * FROM uploaded_images WHERE id = ?
    `).bind(id).first()

    if (!imageResult) {
      return c.json({ error: 'Image not found' }, 404)
    }

    const dataResult = await DB.prepare(`
      SELECT * FROM extracted_data WHERE image_id = ?
    `).bind(id).all()

    return c.json({ 
      success: true, 
      image: imageResult,
      extractedData: dataResult.results
    })
  } catch (error: any) {
    return c.json({ error: error.message }, 500)
  }
})

// API route: Search extracted data
app.get('/api/search', async (c) => {
  try {
    const { DB } = c.env
    const query = c.req.query('q')
    
    if (!query) {
      return c.json({ error: 'Search query required' }, 400)
    }

    const result = await DB.prepare(`
      SELECT 
        ui.id,
        ui.filename,
        ui.upload_date,
        ed.extracted_text,
        ed.confidence
      FROM uploaded_images ui
      INNER JOIN extracted_data ed ON ui.id = ed.image_id
      WHERE ed.extracted_text LIKE ?
      ORDER BY ui.upload_date DESC
    `).bind(`%${query}%`).all()

    return c.json({ success: true, results: result.results })
  } catch (error: any) {
    return c.json({ error: error.message }, 500)
  }
})

// API route: Get all printing forms in table format
app.get('/api/printing-forms', async (c) => {
  try {
    const { DB } = c.env
    
    const result = await DB.prepare(`
      SELECT 
        pf.*,
        ui.filename,
        ui.upload_date
      FROM printing_forms pf
      INNER JOIN uploaded_images ui ON pf.image_id = ui.id
      ORDER BY pf.created_at DESC
    `).all()

    return c.json({ success: true, forms: result.results })
  } catch (error: any) {
    return c.json({ error: error.message }, 500)
  }
})

// API route: Get specific printing form
app.get('/api/printing-forms/:id', async (c) => {
  try {
    const { DB } = c.env
    const id = c.req.param('id')
    
    const result = await DB.prepare(`
      SELECT 
        pf.*,
        ui.filename,
        ui.upload_date,
        ed.extracted_text
      FROM printing_forms pf
      INNER JOIN uploaded_images ui ON pf.image_id = ui.id
      LEFT JOIN extracted_data ed ON pf.image_id = ed.image_id
      WHERE pf.id = ?
    `).bind(id).first()

    if (!result) {
      return c.json({ error: 'Form not found' }, 404)
    }

    return c.json({ success: true, form: result })
  } catch (error: any) {
    return c.json({ error: error.message }, 500)
  }
})

// API route: Delete image and its data
app.delete('/api/images/:id', async (c) => {
  try {
    const { DB } = c.env
    const id = c.req.param('id')
    
    // Delete from database (cascade will handle extracted_data)
    await DB.prepare(`
      DELETE FROM uploaded_images WHERE id = ?
    `).bind(id).run()

    return c.json({ success: true, message: 'Image deleted successfully' })
  } catch (error: any) {
    return c.json({ error: error.message }, 500)
  }
})

// Helper function to convert ArrayBuffer to base64 (handles large files)
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 8192; // Process in chunks to avoid stack overflow
  
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.slice(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  
  return btoa(binary);
}

// OCR function - OCR.space API integration
async function performOCR(base64Image: string, mimeType: string, env: any): Promise<string> {
  const apiKey = env.OCR_API_KEY;
  
  if (!apiKey) {
    throw new Error('OCR_API_KEY not configured. Please add it to .dev.vars or Cloudflare secrets.');
  }
  
  try {
    // Try multiple OCR engines for best results
    let bestResult = '';
    let bestConfidence = 0;
    
    // Engine 2: Best for handwriting and printed text
    const result2 = await tryOCREngine(base64Image, mimeType, apiKey, '2');
    if (result2.confidence > bestConfidence) {
      bestResult = result2.text;
      bestConfidence = result2.confidence;
    }
    
    // Engine 1: Alternative engine for comparison
    try {
      const result1 = await tryOCREngine(base64Image, mimeType, apiKey, '1');
      if (result1.confidence > bestConfidence) {
        bestResult = result1.text;
        bestConfidence = result1.confidence;
      }
    } catch (e) {
      // Engine 1 failed, continue with Engine 2 result
      console.log('Engine 1 failed, using Engine 2 result');
    }
    
    if (!bestResult || bestResult.trim() === '') {
      return 'No text detected in the image. Try:\n- Higher resolution scan (300+ DPI)\n- Better lighting\n- Straighten the image\n- Increase contrast';
    }
    
    return bestResult.trim();
  } catch (error: any) {
    console.error('OCR Error:', error);
    throw new Error(`OCR processing failed: ${error.message}`);
  }
}

// Helper function to try different OCR engines
async function tryOCREngine(base64Image: string, mimeType: string, apiKey: string, engine: string): Promise<{text: string, confidence: number}> {
  const formData = new FormData();
  formData.append('base64Image', `data:${mimeType};base64,${base64Image}`);
  formData.append('language', 'eng');
  formData.append('isOverlayRequired', 'false');
  formData.append('detectOrientation', 'true');
  formData.append('scale', 'true');
  formData.append('OCREngine', engine);
  
  // Enhanced parameters for better accuracy
  formData.append('isTable', 'true'); // Better table detection
  formData.append('detectCheckbox', 'true'); // Detect checkboxes
  
  const response = await fetch('https://api.ocr.space/parse/image', {
    method: 'POST',
    headers: {
      'apikey': apiKey,
    },
    body: formData
  });
  
  if (!response.ok) {
    throw new Error(`OCR API request failed: ${response.status} ${response.statusText}`);
  }
  
  const data: any = await response.json();
  
  if (data.IsErroredOnProcessing) {
    const errorMessage = data.ErrorMessage?.[0] || 'OCR processing failed';
    throw new Error(errorMessage);
  }
  
  const extractedText = data.ParsedResults?.[0]?.ParsedText || '';
  
  // Calculate confidence based on text length and quality
  let confidence = 0;
  if (extractedText && extractedText.trim().length > 0) {
    // Basic confidence calculation
    confidence = Math.min(extractedText.length / 100, 1.0);
    
    // Bonus for having expected keywords
    const keywords = ['date', 'class', 'teacher', 'subject', 'received', 'submission', 'collection'];
    const foundKeywords = keywords.filter(k => extractedText.toLowerCase().includes(k)).length;
    confidence += (foundKeywords / keywords.length) * 0.5;
  }
  
  return {
    text: extractedText,
    confidence: confidence
  };
}

// Parse printing form data from OCR text
function parsePrintingFormData(ocrText: string): any {
  const data: any = {};
  
  // Helper function to extract value after a label
  const extractValue = (text: string, labels: string[]): string => {
    for (const label of labels) {
      const regex = new RegExp(label + '\\s*:?\\s*([^\\n\\r]+)', 'i');
      const match = text.match(regex);
      if (match && match[1]) {
        return match[1].trim();
      }
    }
    return '';
  };
  
  // Helper function to check if text contains checkbox markers
  const hasCheckbox = (text: string, labels: string[]): boolean => {
    for (const label of labels) {
      const regex = new RegExp(`[\\[\\(]?[xX✓√]?[\\]\\)]?\\s*${label}`, 'i');
      if (regex.test(text)) {
        return true;
      }
    }
    return false;
  };
  
  // Extract main fields
  data.RECEIVED_DATE = extractValue(ocrText, ['RECEIVED DATE', 'Received Date', 'Date Received', 'REC DATE']);
  data.Class = extractValue(ocrText, ['Class', 'CLASS']);
  data.Subject = extractValue(ocrText, ['Subject', 'SUBJECT']);
  data.Teacher_in_charge = extractValue(ocrText, ['Teacher in charge', 'Teacher-in-charge', 'Teacher', 'Teacher in Charge', 'TEACHER IN CHARGE']);
  data.Date_of_submission = extractValue(ocrText, ['Date of submission', 'Submission Date', 'Date of Submission', 'DATE OF SUBMISSION']);
  data.Date_of_collection = extractValue(ocrText, ['Date of collection', 'Collection Date', 'Date of Collection', 'DATE OF COLLECTION']);
  data.Received_by = extractValue(ocrText, ['Received by', 'Received By', 'RECEIVED BY']);
  
  // Extract numeric fields
  const pagesOriginal = extractValue(ocrText, ['No. of pages \\(original copy\\)', 'No of pages', 'Pages original', 'NO. OF PAGES']);
  data.No_of_pages_original_copy = pagesOriginal ? parseInt(pagesOriginal) || null : null;
  
  const copies = extractValue(ocrText, ['No. of copies', 'No of copies', 'Copies', 'NO. OF COPIES']);
  data.No_of_copies = copies ? parseInt(copies) || null : null;
  
  const totalPages = extractValue(ocrText, ['Total No. of printed pages', 'Total pages', 'Total No of printed pages', 'TOTAL NO. OF PRINTED PAGES']);
  data.Total_No_of_printed_pages = totalPages ? parseInt(totalPages) || null : null;
  
  // Extract checkbox fields (Other requests)
  data.Other_request_Single_sided = hasCheckbox(ocrText, ['Single sided', 'Single-sided', 'SINGLE SIDED']) ? 1 : 0;
  data.Other_request_Double_sided = hasCheckbox(ocrText, ['Double sided', 'Double-sided', 'DOUBLE SIDED']) ? 1 : 0;
  data.Other_request_Stapling = hasCheckbox(ocrText, ['Stapling', 'STAPLING']) ? 1 : 0;
  data.Other_request_No_stapling_required = hasCheckbox(ocrText, ['No stapling', 'No Stapling', 'NO STAPLING']) ? 1 : 0;
  data.Other_request_White_paper = hasCheckbox(ocrText, ['White paper', 'White Paper', 'WHITE PAPER']) ? 1 : 0;
  data.Other_request_Newsprint_paper = hasCheckbox(ocrText, ['Newsprint', 'News print', 'NEWSPRINT']) ? 1 : 0;
  
  // Extract text fields
  data.Remarks = extractValue(ocrText, ['Remarks', 'REMARKS', 'Notes', 'NOTES']);
  data.Signed_by = extractValue(ocrText, ['Signed by', 'Signature', 'Signed By', 'SIGNED BY']);
  
  // Office use fields
  data.For_office_use_RICOH = extractValue(ocrText, ['RICOH', 'Ricoh']);
  data.For_office_use_Toshiba = extractValue(ocrText, ['TOSHIBA', 'Toshiba']);
  
  // Table data - extract if present (simplified)
  data.Table_Form = '';
  data.Table_Class = '';
  data.Table_No_of_copies = '';
  data.Table_Teacher_in_Charge = '';
  
  return data;
}

// Main page
app.get('/', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Handwritten Form OCR</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
        <style>
          .drag-over {
            border-color: #3b82f6 !important;
            background-color: #eff6ff;
          }
        </style>
    </head>
    <body class="bg-gray-50">
        <div class="container mx-auto px-4 py-8 max-w-6xl">
            <div class="flex justify-between items-start mb-8">
                <div>
                    <h1 class="text-4xl font-bold text-gray-800 mb-2">
                        <i class="fas fa-file-image mr-2 text-blue-600"></i>
                        Handwritten Form OCR
                    </h1>
                    <p class="text-gray-600">Upload images with handwritten data for automatic text extraction</p>
                </div>
                <a href="/table" class="bg-indigo-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-indigo-700 transition-colors flex items-center gap-2">
                    <i class="fas fa-table"></i>
                    View Table
                </a>
            </div>
            
            <!-- Upload Section -->
            <div class="bg-white rounded-lg shadow-md p-6 mb-8">
                <h2 class="text-2xl font-semibold text-gray-800 mb-4">
                    <i class="fas fa-upload mr-2 text-green-600"></i>
                    Upload Images
                </h2>
                
                <div id="dropZone" class="border-4 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-blue-400 transition-colors">
                    <i class="fas fa-cloud-upload-alt text-6xl text-gray-400 mb-4"></i>
                    <p class="text-xl text-gray-600 mb-2">Drag & drop images here or click to browse</p>
                    <p class="text-sm text-gray-500">Supports multiple files: JPG, PNG, GIF, WebP</p>
                    <input type="file" id="fileInput" multiple accept="image/*" class="hidden">
                </div>
                
                <div id="fileList" class="mt-4 space-y-2"></div>
                
                <button id="uploadBtn" class="mt-4 bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors" disabled>
                    <i class="fas fa-paper-plane mr-2"></i>
                    Upload & Process
                </button>
                
                <div id="uploadProgress" class="hidden mt-4">
                    <div class="bg-gray-200 rounded-full h-4">
                        <div id="progressBar" class="bg-blue-600 h-4 rounded-full transition-all duration-300" style="width: 0%"></div>
                    </div>
                    <p id="progressText" class="text-sm text-gray-600 mt-2">Processing...</p>
                </div>
            </div>
            
            <!-- Search Section -->
            <div class="bg-white rounded-lg shadow-md p-6 mb-8">
                <h2 class="text-2xl font-semibold text-gray-800 mb-4">
                    <i class="fas fa-search mr-2 text-purple-600"></i>
                    Search Extracted Data
                </h2>
                <div class="flex gap-2">
                    <input type="text" id="searchInput" placeholder="Search in extracted text..." class="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <button id="searchBtn" class="bg-purple-600 text-white px-6 py-2 rounded-lg font-semibold hover:bg-purple-700 transition-colors">
                        <i class="fas fa-search mr-2"></i>
                        Search
                    </button>
                </div>
            </div>
            
            <!-- Results Section -->
            <div class="bg-white rounded-lg shadow-md p-6">
                <div class="flex justify-between items-center mb-4">
                    <h2 class="text-2xl font-semibold text-gray-800">
                        <i class="fas fa-database mr-2 text-indigo-600"></i>
                        Extracted Data
                    </h2>
                    <button id="refreshBtn" class="text-blue-600 hover:text-blue-800 font-semibold">
                        <i class="fas fa-sync-alt mr-1"></i>
                        Refresh
                    </button>
                </div>
                
                <div id="resultsContainer" class="space-y-4">
                    <p class="text-gray-500 text-center py-8">No data yet. Upload some images to get started!</p>
                </div>
            </div>
        </div>
        
        <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
        <script src="/static/app.js"></script>
    </body>
    </html>
  `)
})

// Table view page for printing forms
app.get('/table', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Printing Forms Table View</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
        <style>
          .table-container {
            overflow-x: auto;
            max-width: 100%;
          }
          table {
            min-width: 2000px;
          }
          th, td {
            white-space: nowrap;
            padding: 8px 12px;
            border: 1px solid #e5e7eb;
          }
          th {
            position: sticky;
            top: 0;
            background: #1f2937;
            color: white;
            font-weight: 600;
            z-index: 10;
          }
          .checkbox-col {
            text-align: center;
          }
        </style>
    </head>
    <body class="bg-gray-50">
        <div class="container mx-auto px-4 py-8">
            <div class="mb-6 flex justify-between items-center">
                <h1 class="text-3xl font-bold text-gray-800">
                    <i class="fas fa-table mr-2 text-blue-600"></i>
                    Printing Forms Table View
                </h1>
                <a href="/" class="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">
                    <i class="fas fa-arrow-left mr-2"></i>
                    Back to Upload
                </a>
            </div>
            
            <div class="bg-white rounded-lg shadow-md p-4">
                <div class="mb-4 flex gap-2 items-center">
                    <button id="refreshBtn" class="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700">
                        <i class="fas fa-sync-alt mr-2"></i>
                        Refresh
                    </button>
                    <button id="exportBtn" class="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700">
                        <i class="fas fa-download mr-2"></i>
                        Export CSV
                    </button>
                    <span id="recordCount" class="ml-auto text-gray-600"></span>
                </div>
                
                <div class="table-container">
                    <table id="formsTable" class="w-full border-collapse bg-white">
                        <thead>
                            <tr>
                                <th>ID</th>
                                <th>Filename</th>
                                <th>Upload Date</th>
                                <th>RECEIVED_DATE</th>
                                <th>Class</th>
                                <th>Subject</th>
                                <th>Teacher_in_charge</th>
                                <th>Date_of_submission</th>
                                <th>Date_of_collection</th>
                                <th>Received_by</th>
                                <th>No_of_pages_original_copy</th>
                                <th>No_of_copies</th>
                                <th>Total_No_of_printed_pages</th>
                                <th class="checkbox-col">Single_sided</th>
                                <th class="checkbox-col">Double_sided</th>
                                <th class="checkbox-col">Stapling</th>
                                <th class="checkbox-col">No_stapling</th>
                                <th class="checkbox-col">White_paper</th>
                                <th class="checkbox-col">Newsprint_paper</th>
                                <th>Remarks</th>
                                <th>Signed_by</th>
                                <th>RICOH</th>
                                <th>Toshiba</th>
                                <th>Table_Form</th>
                                <th>Table_Class</th>
                                <th>Table_No_of_copies</th>
                                <th>Table_Teacher_in_Charge</th>
                            </tr>
                        </thead>
                        <tbody id="tableBody">
                            <tr>
                                <td colspan="27" class="text-center py-8 text-gray-500">
                                    <i class="fas fa-spinner fa-spin mr-2"></i>
                                    Loading data...
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
        
        <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
        <script>
            async function loadTableData() {
                try {
                    const response = await axios.get('/api/printing-forms');
                    const forms = response.data.forms;
                    
                    document.getElementById('recordCount').textContent = 
                        forms.length + ' record' + (forms.length !== 1 ? 's' : '');
                    
                    const tbody = document.getElementById('tableBody');
                    
                    if (forms.length === 0) {
                        tbody.innerHTML = \`
                            <tr>
                                <td colspan="27" class="text-center py-8 text-gray-500">
                                    No data available. Upload some printing forms first.
                                </td>
                            </tr>
                        \`;
                        return;
                    }
                    
                    tbody.innerHTML = forms.map(form => \`
                        <tr class="hover:bg-gray-50">
                            <td>\${form.id}</td>
                            <td>\${form.filename || ''}</td>
                            <td>\${formatDate(form.upload_date)}</td>
                            <td>\${form.RECEIVED_DATE || ''}</td>
                            <td>\${form.Class || ''}</td>
                            <td>\${form.Subject || ''}</td>
                            <td>\${form.Teacher_in_charge || ''}</td>
                            <td>\${form.Date_of_submission || ''}</td>
                            <td>\${form.Date_of_collection || ''}</td>
                            <td>\${form.Received_by || ''}</td>
                            <td class="text-right">\${form.No_of_pages_original_copy || ''}</td>
                            <td class="text-right">\${form.No_of_copies || ''}</td>
                            <td class="text-right">\${form.Total_No_of_printed_pages || ''}</td>
                            <td class="checkbox-col">\${form.Other_request_Single_sided ? '✓' : ''}</td>
                            <td class="checkbox-col">\${form.Other_request_Double_sided ? '✓' : ''}</td>
                            <td class="checkbox-col">\${form.Other_request_Stapling ? '✓' : ''}</td>
                            <td class="checkbox-col">\${form.Other_request_No_stapling_required ? '✓' : ''}</td>
                            <td class="checkbox-col">\${form.Other_request_White_paper ? '✓' : ''}</td>
                            <td class="checkbox-col">\${form.Other_request_Newsprint_paper ? '✓' : ''}</td>
                            <td>\${form.Remarks || ''}</td>
                            <td>\${form.Signed_by || ''}</td>
                            <td>\${form.For_office_use_RICOH || ''}</td>
                            <td>\${form.For_office_use_Toshiba || ''}</td>
                            <td>\${form.Table_Form || ''}</td>
                            <td>\${form.Table_Class || ''}</td>
                            <td>\${form.Table_No_of_copies || ''}</td>
                            <td>\${form.Table_Teacher_in_Charge || ''}</td>
                        </tr>
                    \`).join('');
                } catch (error) {
                    console.error('Error loading data:', error);
                    document.getElementById('tableBody').innerHTML = \`
                        <tr>
                            <td colspan="27" class="text-center py-8 text-red-500">
                                Error loading data: \${error.message}
                            </td>
                        </tr>
                    \`;
                }
            }
            
            function formatDate(dateStr) {
                if (!dateStr) return '';
                const date = new Date(dateStr);
                return date.toLocaleString();
            }
            
            function exportToCSV() {
                axios.get('/api/printing-forms').then(response => {
                    const forms = response.data.forms;
                    
                    if (forms.length === 0) {
                        alert('No data to export');
                        return;
                    }
                    
                    const headers = [
                        'ID', 'Filename', 'Upload Date', 'RECEIVED_DATE', 'Class', 'Subject',
                        'Teacher_in_charge', 'Date_of_submission', 'Date_of_collection',
                        'Received_by', 'No_of_pages_original_copy', 'No_of_copies',
                        'Total_No_of_printed_pages', 'Single_sided', 'Double_sided',
                        'Stapling', 'No_stapling', 'White_paper', 'Newsprint_paper',
                        'Remarks', 'Signed_by', 'RICOH', 'Toshiba', 'Table_Form',
                        'Table_Class', 'Table_No_of_copies', 'Table_Teacher_in_Charge'
                    ];
                    
                    const rows = forms.map(form => [
                        form.id, form.filename, form.upload_date, form.RECEIVED_DATE,
                        form.Class, form.Subject, form.Teacher_in_charge,
                        form.Date_of_submission, form.Date_of_collection, form.Received_by,
                        form.No_of_pages_original_copy, form.No_of_copies,
                        form.Total_No_of_printed_pages,
                        form.Other_request_Single_sided ? 'Yes' : 'No',
                        form.Other_request_Double_sided ? 'Yes' : 'No',
                        form.Other_request_Stapling ? 'Yes' : 'No',
                        form.Other_request_No_stapling_required ? 'Yes' : 'No',
                        form.Other_request_White_paper ? 'Yes' : 'No',
                        form.Other_request_Newsprint_paper ? 'Yes' : 'No',
                        form.Remarks, form.Signed_by, form.For_office_use_RICOH,
                        form.For_office_use_Toshiba, form.Table_Form, form.Table_Class,
                        form.Table_No_of_copies, form.Table_Teacher_in_Charge
                    ].map(val => {
                        // Escape values containing commas or quotes
                        const str = (val || '').toString();
                        if (str.includes(',') || str.includes('"') || str.includes('\\n')) {
                            return '"' + str.replace(/"/g, '""') + '"';
                        }
                        return str;
                    }));
                    
                    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\\n');
                    
                    const blob = new Blob([csv], { type: 'text/csv' });
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'printing_forms_' + new Date().toISOString().split('T')[0] + '.csv';
                    a.click();
                    window.URL.revokeObjectURL(url);
                }).catch(error => {
                    alert('Error exporting data: ' + error.message);
                });
            }
            
            document.getElementById('refreshBtn').addEventListener('click', loadTableData);
            document.getElementById('exportBtn').addEventListener('click', exportToCSV);
            
            // Load data on page load
            loadTableData();
        </script>
    </body>
    </html>
  `)
})

export default app
