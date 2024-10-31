#!/bin/bash

# Make both deploy scripts executable
chmod +x frontend/deploy.sh
chmod +x llm_gateway/deploy.sh

# Save original directory
ORIGINAL_DIR=$(pwd)

# Run gateway deployment first
echo "Starting gateway deployment..."
cd llm_gateway && ./deploy.sh
cd "$ORIGINAL_DIR"
echo "COMPLETE: Gateway deployment."

# Then run frontend deployment
echo "Starting frontend deployment..."
cd frontend && ./deploy.sh
cd "$ORIGINAL_DIR"
echo "COMPLETE: Frontend deployment."
