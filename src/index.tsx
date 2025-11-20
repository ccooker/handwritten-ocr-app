import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from 'hono/cloudflare-workers'

type Bindings = {
  DB: D1Database;
  OCR_API_KEY?: string;
  OPENAI_API_KEY?: string;
  GEMINI_API_KEY?: string;
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

      // Try AI-powered extraction first (best for handwriting)
      try {
        let parsedData: any = null;
        let extractedText = '';
        let extractionMethod = 'OCR';
        
        // Try AI extraction first if API key is available
        const aiResult = await extractWithAI(base64, file.type, c.env);
        
        if (aiResult) {
          // AI extraction successful - use structured data directly
          parsedData = aiResult;
          extractedText = JSON.stringify(aiResult, null, 2);
          extractionMethod = 'AI Vision';
        } else {
          // Fall back to OCR + parsing
          extractedText = await performOCR(base64, file.type, c.env);
          parsedData = parsePrintingFormData(extractedText);
          extractionMethod = 'OCR + Parsing';
        }
        
        // Clean all # symbols from text fields
        const cleanText = (value: any): string => {
          if (typeof value === 'string') {
            return value.replace(/#/g, '').trim();
          }
          return value || '';
        };
        
        // Store extracted data
        await DB.prepare(`
          INSERT INTO extracted_data (image_id, extracted_text, confidence, language)
          VALUES (?, ?, ?, ?)
        `).bind(imageId, extractedText, 0.95, 'en').run()

        // Ensure only the 8 required fields with cleaned data
        parsedData = {
          Class: cleanText(parsedData.Class),
          Subject: cleanText(parsedData.Subject),
          Teacher_in_charge: cleanText(parsedData.Teacher_in_charge),
          No_of_pages_original_copy: parsedData.No_of_pages_original_copy || null,
          No_of_copies: parsedData.No_of_copies || null,
          Total_No_of_printed_pages: parsedData.Total_No_of_printed_pages || null,
          Ricoh: cleanText(parsedData.Ricoh),
          Toshiba: cleanText(parsedData.Toshiba)
        };
        
        // DO NOT save to printing_forms table yet - wait for user verification
        // Data will be saved via /api/save-verified endpoint after user confirms

        // Update status to completed (extraction done, awaiting verification)
        await DB.prepare(`
          UPDATE uploaded_images SET processing_status = ? WHERE id = ?
        `).bind('completed', imageId).run()

        results.push({
          filename: file.name,
          status: 'success',
          imageId: imageId,
          extractedText: extractedText,
          parsedData: parsedData,
          extractionMethod: extractionMethod
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

// API route: Save verified data to table
app.post('/api/save-verified', async (c) => {
  try {
    const { DB } = c.env
    const { records } = await c.req.json()
    
    if (!records || !Array.isArray(records)) {
      return c.json({ error: 'Invalid records format' }, 400)
    }
    
    let saved = 0
    
    for (const record of records) {
      const { imageId, data } = record
      
      // Clean text fields
      const cleanText = (value: any): string => {
        if (typeof value === 'string') {
          return value.replace(/#/g, '').trim()
        }
        return value || ''
      }
      
      // Insert verified data into printing_forms table
      await DB.prepare(`
        INSERT INTO printing_forms (
          image_id, Class, Subject, Teacher_in_charge,
          No_of_pages_original_copy, No_of_copies, Total_No_of_printed_pages,
          Ricoh, Toshiba
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        imageId,
        cleanText(data.Class),
        cleanText(data.Subject),
        cleanText(data.Teacher_in_charge),
        data.No_of_pages_original_copy || null,
        data.No_of_copies || null,
        data.Total_No_of_printed_pages || null,
        cleanText(data.Ricoh),
        cleanText(data.Toshiba)
      ).run()
      
      saved++
    }
    
    return c.json({ success: true, saved })
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

// AI-powered handwriting extraction using GPT-4 Vision or Gemini
async function extractWithAI(base64Image: string, mimeType: string, env: any): Promise<any> {
  // Try OpenAI GPT-4 Vision first
  if (env.OPENAI_API_KEY) {
    try {
      return await extractWithOpenAI(base64Image, mimeType, env.OPENAI_API_KEY);
    } catch (error) {
      console.error('OpenAI extraction failed:', error);
    }
  }
  
  // Try Google Gemini as fallback
  if (env.GEMINI_API_KEY) {
    try {
      return await extractWithGemini(base64Image, mimeType, env.GEMINI_API_KEY);
    } catch (error) {
      console.error('Gemini extraction failed:', error);
    }
  }
  
  // If no AI API available, return null to use OCR fallback
  return null;
}

// Extract data using OpenAI GPT-4 Vision
async function extractWithOpenAI(base64Image: string, mimeType: string, apiKey: string): Promise<any> {
  const prompt = `You are an expert in data extraction from handwritten documents, with a meticulous eye for detail and accuracy. Your task is to extract specific data points from the provided handwritten printing request form image.

Extract the following fields:
1. RECEIVED_DATE - Date when form was received
2. Class - Student class/grade
3. Subject - Subject or topic
4. Teacher_in_charge - Teacher's name
5. Date_of_submission - When submitted
6. Date_of_collection - When to collect
7. Received_by - Person who received
8. No_of_pages_original_copy - Number of pages in original (numeric)
9. No_of_copies - Number of copies needed (numeric)
10. Total_No_of_printed_pages - Total pages to print (numeric)
11. Other_request_Single_sided - Is "Single sided" checked? (true/false)
12. Other_request_Double_sided - Is "Double sided" checked? (true/false)
13. Other_request_Stapling - Is "Stapling" checked? (true/false)
14. Other_request_No_stapling_required - Is "No stapling" checked? (true/false)
15. Other_request_White_paper - Is "White paper" checked? (true/false)
16. Other_request_Newsprint_paper - Is "Newsprint" checked? (true/false)
17. Remarks - Any remarks or notes
18. Signed_by - Signature/name
19. For_office_use_RICOH - RICOH field value
20. For_office_use_Toshiba - Toshiba field value

Return ONLY a valid JSON object with these exact field names. If a field is not visible or empty, use empty string "" for text fields, null for numbers, and false for booleans.

Example format:
{
  "RECEIVED_DATE": "2025-11-15",
  "Class": "5A",
  "Subject": "Mathematics",
  "Teacher_in_charge": "Mr. Smith",
  "No_of_pages_original_copy": 10,
  "No_of_copies": 30,
  ...
}`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-4o', // or gpt-4-vision-preview
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: prompt
            },
            {
              type: 'image_url',
              image_url: {
                url: `data:${mimeType};base64,${base64Image}`
              }
            }
          ]
        }
      ],
      max_tokens: 1000,
      temperature: 0.1 // Low temperature for accurate extraction
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI API failed: ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices[0]?.message?.content || '';
  
  // Parse JSON from response
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return JSON.parse(jsonMatch[0]);
  }
  
  throw new Error('No valid JSON found in AI response');
}

// Extract data using Google Gemini (Latest Model: gemini-2.0-flash-exp)
async function extractWithGemini(base64Image: string, mimeType: string, apiKey: string): Promise<any> {
  const prompt = `You are an expert in data extraction from handwritten documents, with a meticulous eye for detail and accuracy. Your task is to extract ONLY HANDWRITTEN TEXT from the provided printing request form image.

CRITICAL: Extract ONLY handwritten text, NOT printed labels or form structure.

Look for HANDWRITTEN entries in these 8 fields:
1. Class - HANDWRITTEN class/grade only (e.g., "5A", "Primary 3")
2. Subject - HANDWRITTEN subject/topic only
3. Teacher_in_charge - HANDWRITTEN teacher's name only
4. No_of_pages_original_copy - HANDWRITTEN number only (numeric value)
5. No_of_copies - HANDWRITTEN number only (numeric value)
6. Total_No_of_printed_pages - HANDWRITTEN total number only (numeric value)
7. Ricoh - If "Ricoh" is circled/checked with pen/pencil, put the HANDWRITTEN total pages value here
8. Toshiba - If "Toshiba" is circled/checked with pen/pencil, put the HANDWRITTEN total pages value here

CRITICAL EXTRACTION RULES:
- IGNORE all printed text on the form (labels, instructions, form fields)
- ONLY extract handwritten pen/pencil text
- Look for filled-in boxes, circled items, or written text
- Remove ALL "#" symbols from handwritten text
- For Ricoh: Only if you see a handwritten circle/check around "Ricoh", copy the handwritten total pages
- For Toshiba: Only if you see a handwritten circle/check around "Toshiba", copy the handwritten total pages
- For missing handwritten text fields, use empty string ""
- For missing handwritten numbers, use null
- Return ONLY a valid JSON object with these exact 8 field names

Examples of HANDWRITTEN vs PRINTED:
❌ PRINTED: "Class:" "Subject:" "Teacher in charge:" (ignore these)
✅ HANDWRITTEN: "5A" "Mathematics" "John Doe" (extract these)

Example output (when Ricoh is circled by hand):
{
  "Class": "5A",
  "Subject": "Mathematics",
  "Teacher_in_charge": "John Doe",
  "No_of_pages_original_copy": 5,
  "No_of_copies": 30,
  "Total_No_of_printed_pages": 150,
  "Ricoh": "150",
  "Toshiba": ""
}

Example output (when Toshiba is circled by hand):
{
  "Class": "Primary 3",
  "Subject": "Science",
  "Teacher_in_charge": "Jane Smith",
  "No_of_pages_original_copy": 3,
  "No_of_copies": 25,
  "Total_No_of_printed_pages": 75,
  "Ricoh": "",
  "Toshiba": "75"
}`;

  // Try latest experimental model first (gemini-2.0-flash-exp)
  // If it fails, fallback to stable production model (gemini-1.5-flash)
  const models = [
    'gemini-2.0-flash-exp',  // Latest experimental model with best accuracy
    'gemini-1.5-flash'        // Stable production model as fallback
  ];

  let lastError: Error | null = null;

  for (const model of models) {
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              {
                inline_data: {
                  mime_type: mimeType,
                  data: base64Image
                }
              }
            ]
          }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 2048,
            topP: 0.95,
            topK: 40
          },
          safetySettings: [
            {
              category: "HARM_CATEGORY_HARASSMENT",
              threshold: "BLOCK_ONLY_HIGH"
            },
            {
              category: "HARM_CATEGORY_HATE_SPEECH",
              threshold: "BLOCK_ONLY_HIGH"
            },
            {
              category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
              threshold: "BLOCK_ONLY_HIGH"
            },
            {
              category: "HARM_CATEGORY_DANGEROUS_CONTENT",
              threshold: "BLOCK_ONLY_HIGH"
            }
          ]
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gemini API (${model}) failed: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      const content = data.candidates[0]?.content?.parts[0]?.text || '';
      
      // Parse JSON from response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        console.log(`Successfully extracted data using ${model}`);
        return parsed;
      }
      
      throw new Error('No valid JSON found in AI response');
      
    } catch (error) {
      console.error(`Failed with ${model}:`, error);
      lastError = error as Error;
      // Continue to next model
    }
  }

  // All models failed
  throw lastError || new Error('All Gemini models failed');
}

// Parse printing form data from OCR text - Extract only 8 essential fields
function parsePrintingFormData(ocrText: string): any {
  const data: any = {};
  
  // Helper function to extract value after a label and remove # symbols
  const extractValue = (text: string, labels: string[]): string => {
    for (const label of labels) {
      const regex = new RegExp(label + '\\s*:?\\s*([^\\n\\r]+)', 'i');
      const match = text.match(regex);
      if (match && match[1]) {
        return match[1].trim().replace(/#/g, '').trim();
      }
    }
    return '';
  };
  
  // Helper function to check if text contains circled/checked marker near a label
  const isCircled = (text: string, labels: string[]): boolean => {
    for (const label of labels) {
      // Look for various circle/check patterns near the label
      const patterns = [
        `\\([xX✓√]\\)\\s*${label}`,  // (X) Ricoh
        `${label}\\s*\\([xX✓√]\\)`,  // Ricoh (X)
        `\\[${label}\\]`,            // [Ricoh]
        `<${label}>`,                // <Ricoh>
        `${label}\\s*[*✓√✔✗xX]`,    // Ricoh X
      ];
      for (const pattern of patterns) {
        if (new RegExp(pattern, 'i').test(text)) {
          return true;
        }
      }
    }
    return false;
  };
  
  // Extract only the 8 required fields
  data.Class = extractValue(ocrText, ['Class', 'CLASS', 'Grade']);
  data.Subject = extractValue(ocrText, ['Subject', 'SUBJECT']);
  data.Teacher_in_charge = extractValue(ocrText, ['Teacher in charge', 'Teacher-in-charge', 'Teacher', 'Teacher in Charge', 'TEACHER IN CHARGE']);
  
  // Extract numeric fields
  const pagesOriginal = extractValue(ocrText, ['No. of pages \\(original copy\\)', 'No of pages', 'Pages original', 'NO. OF PAGES']);
  data.No_of_pages_original_copy = pagesOriginal ? parseInt(pagesOriginal) || null : null;
  
  const copies = extractValue(ocrText, ['No. of copies', 'No of copies', 'Copies', 'NO. OF COPIES']);
  data.No_of_copies = copies ? parseInt(copies) || null : null;
  
  const totalPages = extractValue(ocrText, ['Total No. of printed pages', 'Total pages', 'Total No of printed pages', 'TOTAL NO. OF PRINTED PAGES', 'Total printed']);
  data.Total_No_of_printed_pages = totalPages ? parseInt(totalPages) || null : null;
  
  // Check if Ricoh or Toshiba is circled - if so, put Total_No_of_printed_pages value
  const ricohCircled = isCircled(ocrText, ['RICOH', 'Ricoh']);
  const toshibaCircled = isCircled(ocrText, ['TOSHIBA', 'Toshiba']);
  
  data.Ricoh = ricohCircled && data.Total_No_of_printed_pages 
    ? String(data.Total_No_of_printed_pages) 
    : '';
    
  data.Toshiba = toshibaCircled && data.Total_No_of_printed_pages 
    ? String(data.Total_No_of_printed_pages) 
    : '';
  
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
        <title>Printing Forms Table View - 8 Essential Fields</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
        <style>
          .table-container {
            overflow-x: auto;
            max-width: 100%;
          }
          table {
            min-width: 1200px;
          }
          th, td {
            white-space: nowrap;
            padding: 12px 16px;
            border: 1px solid #e5e7eb;
          }
          th {
            position: sticky;
            top: 0;
            background: #1f2937;
            color: white;
            font-weight: 600;
            z-index: 10;
            text-align: left;
          }
          .number-col {
            text-align: right;
          }
          .ricoh-col {
            background-color: #fef3c7;
          }
          .toshiba-col {
            background-color: #dbeafe;
          }
          tr:hover {
            background-color: #f9fafb;
          }
        </style>
    </head>
    <body class="bg-gray-50">
        <div class="container mx-auto px-4 py-8">
            <div class="mb-6 flex justify-between items-center">
                <div>
                    <h1 class="text-3xl font-bold text-gray-800">
                        <i class="fas fa-table mr-2 text-blue-600"></i>
                        Printing Forms Table View
                    </h1>
                    <p class="text-gray-600 mt-1">8 Essential Fields</p>
                </div>
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
                    <span id="recordCount" class="ml-auto text-gray-600 font-semibold"></span>
                </div>
                
                <div class="table-container">
                    <table id="formsTable" class="w-full border-collapse bg-white">
                        <thead>
                            <tr>
                                <th>ID</th>
                                <th>Filename</th>
                                <th>Upload Date</th>
                                <th>Class</th>
                                <th>Subject</th>
                                <th>Teacher-in-charge</th>
                                <th class="number-col">Pages (Original)</th>
                                <th class="number-col">No. of Copies</th>
                                <th class="number-col">Total Printed</th>
                                <th class="ricoh-col">Ricoh</th>
                                <th class="toshiba-col">Toshiba</th>
                            </tr>
                        </thead>
                        <tbody id="tableBody">
                            <tr>
                                <td colspan="11" class="text-center py-8 text-gray-500">
                                    <i class="fas fa-spinner fa-spin mr-2"></i>
                                    Loading data...
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
            
            <div class="mt-4 bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h3 class="font-semibold text-blue-800 mb-2">
                    <i class="fas fa-info-circle mr-2"></i>
                    Legend
                </h3>
                <div class="text-sm text-blue-700 space-y-1">
                    <p><span class="inline-block w-4 h-4 bg-yellow-200 border border-yellow-300 mr-2"></span> Ricoh - Shows total pages if Ricoh is circled</p>
                    <p><span class="inline-block w-4 h-4 bg-blue-200 border border-blue-300 mr-2"></span> Toshiba - Shows total pages if Toshiba is circled</p>
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
                                <td colspan="11" class="text-center py-8 text-gray-500">
                                    <i class="fas fa-inbox mr-2"></i>
                                    No data available. Upload some printing forms first.
                                </td>
                            </tr>
                        \`;
                        return;
                    }
                    
                    tbody.innerHTML = forms.map(form => \`
                        <tr class="hover:bg-gray-50">
                            <td class="font-semibold text-gray-700">\${form.id}</td>
                            <td class="text-blue-600">\${form.filename || ''}</td>
                            <td class="text-gray-600">\${formatDate(form.upload_date)}</td>
                            <td class="font-medium">\${form.Class || '-'}</td>
                            <td>\${form.Subject || '-'}</td>
                            <td>\${form.Teacher_in_charge || '-'}</td>
                            <td class="number-col font-medium">\${form.No_of_pages_original_copy || '-'}</td>
                            <td class="number-col font-medium">\${form.No_of_copies || '-'}</td>
                            <td class="number-col font-bold text-blue-600">\${form.Total_No_of_printed_pages || '-'}</td>
                            <td class="ricoh-col font-semibold text-center">\${form.Ricoh || '-'}</td>
                            <td class="toshiba-col font-semibold text-center">\${form.Toshiba || '-'}</td>
                        </tr>
                    \`).join('');
                } catch (error) {
                    console.error('Error loading data:', error);
                    document.getElementById('tableBody').innerHTML = \`
                        <tr>
                            <td colspan="11" class="text-center py-8 text-red-500">
                                <i class="fas fa-exclamation-triangle mr-2"></i>
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
                    
                    // Only 8 essential fields + metadata
                    const headers = [
                        'ID', 'Filename', 'Upload Date', 
                        'Class', 'Subject', 'Teacher-in-charge',
                        'No. of Pages (Original)', 'No. of Copies', 'Total Printed Pages',
                        'Ricoh', 'Toshiba'
                    ];
                    
                    const rows = forms.map(form => [
                        form.id,
                        form.filename,
                        form.upload_date,
                        form.Class,
                        form.Subject,
                        form.Teacher_in_charge,
                        form.No_of_pages_original_copy,
                        form.No_of_copies,
                        form.Total_No_of_printed_pages,
                        form.Ricoh,
                        form.Toshiba
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
                    a.download = 'printing_forms_8_fields_' + new Date().toISOString().split('T')[0] + '.csv';
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
