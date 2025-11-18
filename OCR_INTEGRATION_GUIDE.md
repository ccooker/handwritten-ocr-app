# OCR Integration Guide

This application currently uses a placeholder OCR function. To enable real handwriting recognition, integrate one of these OCR services:

## Option 1: OCR.space (Easiest - Free Tier Available)

**Pros:**
- Simple REST API
- Free tier: 25,000 requests/month
- Good handwriting recognition
- No credit card required

**Steps:**
1. Get API key from: https://ocr.space/ocrapi
2. Add to `.dev.vars` file:
   ```
   OCR_API_KEY=your_ocr_space_api_key
   ```
3. For production, add secret:
   ```bash
   npx wrangler pages secret put OCR_API_KEY --project-name webapp
   ```

4. Replace the `performOCR` function in `src/index.tsx`:

```typescript
async function performOCR(base64Image: string, mimeType: string, env: any): Promise<string> {
  const apiKey = env.OCR_API_KEY;
  
  const formData = new FormData();
  formData.append('base64Image', `data:${mimeType};base64,${base64Image}`);
  formData.append('language', 'eng');
  formData.append('isOverlayRequired', 'false');
  formData.append('detectOrientation', 'true');
  formData.append('scale', 'true');
  formData.append('OCREngine', '2'); // Engine 2 is better for handwriting
  
  const response = await fetch('https://api.ocr.space/parse/image', {
    method: 'POST',
    headers: {
      'apikey': apiKey,
    },
    body: formData
  });
  
  const data = await response.json();
  
  if (data.IsErroredOnProcessing) {
    throw new Error(data.ErrorMessage?.[0] || 'OCR processing failed');
  }
  
  return data.ParsedResults?.[0]?.ParsedText || '';
}
```

## Option 2: Google Cloud Vision API (Most Accurate)

**Pros:**
- Excellent handwriting recognition
- Supports multiple languages
- 1000 free requests/month

**Steps:**
1. Enable Cloud Vision API: https://console.cloud.google.com/apis/library/vision.googleapis.com
2. Create service account and download JSON key
3. Add API key to secrets:
   ```bash
   npx wrangler pages secret put GOOGLE_CLOUD_API_KEY --project-name webapp
   ```

4. Implementation:
```typescript
async function performOCR(base64Image: string, mimeType: string, env: any): Promise<string> {
  const apiKey = env.GOOGLE_CLOUD_API_KEY;
  
  const response = await fetch(
    `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{
          image: { content: base64Image },
          features: [{ type: 'DOCUMENT_TEXT_DETECTION' }]
        }]
      })
    }
  );
  
  const data = await response.json();
  return data.responses?.[0]?.fullTextAnnotation?.text || '';
}
```

## Option 3: Azure Computer Vision (Enterprise)

**Pros:**
- Enterprise-grade
- Good accuracy
- Free tier available

**Steps:**
1. Create resource: https://portal.azure.com/#create/Microsoft.CognitiveServicesComputerVision
2. Get endpoint and key
3. Add to secrets:
   ```bash
   npx wrangler pages secret put AZURE_VISION_KEY --project-name webapp
   npx wrangler pages secret put AZURE_VISION_ENDPOINT --project-name webapp
   ```

## Option 4: Tesseract.js (Client-side - No API needed)

**Pros:**
- No API costs
- Runs in browser
- Privacy-friendly

**Cons:**
- Slower processing
- Less accurate for handwriting

This would require moving OCR to the frontend with Tesseract.js library.

## Recommended: OCR.space for Quick Start

For immediate testing, use OCR.space with their free tier. It's the easiest to set up and provides good handwriting recognition without credit card requirements.

## Adding Environment Variables

### Local Development (.dev.vars):
```
OCR_API_KEY=your_api_key_here
```

### Production (Cloudflare):
```bash
npx wrangler pages secret put OCR_API_KEY --project-name webapp
```

### Update wrangler.jsonc:
```jsonc
{
  "vars": {
    "OCR_SERVICE": "ocrspace"
  }
}
```
