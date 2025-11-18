#!/bin/bash

# Setup script for OCR.space API integration

echo "=================================="
echo "OCR.space API Key Setup"
echo "=================================="
echo ""

# Check if API key is provided as argument
if [ -z "$1" ]; then
    echo "Usage: ./setup-ocr.sh YOUR_API_KEY"
    echo ""
    echo "Or run interactively:"
    read -p "Enter your OCR.space API key: " API_KEY
else
    API_KEY="$1"
fi

if [ -z "$API_KEY" ]; then
    echo "Error: API key is required"
    exit 1
fi

echo ""
echo "Setting up OCR API key..."
echo ""

# Create .dev.vars file for local development
echo "OCR_API_KEY=$API_KEY" > .dev.vars
echo "✅ Created .dev.vars file for local development"

# Instructions for production
echo ""
echo "=================================="
echo "Setup Complete!"
echo "=================================="
echo ""
echo "Local development is now configured."
echo ""
echo "For production deployment, run:"
echo "  npx wrangler pages secret put OCR_API_KEY --project-name webapp"
echo ""
echo "When prompted, enter your API key: $API_KEY"
echo ""
echo "Next steps:"
echo "  1. Build: npm run build"
echo "  2. Test locally: pm2 restart webapp"
echo "  3. Deploy: npm run deploy:prod"
echo ""
