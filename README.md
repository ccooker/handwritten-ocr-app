# Handwritten Form OCR Application

A web application for uploading images with handwritten data, extracting text using OCR technology, and storing results in a database for analysis.

## 🌐 URLs

- **Local Development**: http://localhost:3000
- **Sandbox Demo**: https://3000-i7nnw5p0uh2hjnfz0320a-ad490db5.sandbox.novita.ai
- **API Endpoints**:
  - `POST /api/upload` - Upload multiple images for OCR processing
  - `GET /api/images` - Get all uploaded images with extracted data
  - `GET /api/images/:id` - Get specific image details
  - `GET /api/search?q=query` - Search in extracted text
  - `DELETE /api/images/:id` - Delete image and its data

## ✨ Features

### Currently Completed Features
- ✅ **Multiple File Upload**: Drag-and-drop interface supporting multiple image files simultaneously
- ✅ **Image Processing**: Automatic handling of JPG, PNG, GIF, and WebP formats
- ✅ **OCR Integration Ready**: Backend API structure prepared for OCR service integration
- ✅ **Database Storage**: Cloudflare D1 SQLite database for persistent data storage
- ✅ **Data Display**: Real-time display of uploaded images and extracted text
- ✅ **Search Functionality**: Full-text search across all extracted data
- ✅ **Progress Tracking**: Visual upload and processing progress indicators
- ✅ **Status Management**: Track processing status (pending, processing, completed, failed)
- ✅ **Data Management**: Delete individual records with cascade deletion
- ✅ **Responsive UI**: Mobile-friendly interface with Tailwind CSS

### Features Not Yet Implemented
- ⏳ **Live OCR Integration**: Currently uses placeholder text (see OCR_INTEGRATION_GUIDE.md)
- ⏳ **Image Preview**: Display uploaded images alongside extracted text
- ⏳ **Bulk Operations**: Select and delete multiple records at once
- ⏳ **Export Functionality**: Export extracted data to CSV/JSON formats
- ⏳ **Advanced Analytics**: Charts and statistics for data analysis
- ⏳ **User Authentication**: Multi-user support with authentication
- ⏳ **Image Storage**: Store actual images (requires R2 bucket integration)

## 🗄️ Data Architecture

### Data Models

**1. uploaded_images table**
```sql
- id: INTEGER PRIMARY KEY (auto-increment)
- filename: TEXT (original filename)
- file_size: INTEGER (size in bytes)
- mime_type: TEXT (image/jpeg, image/png, etc.)
- upload_date: DATETIME (timestamp)
- processing_status: TEXT (pending/processing/completed/failed)
- error_message: TEXT (error details if failed)
```

**2. extracted_data table**
```sql
- id: INTEGER PRIMARY KEY (auto-increment)
- image_id: INTEGER (foreign key to uploaded_images)
- extracted_text: TEXT (OCR results)
- confidence: REAL (0.0-1.0 confidence score)
- language: TEXT (detected language)
- extraction_date: DATETIME (timestamp)
```

### Storage Services
- **Cloudflare D1**: SQLite database for relational data storage
- **Local Development**: Uses `.wrangler/state/v3/d1` for local SQLite
- **Production**: Cloudflare D1 globally distributed database

### Data Flow
1. User uploads multiple images via drag-and-drop or file picker
2. Frontend sends files to `/api/upload` endpoint
3. Backend validates files and stores metadata in `uploaded_images` table
4. Images are converted to base64 for OCR processing
5. OCR service extracts text (currently placeholder)
6. Extracted text stored in `extracted_data` table with confidence scores
7. Processing status updated (completed/failed)
8. Frontend displays results with real-time updates

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ installed
- npm or yarn package manager

### Installation

1. **Clone or navigate to project:**
```bash
cd /home/user/webapp
```

2. **Install dependencies (if needed):**
```bash
npm install
```

3. **Set up local database:**
```bash
npm run db:migrate:local
```

4. **Build the project:**
```bash
npm run build
```

5. **Start development server:**
```bash
# Option 1: Using PM2 (recommended for sandbox)
pm2 start ecosystem.config.cjs

# Option 2: Using npm script
npm run dev:sandbox
```

6. **Access the application:**
- Local: http://localhost:3000
- Check PM2 logs: `pm2 logs webapp --nostream`

### Testing the Application

1. Open the application in your browser
2. Drag and drop image files or click to browse
3. Upload multiple images at once
4. View extracted data in the results section
5. Use search to find specific text
6. Delete records as needed

## 🔧 Configuration

### Environment Variables

**For Local Development** (`.dev.vars`):
```
OCR_API_KEY=your_ocr_api_key_here
```

**For Production** (Cloudflare Secrets):
```bash
npx wrangler pages secret put OCR_API_KEY --project-name webapp
```

### OCR Integration

The application currently uses placeholder OCR. To enable real handwriting recognition, see **[OCR_INTEGRATION_GUIDE.md](./OCR_INTEGRATION_GUIDE.md)** for:

- **OCR.space** - Free tier, easiest setup (recommended)
- **Google Cloud Vision API** - Most accurate
- **Azure Computer Vision** - Enterprise solution
- **Tesseract.js** - Client-side, no API costs

## 📝 User Guide

### Uploading Images

1. **Drag & Drop**: Drag image files directly onto the upload zone
2. **File Browser**: Click the upload zone to select files
3. **Multiple Files**: Select or drop multiple images simultaneously
4. **Supported Formats**: JPG, PNG, GIF, WebP

### Viewing Results

- **Upload Date**: See when each image was processed
- **Status Badge**: Visual indicator of processing status
- **Extracted Text**: View OCR results in a readable format
- **Confidence Score**: See OCR confidence level (0-100%)
- **File Details**: View file size, type, and language

### Searching Data

1. Enter keywords in the search box
2. Press Enter or click Search button
3. Results are filtered in real-time
4. Click Refresh to see all records again

### Managing Data

- **Delete**: Click the trash icon to remove a record
- **Refresh**: Update the list with latest data
- **Clear Search**: Click Refresh to reset search filters

## 📦 Project Structure

```
webapp/
├── src/
│   ├── index.tsx           # Main Hono application with API routes
│   └── renderer.tsx        # JSX renderer (if needed)
├── public/
│   └── static/
│       └── app.js          # Frontend JavaScript
├── migrations/
│   └── 0001_initial_schema.sql  # Database schema
├── dist/                   # Build output
├── .wrangler/             # Local D1 database (gitignored)
├── .git/                  # Git repository
├── .gitignore             # Git ignore rules
├── ecosystem.config.cjs   # PM2 configuration
├── wrangler.jsonc         # Cloudflare configuration
├── package.json           # Dependencies and scripts
├── tsconfig.json          # TypeScript configuration
├── vite.config.ts         # Vite build configuration
├── OCR_INTEGRATION_GUIDE.md  # OCR setup instructions
└── README.md             # This file
```

## 🛠️ Development

### Available Scripts

```bash
npm run dev              # Vite development server
npm run dev:sandbox      # Wrangler local development with D1
npm run build            # Build for production
npm run preview          # Preview production build
npm run deploy           # Build and deploy to Cloudflare
npm run deploy:prod      # Deploy to specific project

# Database management
npm run db:migrate:local  # Apply migrations locally
npm run db:migrate:prod   # Apply migrations to production
npm run db:console:local  # Access local database console
npm run db:reset          # Reset local database

# Utilities
npm run clean-port        # Kill process on port 3000
npm run test              # Test local server
npm run git:commit        # Quick git commit
```

### Database Management

**View local database:**
```bash
npm run db:console:local
```

**Execute SQL query:**
```bash
npx wrangler d1 execute webapp-production --local --command="SELECT * FROM uploaded_images"
```

**Reset database:**
```bash
npm run db:reset
```

## 🚀 Deployment

### Prerequisites for Production

1. **Cloudflare Account**: Sign up at https://cloudflare.com
2. **API Token**: Get from https://dash.cloudflare.com/profile/api-tokens

### Production Deployment Steps

1. **Set up Cloudflare authentication:**
```bash
# This configures CLOUDFLARE_API_TOKEN
setup_cloudflare_api_key
```

2. **Create production D1 database:**
```bash
npx wrangler d1 create webapp-production
# Copy the database_id to wrangler.jsonc
```

3. **Update wrangler.jsonc with database ID:**
```jsonc
{
  "d1_databases": [{
    "binding": "DB",
    "database_name": "webapp-production",
    "database_id": "your-actual-database-id"
  }]
}
```

4. **Apply migrations to production:**
```bash
npm run db:migrate:prod
```

5. **Create Cloudflare Pages project:**
```bash
npx wrangler pages project create webapp \
  --production-branch main \
  --compatibility-date 2024-01-01
```

6. **Deploy to production:**
```bash
npm run deploy:prod
```

7. **Set OCR API key (if configured):**
```bash
npx wrangler pages secret put OCR_API_KEY --project-name webapp
```

### Deployment Status

- **Platform**: Cloudflare Pages
- **Status**: ✅ Ready for deployment
- **Tech Stack**: Hono + TypeScript + Cloudflare D1 + TailwindCSS
- **Last Updated**: 2025-11-18

## 🎯 Recommended Next Steps

1. **Enable Real OCR**:
   - Sign up for OCR.space free tier (easiest)
   - Add API key to environment variables
   - Replace placeholder OCR function
   - See OCR_INTEGRATION_GUIDE.md for details

2. **Add Image Storage**:
   - Set up Cloudflare R2 bucket
   - Store original images
   - Display image previews

3. **Enhance UI**:
   - Add image preview lightbox
   - Implement bulk operations
   - Add data export (CSV/JSON)

4. **Analytics Dashboard**:
   - Create charts for upload trends
   - Show confidence score distributions
   - Language detection statistics

5. **User Authentication**:
   - Add Cloudflare Access or Auth0
   - Multi-user support
   - Personal data isolation

6. **Advanced Features**:
   - Batch processing queue
   - Email notifications
   - Webhook integrations
   - API key authentication

## 🔒 Security Notes

- Image data is processed server-side only
- No images stored permanently (unless R2 is added)
- OCR API keys must be kept in Cloudflare secrets
- CORS enabled only for API routes
- Input validation on file types and sizes

## 📄 License

MIT License - Feel free to use this project for any purpose.

## 🙏 Credits

- **Hono Framework**: Fast web framework for Cloudflare Workers
- **Cloudflare D1**: Globally distributed SQLite database
- **Tailwind CSS**: Utility-first CSS framework
- **Font Awesome**: Icon library
- **Axios**: HTTP client library

## 📞 Support

For issues or questions:
1. Check OCR_INTEGRATION_GUIDE.md for OCR setup
2. Review Cloudflare D1 documentation
3. Check PM2 logs: `pm2 logs webapp --nostream`
4. Verify database: `npm run db:console:local`

---

**Note**: This application is production-ready except for the OCR integration. Follow the OCR_INTEGRATION_GUIDE.md to enable real handwriting recognition with your preferred OCR service.
