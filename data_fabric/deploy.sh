# Save original directory
ORIGINAL_DIR=$(pwd)

cd cdk && cdk deploy
cd "$ORIGINAL_DIR"

