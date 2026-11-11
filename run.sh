#!/usr/bin/env bash
# One-file setup + run for the GUUT Forms prototype.
# Usage: bash run.sh   (from inside the guut-forms-prototype folder)
set -e
cd "$(dirname "$0")"

if [ ! -d backend/node_modules ]; then
  echo "Installing backend dependencies..."
  (cd backend && npm install)
fi

if [ ! -f backend/.env ]; then
  cp backend/.env.example backend/.env
  echo "Created backend/.env (MONGO_URI left blank -> in-memory DB)."
fi

echo ""
echo "NOTE: AI uses each user's own Claude or ChatGPT key (Settings -> AI)."
echo "A dev superadmin login is printed below on first start."
echo ""

if [ ! -d frontend/node_modules ]; then
  echo "Installing frontend dependencies..."
  (cd frontend && npm install)
fi

echo ""
echo "Starting backend (port 4000) and frontend (port 5173)..."
echo "Press Ctrl+C to stop both."
echo ""

(cd backend && npm run dev) &
BACKEND_PID=$!
(cd frontend && npm run dev) &
FRONTEND_PID=$!

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null" EXIT
wait
