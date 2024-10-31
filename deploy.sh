#!/bin/bash

# Make both deploy scripts executable
chmod +x frontend/deploy.sh

# Save original directory
ORIGINAL_DIR=$(pwd)

# Then run frontend deployment
echo "Starting frontend deployment..."
cd frontend && ./deploy.sh
cd "$ORIGINAL_DIR"
echo "COMPLETE: Frontend deployment."
