-- Printing form data table
CREATE TABLE IF NOT EXISTS printing_forms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  image_id INTEGER NOT NULL,
  
  -- Main form fields
  RECEIVED_DATE TEXT,
  Class TEXT,
  Subject TEXT,
  Teacher_in_charge TEXT,
  Date_of_submission TEXT,
  Date_of_collection TEXT,
  Received_by TEXT,
  No_of_pages_original_copy INTEGER,
  No_of_copies INTEGER,
  Total_No_of_printed_pages INTEGER,
  
  -- Other requests (checkboxes)
  Other_request_Single_sided BOOLEAN DEFAULT 0,
  Other_request_Double_sided BOOLEAN DEFAULT 0,
  Other_request_Stapling BOOLEAN DEFAULT 0,
  Other_request_No_stapling_required BOOLEAN DEFAULT 0,
  Other_request_White_paper BOOLEAN DEFAULT 0,
  Other_request_Newsprint_paper BOOLEAN DEFAULT 0,
  
  -- Additional fields
  Remarks TEXT,
  Signed_by TEXT,
  
  -- Office use fields
  For_office_use_RICOH TEXT,
  For_office_use_Toshiba TEXT,
  
  -- Table data (JSON or comma-separated values)
  Table_Form TEXT,
  Table_Class TEXT,
  Table_No_of_copies TEXT,
  Table_Teacher_in_Charge TEXT,
  
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (image_id) REFERENCES uploaded_images(id) ON DELETE CASCADE
);

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_printing_forms_image_id ON printing_forms(image_id);
CREATE INDEX IF NOT EXISTS idx_printing_forms_date ON printing_forms(RECEIVED_DATE);
CREATE INDEX IF NOT EXISTS idx_printing_forms_class ON printing_forms(Class);
