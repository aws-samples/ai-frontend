export $(cat .env | xargs) && \
  # Check if we're already installed NPM packages. If not, install them now.
  ([ -f "./package.json" ] && [ ! -d "./node_modules" ] && npm install || true) && \
  cd cdk && \
  # Check if we're already installed NPM packages. If not, install them now.
  ([ -f "./package.json" ] && [ ! -d "./node_modules" ] && npm install || true) && \
  cdk deploy |
  cd ..
