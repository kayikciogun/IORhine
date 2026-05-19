#!/usr/bin/env bash
# E2E smoke test against runtime with IO_CAM_MOCK_HARDWARE=1
set -euo pipefail
BASE="${RUNTIME_URL:-http://localhost:8000}"

echo "Health..."
curl -sf "$BASE/health" | head -c 200
echo

CSV='id,target_x,target_y,target_angle,shape_id
0,10,20,0,SHAPE1
'

echo "Upload job..."
curl -sf -X POST "$BASE/api/job" -F "csv=$CSV" | head -c 200
echo

echo "Status..."
curl -sf "$BASE/api/job/status"
echo

echo "Glue sheet status..."
curl -sf "$BASE/api/glue_sheet/status"
echo
echo "OK"
