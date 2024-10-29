#!/bin/bash

# Run the frontend deployment script in the background
frontend_pid=$( (cd frontend && ./deploy.sh &) 2>&1 | awk '{print $1}' )

# Run the gateway deployment script in the background
gateway_pid=$( (cd gateway && ./deploy.sh &) 2>&1 | awk '{print $1}' )

# Wait for both scripts to finish
wait $frontend_pid
wait $gateway_pid

echo "Both deployments completed successfully."
