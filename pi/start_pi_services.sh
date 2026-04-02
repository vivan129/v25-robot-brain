#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# Export optional GPIO pins / ports if provided
export RELAY_GPIO="${RELAY_GPIO:-17,27,22,23}"
export MOTOR_GPIO="${MOTOR_GPIO:-13,20,19,21}"
export GPIO_AGENT_PORT="${GPIO_AGENT_PORT:-8070}"

# Start services in background
python3 pi/camera_server.py &
CAM_PID=$!

python3 pi/lidar_server.py &
LIDAR_PID=$!

python3 pi/gpio_agent.py &
GPIO_PID=$!

trap 'kill $CAM_PID $LIDAR_PID $GPIO_PID 2>/dev/null' INT TERM

wait $CAM_PID $LIDAR_PID $GPIO_PID
