#!/bin/bash
cd "$(dirname "$0")"
exec python3.10 -m uvicorn api:app --host 0.0.0.0 --port 8765 --reload
