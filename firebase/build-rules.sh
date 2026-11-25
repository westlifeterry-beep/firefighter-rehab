#!/bin/bash
# 由環境變數產生 firestore.rules（不輸出任何秘密）。
# 用法：build-rules.sh real   → 用 REHAB_DEV_PASSWORD；若未設定則用「永遠不成立」的雜湊（無人能成為開發者）
#       build-rules.sh test   → 用 /workspace/rehab-notes/dev-test-pw.txt（測試用）
set -e
cd "$(dirname "$0")"
MODE=${1:-real}
H2=$(MODE="$MODE" python3 - <<'PY'
import hashlib, os, secrets
mode = os.environ['MODE']
pw = None
if mode == 'test':
    pw = open('/workspace/rehab-notes/dev-test-pw.txt').read().strip()
else:
    pw = os.environ.get('REHAB_DEV_PASSWORD') or None
if not pw:
    print('locked-' + secrets.token_hex(16))   # 不可能吻合的值
else:
    proof = hashlib.sha256(('rehab-dev-v1:' + pw).encode()).hexdigest()
    print(hashlib.sha256(proof.encode()).hexdigest())
PY
)
sed "s/__DEV_H2__/$H2/" firestore.rules.template > firestore.rules
chmod 600 firestore.rules
if [[ "$H2" == locked-* ]]; then echo "rules built: developer LOCKED (no REHAB_DEV_PASSWORD)"; else echo "rules built: developer hash set ($MODE)"; fi
