#!/usr/bin/env python3
"""
Script untuk mengkonversi PDF regulasi menjadi format yang optimal untuk LLM.
Menggunakan fitur Docling secara menyeluruh:
  - PdfPipelineOptions: OCR, TableFormer ACCURATE, table structure
  - HybridChunker: tokenizer-aware chunking dengan contextualization
  - Multi-format export: JSON (lossless), Markdown, HTML
  - Metadata lengkap: page numbers, content types, headings, doc_items

Output per file:
  - <nama>_document.json  : DoclingDocument JSON (lossless, full structure)
  - <nama>_chunks.json    : JSON array chunks + metadata lengkap
  - <nama>_llm.md         : Markdown chunked dengan separator dan konteks
  - <nama>.md             : Markdown full document
  - <nama>.html           : HTML full document (preserves tables)
"""

import json
import os
import sys
import glob
from pathlib import Path

from docling.document_converter import DocumentConverter, PdfFormatOption
from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import (
    PdfPipelineOptions,
    TableStructureOptions,
    TableFormerMode,
)
from docling.chunking import HybridChunker


def create_converter():
    """Create DocumentConverter with full pipeline options."""
    
    pipeline_options = PdfPipelineOptions()
    
    # Enable OCR for scanned PDFs or image-based text
    pipeline_options.do_ocr = True
    
    # Enable table structure extraction with ACCURATE mode
    pipeline_options.do_table_structure = True
    pipeline_options.table_structure_options = TableStructureOptions(
        mode=TableFormerMode.ACCURATE  # Better quality for complex tables
    )
    
    converter = DocumentConverter(
        format_options={
            InputFormat.PDF: PdfFormatOption(
                pipeline_options=pipeline_options
            )
        }
    )
    
    return converter


def extract_chunk_metadata(chunk, chunker, source_file):
    """Extract comprehensive metadata from a chunk including page info and content types."""
    
    enriched_text = chunker.contextualize(chunk=chunk)
    
    meta = {
        "source_file": os.path.basename(source_file),
        "char_count": len(chunk.text),
        "enriched_char_count": len(enriched_text),
    }
    
    # Extract headings from chunk meta
    if hasattr(chunk, 'meta') and chunk.meta:
        if hasattr(chunk.meta, 'headings') and chunk.meta.headings:
            meta["headings"] = chunk.meta.headings
        if hasattr(chunk.meta, 'origin') and chunk.meta.origin:
            meta["origin"] = str(chunk.meta.origin)
        
        # Extract doc_items metadata (page numbers, content types)
        if hasattr(chunk.meta, 'doc_items') and chunk.meta.doc_items:
            pages = set()
            content_types = set()
            for item in chunk.meta.doc_items:
                # Get content type (text, table, picture, etc.)
                if hasattr(item, 'label'):
                    content_types.add(str(item.label))
                elif hasattr(item, 'content_type'):
                    content_types.add(str(item.content_type))
                
                # Get page number from provenance
                if hasattr(item, 'prov') and item.prov:
                    for prov in item.prov:
                        if hasattr(prov, 'page_no'):
                            pages.add(prov.page_no)
            
            if pages:
                meta["pages"] = sorted(pages)
            if content_types:
                meta["content_types"] = sorted(content_types)
    
    return enriched_text, meta


def process_pdf(converter, pdf_path: str, output_dir: str, max_tokens: int = 512):
    """Process a single PDF with full Docling pipeline."""
    
    # 1. Convert PDF with full pipeline (OCR + TableFormer ACCURATE)
    print("[1/6] Converting PDF (OCR + TableFormer ACCURATE)...")
    result = converter.convert(pdf_path)
    document = result.document
    
    # Gunakan nama file dari docling (document.name). Ini mempermudah integrasi
    # karena docling terkadang sudah memanipulasi atau mengambil metadata title dari file.
    pdf_name = getattr(document, 'name', None)
    if not pdf_name:
        pdf_name = Path(pdf_path).stem
        
    # Sanitasi agar aman digunakan sebagai nama file
    import re
    pdf_name = re.sub(r'[\\/*?:"<>|]', "", pdf_name).strip()
    
    print(f"\n{'='*60}")
    print(f"Processing: {pdf_name}")
    print(f"{'='*60}")
    
    # 2. Export DoclingDocument as JSON (lossless representation)
    print("[2/6] Exporting DoclingDocument JSON (lossless)...")
    doc_json_path = os.path.join(output_dir, f"{pdf_name}_document.json")
    doc_dict = document.export_to_dict()
    with open(doc_json_path, "w", encoding="utf-8") as f:
        json.dump(doc_dict, f, ensure_ascii=False, indent=2, default=str)
    print(f"  -> Saved: {doc_json_path}")
    
    # 3. Export full Markdown
    print("[3/6] Exporting full Markdown...")
    full_md = document.export_to_markdown()
    md_path = os.path.join(output_dir, f"{pdf_name}.md")
    with open(md_path, "w", encoding="utf-8") as f:
        f.write(full_md)
    print(f"  -> Saved: {md_path}")
    
    # 4. Export HTML (preserves table structure)
    print("[4/6] Exporting HTML (table-preserving)...")
    try:
        full_html = document.export_to_html()
        html_path = os.path.join(output_dir, f"{pdf_name}.html")
        with open(html_path, "w", encoding="utf-8") as f:
            f.write(full_html)
        print(f"  -> Saved: {html_path}")
    except Exception as e:
        print(f"  -> HTML export skipped: {e}")
    
    # 5. Chunk using HybridChunker with tokenizer
    print(f"[5/6] Chunking with HybridChunker (max_tokens={max_tokens})...")
    chunker = HybridChunker(
        max_tokens=max_tokens,
        merge_peers=True,  # Merge undersized adjacent chunks
    )
    chunks = list(chunker.chunk(document))
    print(f"  -> Generated {len(chunks)} chunks")
    
    # 6. Build output structures with comprehensive metadata
    print("[6/6] Building chunks output with full metadata...")
    
    chunks_data = []
    for i, chunk in enumerate(chunks):
        enriched_text, meta = extract_chunk_metadata(chunk, chunker, pdf_path)
        
        chunk_data = {
            "chunk_id": i,
            "text": chunk.text,
            "enriched_text": enriched_text,
            "meta": meta,
        }
        chunks_data.append(chunk_data)
    
    # --- Write JSON chunks ---
    json_path = os.path.join(output_dir, f"{pdf_name}_chunks.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump({
            "source_file": os.path.basename(pdf_path),
            "total_chunks": len(chunks_data),
            "max_tokens": max_tokens,
            "docling_version": "2.85.0",
            "pipeline": {
                "ocr": True,
                "table_structure": True,
                "table_former_mode": "ACCURATE",
            },
            "chunker": {
                "type": "HybridChunker",
                "max_tokens": max_tokens,
                "merge_peers": True,
            },
            "chunks": chunks_data,
        }, f, ensure_ascii=False, indent=2)
    print(f"  -> Saved: {json_path}")
    
    # --- Write LLM-friendly Markdown ---
    llm_md_path = os.path.join(output_dir, f"{pdf_name}_llm.md")
    with open(llm_md_path, "w", encoding="utf-8") as f:
        f.write(f"# {pdf_name}\n\n")
        f.write(f"> **Source**: `{os.path.basename(pdf_path)}`  \n")
        f.write(f"> **Total Chunks**: {len(chunks_data)}  \n")
        f.write(f"> **Max Tokens per Chunk**: {max_tokens}  \n")
        f.write(f"> **Pipeline**: OCR + TableFormer ACCURATE  \n\n")
        f.write(f"---\n\n")
        
        for cd in chunks_data:
            f.write(f"<!-- CHUNK {cd['chunk_id']}")
            
            # Add page info to HTML comment
            pages = cd.get("meta", {}).get("pages")
            if pages:
                f.write(f" | pages: {','.join(map(str, pages))}")
            
            content_types = cd.get("meta", {}).get("content_types")
            if content_types:
                f.write(f" | types: {','.join(content_types)}")
            
            f.write(f" -->\n")
            
            # Write headings context
            headings = cd.get("meta", {}).get("headings")
            if headings:
                f.write(f"**Context**: {' > '.join(headings)}\n\n")
            
            # Write page info as visible metadata
            if pages:
                f.write(f"*📄 Halaman: {', '.join(map(str, pages))}*\n\n")
            
            # Write the enriched text
            f.write(cd["enriched_text"])
            f.write(f"\n\n---\n\n")
    
    print(f"  -> Saved: {llm_md_path}")
    
    return {
        "file": os.path.basename(pdf_path),
        "total_chunks": len(chunks_data),
        "outputs": {
            "document_json": os.path.basename(doc_json_path),
            "chunks_json": os.path.basename(json_path),
            "llm_md": os.path.basename(llm_md_path),
            "full_md": os.path.basename(md_path),
        }
    }


def main():
    regulasi_dir = os.path.dirname(os.path.abspath(__file__))
    output_dir = regulasi_dir
    
    # Find all PDFs
    pdf_files = sorted(glob.glob(os.path.join(regulasi_dir, "*.pdf")))
    
    if not pdf_files:
        print("No PDF files found in regulasi directory!")
        sys.exit(1)
    
    print(f"Found {len(pdf_files)} PDF file(s):")
    for p in pdf_files:
        print(f"  - {os.path.basename(p)}")
    
    # Create converter once with full pipeline options
    print("\nInitializing Docling pipeline (OCR + TableFormer ACCURATE)...")
    converter = create_converter()
    
    # Process each PDF
    results = []
    for pdf_path in pdf_files:
        result = process_pdf(converter, pdf_path, output_dir, max_tokens=512)
        results.append(result)
    
    # Summary
    print(f"\n{'='*60}")
    print("SUMMARY")
    print(f"{'='*60}")
    print(f"\nPipeline: OCR=True, TableFormer=ACCURATE, HybridChunker(512)")
    print(f"Outputs per file:")
    print(f"  *_document.json  - DoclingDocument lossless JSON")
    print(f"  *_chunks.json    - Chunks + metadata (pages, headings, types)")
    print(f"  *_llm.md         - LLM-friendly chunked Markdown")
    print(f"  *.md             - Full Markdown")
    print(f"  *.html           - Full HTML (table-preserving)")
    print()
    for r in results:
        print(f"  {r['file']}")
        print(f"    Chunks: {r['total_chunks']}")
        for k, v in r['outputs'].items():
            print(f"    {k}: {v}")
    print(f"\nDone! All files saved to: {output_dir}")


if __name__ == "__main__":
    main()
