import PyPDF2
import json
import re

"""
Extract all missing CP subjects from KepKaBSKAP-046/2025 PDF:
- Fisika (Fase F)
- Kimia (Fase F)
- Biologi (Fase F)
- Matematika Tingkat Lanjut (Fase F)
- Bahasa Indonesia Tingkat Lanjut (Fase F)
- Bahasa Inggris Tingkat Lanjut (Fase F)  
- Sejarah Tingkat Lanjut (Fase F)
- Bahasa Mandarin, Prancis, Jepang, Jerman, Arab, Korea (Fase F)
- Prakarya dan Kewirausahaan (Fase F)
"""

reader = PyPDF2.PdfReader(r'D:\Download\KepKaBSKAP-046_2025-ttg-CP.pdf')
total = len(reader.pages)

# Load existing data
cp_data = json.load(open(r'd:\Project\KelasKA\lib\data\capaian-pembelajaran.json', 'r', encoding='utf-8'))

# Extract all pages text for Lampiran II (pages 23-347)
print("Extracting all pages...")
all_pages = {}
for i in range(22, min(400, total)):
    text = reader.pages[i].extract_text()
    cleaned = ' '.join(line.strip() for line in text.split('\n') if line.strip())
    all_pages[i] = cleaned
    if i % 50 == 0:
        print(f"  Page {i+1}...")

full_text = ' '.join(all_pages[i] for i in sorted(all_pages.keys()))
print(f"Total text: {len(full_text)} chars")

def clean_cp_text(text, max_len=4000):
    text = text.strip()
    text = re.sub(r'\s+\d+\.\s*$', '', text)
    if len(text) > max_len:
        cut_pos = text[:max_len].rfind('.')
        if cut_pos > max_len * 0.8:
            text = text[:cut_pos+1]
        else:
            text = text[:max_len] + '...'
    return text

def extract_fases(section_text):
    fases = {}
    fase_pattern = re.compile(r'Fase\s+([A-F])\s*\(', re.IGNORECASE)
    matches = list(fase_pattern.finditer(section_text))
    for idx, m in enumerate(matches):
        fase_letter = m.group(1).upper()
        start = m.start()
        end = matches[idx+1].start() if idx+1 < len(matches) else len(section_text)
        fase_text = clean_cp_text(section_text[start:end])
        if len(fase_text) > 50:
            fases[fase_letter] = fase_text
    return fases

def find_section(header_pattern, end_patterns, max_len=50000):
    """Find a section by header pattern, ending at any of the end patterns."""
    match = re.search(header_pattern, full_text, re.IGNORECASE)
    if not match:
        return None
    start = match.start()
    best_end = start + max_len
    for ep in end_patterns:
        m = re.search(ep, full_text[start + 200:], re.IGNORECASE)
        if m:
            candidate = start + 200 + m.start()
            if candidate < best_end:
                best_end = candidate
    return full_text[start:best_end]

# =====================================================================
# 1. FISIKA
# =====================================================================
print("\n--- Extracting Fisika ---")
fisika_text = find_section(
    r'CAPAIAN\s+PEMBELAJARAN\s+FISIKA\b',
    [r'CAPAIAN\s+PEMBELAJARAN\s+KIMIA\b']
)
if fisika_text:
    fases = extract_fases(fisika_text)
    if fases:
        cp_data['Fisika'] = fases
        print(f"  Fisika: {list(fases.keys())} ({sum(len(v) for v in fases.values())} chars)")
    else:
        print("  WARNING: No fases found in Fisika section")
        print(f"  Section preview: {fisika_text[:200]}")
else:
    print("  WARNING: Fisika section not found!")

# =====================================================================
# 2. KIMIA
# =====================================================================
print("\n--- Extracting Kimia ---")
kimia_text = find_section(
    r'CAPAIAN\s+PEMBELAJARAN\s+KIMIA\b',
    [r'CAPAIAN\s+PEMBELAJARAN\s+BIOLOGI\b']
)
if kimia_text:
    fases = extract_fases(kimia_text)
    if fases:
        cp_data['Kimia'] = fases
        print(f"  Kimia: {list(fases.keys())} ({sum(len(v) for v in fases.values())} chars)")
    else:
        print("  WARNING: No fases found in Kimia section")
else:
    print("  WARNING: Kimia section not found!")

# =====================================================================
# 3. BIOLOGI
# =====================================================================
print("\n--- Extracting Biologi ---")
biologi_text = find_section(
    r'CAPAIAN\s+PEMBELAJARAN\s+BIOLOGI\b',
    [r'CAPAIAN\s+PEMBELAJARAN\s+INFORMATIKA\b']
)
if biologi_text:
    fases = extract_fases(biologi_text)
    if fases:
        cp_data['Biologi'] = fases
        print(f"  Biologi: {list(fases.keys())} ({sum(len(v) for v in fases.values())} chars)")
    else:
        print("  WARNING: No fases found in Biologi section")
else:
    print("  WARNING: Biologi section not found!")

# =====================================================================
# 4. MATEMATIKA TINGKAT LANJUT
# =====================================================================
print("\n--- Extracting Matematika Tingkat Lanjut ---")
mat_tl_text = find_section(
    r'CAPAIAN\s+PEMBELAJARAN\s+MATEMATIKA\s+TINGKAT\s+LANJUT\b',
    [r'CAPAIAN\s+PEMBELAJARAN\s+(?:BAHASA|FISIKA|KIMIA|BIOLOGI|INFORMATIKA)']
)
if mat_tl_text:
    fases = extract_fases(mat_tl_text)
    if fases:
        cp_data['Matematika Tingkat Lanjut'] = fases
        print(f"  Mat TL: {list(fases.keys())} ({sum(len(v) for v in fases.values())} chars)")
    else:
        print("  No fases found. Preview:", mat_tl_text[:300])
else:
    print("  WARNING: Matematika Tingkat Lanjut section not found!")

# =====================================================================
# 5. BAHASA INDONESIA TINGKAT LANJUT
# =====================================================================
print("\n--- Extracting Bahasa Indonesia Tingkat Lanjut ---")
bi_tl_text = find_section(
    r'CAPAIAN\s+PEMBELAJARAN\s+BAHASA\s+INDONESIA\s+TINGKAT\s+LANJUT\b',
    [r'CAPAIAN\s+PEMBELAJARAN\s+(?:BAHASA\s+INGGRIS|MATEMATIKA|FISIKA)']
)
if bi_tl_text:
    fases = extract_fases(bi_tl_text)
    if fases:
        cp_data['Bahasa Indonesia Tingkat Lanjut'] = fases
        print(f"  B.Indo TL: {list(fases.keys())} ({sum(len(v) for v in fases.values())} chars)")
else:
    print("  WARNING: Bahasa Indonesia TL not found!")

# =====================================================================
# 6. BAHASA INGGRIS TINGKAT LANJUT
# =====================================================================
print("\n--- Extracting Bahasa Inggris Tingkat Lanjut ---")
eng_tl_text = find_section(
    r'CAPAIAN\s+PEMBELAJARAN\s+BAHASA\s+INGGRIS\s+TINGKAT\s+LANJUT\b',
    [r'CAPAIAN\s+PEMBELAJARAN\s+(?:BAHASA\s+(?!INGGRIS\s+TINGKAT)|MATEMATIKA|FISIKA|ILMU)']
)
if eng_tl_text:
    fases = extract_fases(eng_tl_text)
    if fases:
        cp_data['Bahasa Inggris Tingkat Lanjut'] = fases
        print(f"  B.Ing TL: {list(fases.keys())} ({sum(len(v) for v in fases.values())} chars)")
else:
    print("  WARNING: Bahasa Inggris TL not found!")

# =====================================================================
# 7. SEJARAH (check for Tingkat Lanjut or additional fases)
# =====================================================================
print("\n--- Checking Sejarah Tingkat Lanjut ---")
sej_tl_text = find_section(
    r'CAPAIAN\s+PEMBELAJARAN\s+SEJARAH\s+TINGKAT\s+LANJUT\b',
    [r'CAPAIAN\s+PEMBELAJARAN\s+(?:GEOGRAFI|EKONOMI|SOSIOLOGI)']
)
if sej_tl_text:
    fases = extract_fases(sej_tl_text)
    if fases:
        cp_data['Sejarah Tingkat Lanjut'] = fases
        print(f"  Sejarah TL: {list(fases.keys())} ({sum(len(v) for v in fases.values())} chars)")
else:
    print("  Sejarah Tingkat Lanjut not found as separate section")
    # Check if Sejarah section has more content
    print("  Current Sejarah fases:", list(cp_data.get('Sejarah', {}).keys()))

# =====================================================================
# 8. BAHASA ASING
# =====================================================================
foreign_langs = [
    ('Bahasa Mandarin', r'CAPAIAN\s+PEMBELAJARAN\s+BAHASA\s+MANDARIN\b'),
    ('Bahasa Prancis', r'CAPAIAN\s+PEMBELAJARAN\s+BAHASA\s+PRANCIS\b'),
    ('Bahasa Jepang', r'CAPAIAN\s+PEMBELAJARAN\s+BAHASA\s+JEPANG\b'),
    ('Bahasa Jerman', r'CAPAIAN\s+PEMBELAJARAN\s+BAHASA\s+JERMAN\b'),
    ('Bahasa Arab', r'CAPAIAN\s+PEMBELAJARAN\s+BAHASA\s+ARAB\b'),
    ('Bahasa Korea', r'CAPAIAN\s+PEMBELAJARAN\s+BAHASA\s+KOREA\b'),
]

for lang_name, lang_pattern in foreign_langs:
    print(f"\n--- Extracting {lang_name} ---")
    # Build end patterns
    end_pats = [r'CAPAIAN\s+PEMBELAJARAN\s+(?:BAHASA\s+(?!' + re.escape(lang_name.split()[-1]) + r')|KODING|PRAKARYA|SENI|PENDIDIKAN)']
    # Also add other language patterns as end markers
    for other_name, other_pat in foreign_langs:
        if other_name != lang_name:
            end_pats.append(other_pat)
    
    section = find_section(lang_pattern, end_pats)
    if section:
        fases = extract_fases(section)
        if fases:
            cp_data[lang_name] = fases
            print(f"  {lang_name}: {list(fases.keys())} ({sum(len(v) for v in fases.values())} chars)")
        else:
            print(f"  No fases found. Preview: {section[:200]}")
    else:
        print(f"  WARNING: {lang_name} section not found!")

# =====================================================================
# 9. PRAKARYA DAN KEWIRAUSAHAAN
# =====================================================================
print("\n--- Extracting Prakarya dan Kewirausahaan ---")
# There are multiple Prakarya types: Budi Daya, Kerajinan, Rekayasa, Pengolahan
# Try to find the main one or any
prakarya_patterns = [
    (r'CAPAIAN\s+PEMBELAJARAN\s+PRAKARYA\s+DAN\s+KEWIRAUSAHAAN\b(?!\s+BUDI|\s+KERAJINAN|\s+REKAYASA|\s+PENGOLAHAN)', 'Prakarya dan Kewirausahaan'),
    (r'CAPAIAN\s+PEMBELAJARAN\s+PRAKARYA\s+DAN\s+KEWIRAUSAHAAN\s+BUDI\s+DAYA\b', 'Prakarya dan Kewirausahaan Budi Daya'),
    (r'CAPAIAN\s+PEMBELAJARAN\s+PRAKARYA\s+DAN\s+KEWIRAUSAHAAN\s+KERAJINAN\b', 'Prakarya dan Kewirausahaan Kerajinan'),
    (r'CAPAIAN\s+PEMBELAJARAN\s+PRAKARYA\s+DAN\s+KEWIRAUSAHAAN\s+REKAYASA\b', 'Prakarya dan Kewirausahaan Rekayasa'),
    (r'CAPAIAN\s+PEMBELAJARAN\s+PRAKARYA\s+DAN\s+KEWIRAUSAHAAN\s+PENGOLAHAN\b', 'Prakarya dan Kewirausahaan Pengolahan'),
]

for pat, name in prakarya_patterns:
    section = find_section(pat, [r'CAPAIAN\s+PEMBELAJARAN\s+(?:PRAKARYA|PENDIDIKAN|BAHASA|SENI|KODING)'])
    if section:
        fases = extract_fases(section)
        if fases:
            # Store as generic "Prakarya dan Kewirausahaan" if it's the first one
            store_key = 'Prakarya dan Kewirausahaan'
            if store_key not in cp_data:
                cp_data[store_key] = fases
                print(f"  {name}: {list(fases.keys())} ({sum(len(v) for v in fases.values())} chars)")
            else:
                print(f"  {name}: {list(fases.keys())} (skipped, already have Prakarya)")

# =====================================================================
# VALIDATION
# =====================================================================
print("\n" + "=" * 60)
print("FINAL VALIDATION")
print("=" * 60)

total_entries = 0
for subject in sorted(cp_data.keys()):
    fases = cp_data[subject]
    issues = []
    for fase, text in fases.items():
        if len(text) < 100:
            issues.append(f"Fase {fase} SHORT({len(text)})")
    total_entries += len(fases)
    status = "❌ " + "; ".join(issues) if issues else "✅"
    print(f"  {subject:50s} [{', '.join(sorted(fases.keys()))}] {status}")

print(f"\nTotal: {len(cp_data)} subjects, {total_entries} entries")

# Save
output_path = r'd:\Project\KelasKA\lib\data\capaian-pembelajaran.json'
with open(output_path, 'w', encoding='utf-8') as f:
    json.dump(cp_data, f, ensure_ascii=False, indent=2)

file_size = len(json.dumps(cp_data, ensure_ascii=False))
print(f"Saved to {output_path}")
print(f"File size: {file_size} chars ({file_size // 1024} KB)")
