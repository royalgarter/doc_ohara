#!/bin/bash

INPUT_DIR="./input"
RAW_OUT_DIR="./raw_output"
FINAL_OUT_DIR="./collections"

mkdir -p "$RAW_OUT_DIR" "$FINAL_OUT_DIR"

echo "🚀 Launching AI Document Extraction Workers..."
# Loop through every file in the input directory
for filepath in "$INPUT_DIR"/*; do
    [ -e "$filepath" ] || continue
    filename=$(basename -- "$filepath")
    extension="${filename##*.}"
    filename_no_ext="${filename%.*}"
    
    echo "Processing: $filename (Format: $extension)"

    if [ "$extension" == "pdf" ]; then
        echo "🔥 Routing $filename to MinerU for deep layout analysis..."
        # Run MinerU via official Docker image
        docker run --rm \
          -v "$(pwd)/input:/in" \
          -v "$(pwd)/raw_output:/out" \
          opendatalab/mineru:latest \
          magic-pdf -i "/in/$filename" -o "/out" -m format
          
    else
        echo "⚡ Routing $filename to Docling CLI..."
        # Run Docling via official lightweight Docker image
        docker run --rm \
          -v "$(pwd)/input:/in" \
          -v "$(pwd)/raw_output:/out" \
          ds4sd/docling:latest \
          docling-tools convert --to json "/in/$filename"
          
        # Standardize Docling output naming conventions to match folder structures
        mv "$RAW_OUT_DIR/${filename_no_ext}.json" "$RAW_OUT_DIR/${filename_no_ext}/${filename_no_ext}.json" 2>/dev/null
    fi
done

echo "🔄 Invoking Node.js Collection Transformation Engine..."
node transform.js

echo "✅ Pipeline successfully completed!"
