import json, os
from pathlib import Path
from graphify.llm import extract_corpus_parallel

# GEMINI_API_KEY must be set in the environment before running this script
assert os.environ.get('GEMINI_API_KEY'), "Set GEMINI_API_KEY env var before running"

# Load uncached non-code files
uncached = Path('graphify-out/.graphify_uncached.txt').read_text(encoding='utf-8').strip().split('\n')
uncached = [f for f in uncached if f.strip()]

code_ext = {'.py', '.ts', '.tsx', '.js', '.jsx', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.hpp', '.cs', '.rb', '.swift', '.kt', '.scala', '.mjs', '.cjs', '.mts', '.cts', '.vue', '.svelte'}
non_code = [Path(f) for f in uncached if Path(f).suffix.lower() not in code_ext]

if not non_code:
    print("No non-code files to extract")
    Path('graphify-out/.graphify_semantic_new.json').write_text(
        json.dumps({'nodes': [], 'edges': [], 'hyperedges': [], 'input_tokens': 0, 'output_tokens': 0}, ensure_ascii=False),
        encoding='utf-8'
    )
else:
    print("Extracting %d non-code files with Gemini..." % len(non_code))
    result = extract_corpus_parallel(non_code, backend="gemini")
    Path('graphify-out/.graphify_semantic_new.json').write_text(
        json.dumps(result, indent=2, ensure_ascii=False),
        encoding='utf-8'
    )
    print("Semantic: %d nodes, %d edges" % (len(result.get('nodes', [])), len(result.get('edges', []))))
    print("Tokens: %d in / %d out" % (result.get('input_tokens', 0), result.get('output_tokens', 0)))
