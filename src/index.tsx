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
      const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)))

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

        // Update status to completed
        await DB.prepare(`
          UPDATE uploaded_images SET processing_status = ? WHERE id = ?
        `).bind('completed', imageId).run()

        results.push({
          filename: file.name,
          status: 'success',
          imageId: imageId,
          extractedText: extractedText
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

// OCR function - OCR.space API integration
async function performOCR(base64Image: string, mimeType: string, env: any): Promise<string> {
  const apiKey = env.OCR_API_KEY;
  
  if (!apiKey) {
    throw new Error('OCR_API_KEY not configured. Please add it to .dev.vars or Cloudflare secrets.');
  }
  
  try {
    // Prepare the request body
    const formData = new FormData();
    formData.append('base64Image', `data:${mimeType};base64,${base64Image}`);
    formData.append('language', 'eng');
    formData.append('isOverlayRequired', 'false');
    formData.append('detectOrientation', 'true');
    formData.append('scale', 'true');
    formData.append('OCREngine', '2'); // Engine 2 is better for handwriting
    
    // Call OCR.space API
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
    
    // Check for errors
    if (data.IsErroredOnProcessing) {
      const errorMessage = data.ErrorMessage?.[0] || 'OCR processing failed';
      throw new Error(errorMessage);
    }
    
    // Extract text from response
    const extractedText = data.ParsedResults?.[0]?.ParsedText || '';
    
    if (!extractedText || extractedText.trim() === '') {
      return 'No text detected in the image. The image may be too blurry, too small, or contain no readable text.';
    }
    
    return extractedText.trim();
  } catch (error: any) {
    console.error('OCR Error:', error);
    throw new Error(`OCR processing failed: ${error.message}`);
  }
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
            <h1 class="text-4xl font-bold text-gray-800 mb-2">
                <i class="fas fa-file-image mr-2 text-blue-600"></i>
                Handwritten Form OCR
            </h1>
            <p class="text-gray-600 mb-8">Upload images with handwritten data for automatic text extraction</p>
            
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

export default app
