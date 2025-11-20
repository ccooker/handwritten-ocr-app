-- Migration: Simplify printing_forms table to only 8 essential fields
-- Drop the old table and create a new simplified version

DROP TABLE IF EXISTS printing_forms;

CREATE TABLE printing_forms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  image_id INTEGER NOT NULL,
  
  -- Only 8 essential fields
  Class TEXT,
  Subject TEXT,
  Teacher_in_charge TEXT,
  No_of_pages_original_copy INTEGER,
  No_of_copies INTEGER,
  Total_No_of_printed_pages INTEGER,
  Ricoh TEXT,
  Toshiba TEXT,
  
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (image_id) REFERENCES uploaded_images(id) ON DELETE CASCADE
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_printing_forms_image_id ON printing_forms(image_id);
CREATE INDEX IF NOT EXISTS idx_printing_forms_class ON printing_forms(Class);
CREATE INDEX IF NOT EXISTS idx_printing_forms_teacher ON printing_forms(Teacher_in_charge);
