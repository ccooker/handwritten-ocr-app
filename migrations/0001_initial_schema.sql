-- Uploaded images table
CREATE TABLE IF NOT EXISTS uploaded_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  mime_type TEXT NOT NULL,
  upload_date DATETIME DEFAULT CURRENT_TIMESTAMP,
  processing_status TEXT DEFAULT 'pending' CHECK(processing_status IN ('pending', 'processing', 'completed', 'failed')),
  error_message TEXT
);

-- Extracted text data table
CREATE TABLE IF NOT EXISTS extracted_data (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  image_id INTEGER NOT NULL,
  extracted_text TEXT NOT NULL,
  confidence REAL,
  language TEXT,
  extraction_date DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (image_id) REFERENCES uploaded_images(id) ON DELETE CASCADE
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_images_status ON uploaded_images(processing_status);
CREATE INDEX IF NOT EXISTS idx_images_date ON uploaded_images(upload_date);
CREATE INDEX IF NOT EXISTS idx_extracted_image_id ON extracted_data(image_id);
CREATE INDEX IF NOT EXISTS idx_extracted_date ON extracted_data(extraction_date);
