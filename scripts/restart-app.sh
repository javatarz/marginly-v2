#!/usr/bin/env bash
#
# Restart the app against the production build — `next start`, never `next dev`
# (ADR-0013). This is the default restart for a laptop; where the process really
# lives is not decided yet, so a pipeline overrides it with RESTART_CMD.
#
# Environment:
#   PORT       port to serve on (default 3000)
#   LOG_FILE   where the server's output goes (default .next-start.log)

set -euo pipefail

cd "$(dirname "$0")/.."

PORT="${PORT:-3000}"
PID_FILE=".next-start.pid"
LOG_FILE="${LOG_FILE:-.next-start.log}"

if [[ -f "$PID_FILE" ]]; then
  OLD_PID="$(cat "$PID_FILE")"
  if kill -0 "$OLD_PID" 2>/dev/null; then
    echo "Stopping the running server (pid $OLD_PID)."
    kill "$OLD_PID"
    for _ in $(seq 1 50); do
      kill -0 "$OLD_PID" 2>/dev/null || break
      sleep 0.1
    done
    kill -9 "$OLD_PID" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
fi

echo "Starting next start on port $PORT."
nohup ./node_modules/.bin/next start --port "$PORT" >"$LOG_FILE" 2>&1 &
NEW_PID=$!
echo "$NEW_PID" >"$PID_FILE"

for _ in $(seq 1 100); do
  if ! kill -0 "$NEW_PID" 2>/dev/null; then
    echo "The server exited on startup. Its output:" >&2
    sed 's/^/  /' "$LOG_FILE" >&2
    rm -f "$PID_FILE"
    exit 1
  fi
  if curl -fs -o /dev/null "http://127.0.0.1:${PORT}/" 2>/dev/null; then
    echo "Serving on http://127.0.0.1:${PORT}/ (pid $NEW_PID, log $LOG_FILE)."
    exit 0
  fi
  sleep 0.2
done

echo "The server did not answer on port $PORT within 20s. Its output:" >&2
sed 's/^/  /' "$LOG_FILE" >&2
exit 1
