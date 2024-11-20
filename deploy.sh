<<<<<<< HEAD
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
=======
export $(cat .env | xargs) && \
  # Check if we're already installed NPM packages. If not, install them now.
  ([ -f "./package.json" ] && [ ! -d "./node_modules" ] && npm install || true) && \
  cd cdk && \
  # Check if we're already installed NPM packages. If not, install them now.
  ([ -f "./package.json" ] && [ ! -d "./node_modules" ] && npm install || true) && \
  cdk deploy |
  cd ..
>>>>>>> refs/remotes/origin/main
