#!/usr/bin/env bash
# E2E smoke test against runtime with IO_CAM_MOCK_HARDWARE=1
set -euo pipefail
BASE="${RUNTIME_URL:-http://localhost:8000}"

# P2-C22: ``curl -sf ... | head`` kombinasyonu SIGPIPE'a düşebilir —
# ``curl`` büyük response yazarken ``head`` erken çıkınca ``EPIPE``.
# ``set +o pipefail`` bu satırlarda; ``--max-filesize`` ile response'u sınırla.
# Alternatif: ``curl -sf -o /tmp/out`` + ``head /tmp/out``.

echo "Health..."
set +o pipefail
curl -sf --max-filesize 200 "$BASE/health" | head -c 200
set -o pipefail
echo

CSV='id,target_x,target_y,target_angle,shape_id
0,10,20,0,SHAPE1
'

echo "Upload job..."
set +o pipefail
curl -sf --max-filesize 200 -X POST "$BASE/api/job" -F "csv=$CSV" | head -c 200
set -o pipefail
echo

echo "Status..."
curl -sf "$BASE/api/job/status"
echo

echo "Glue sheet status..."
curl -sf "$BASE/api/glue_sheet/status"
echo
echo "OK"
