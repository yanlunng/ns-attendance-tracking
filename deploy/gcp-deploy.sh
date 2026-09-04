#!/usr/bin/env bash
# Deploys attendance-app to a small always-on Compute Engine VM.
# Intended to be run from Google Cloud Shell (gcloud + docker preinstalled)
# from inside the attendance-app project directory.
#
# Usage:
#   1. Fill in the variables below (or export them before running).
#   2. ./deploy/gcp-deploy.sh
#
# Safe to re-run: gcloud commands here are idempotent-ish (create commands
# will just fail with "already exists" if you re-run after a partial run —
# that's fine, ignore and continue, or comment out the steps already done).

set -euo pipefail

PROJECT_ID="${PROJECT_ID:?Set PROJECT_ID, e.g. export PROJECT_ID=my-gcp-project}"
REGION="${REGION:-us-central1}"
ZONE="${ZONE:-us-central1-a}"
VM_NAME="${VM_NAME:-attendance-app}"
REPO_NAME="${REPO_NAME:-attendance-app}"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}/app:latest"

SESSION_SECRET="${SESSION_SECRET:?Set SESSION_SECRET to a long random string, e.g. export SESSION_SECRET=$(openssl rand -hex 32)}"
ADMIN_USERNAME="${ADMIN_USERNAME:-admin}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:?Set ADMIN_PASSWORD to a strong password}"

gcloud config set project "$PROJECT_ID"
gcloud config set compute/zone "$ZONE"

echo "== Enabling required APIs =="
gcloud services enable compute.googleapis.com artifactregistry.googleapis.com

echo "== Creating Artifact Registry repo (ok if it already exists) =="
gcloud artifacts repositories create "$REPO_NAME" \
  --repository-format=docker --location="$REGION" || true

gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet

echo "== Building and pushing image =="
docker build -t "$IMAGE" .
docker push "$IMAGE"

echo "== Creating VM (ok if it already exists) =="
gcloud compute instances create "$VM_NAME" \
  --machine-type=e2-small \
  --image-family=cos-stable \
  --image-project=cos-cloud \
  --boot-disk-size=20GB \
  --scopes=cloud-platform \
  --tags="$VM_NAME" || true

echo "== Ensuring the VM can pull from Artifact Registry =="
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
COMPUTE_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${COMPUTE_SA}" \
  --role="roles/artifactregistry.reader" \
  --condition=None \
  --quiet

CURRENT_SCOPES=$(gcloud compute instances describe "$VM_NAME" --zone="$ZONE" --format='value(serviceAccounts[0].scopes)' 2>/dev/null || echo "")
if [[ "$CURRENT_SCOPES" != *"cloud-platform"* ]]; then
  echo "VM was created without cloud-platform scope — updating it (brief stop/start)..."
  gcloud compute instances stop "$VM_NAME" --zone="$ZONE" --quiet
  gcloud compute instances set-service-account "$VM_NAME" \
    --zone="$ZONE" \
    --service-account="$COMPUTE_SA" \
    --scopes=cloud-platform
  gcloud compute instances start "$VM_NAME" --zone="$ZONE" --quiet
  echo "Waiting for the VM to finish booting..."
  sleep 20
fi

echo "== Opening firewall for HTTP (restrict --source-ranges if not public) =="
gcloud compute firewall-rules create "allow-${VM_NAME}" \
  --allow=tcp:80 \
  --target-tags="$VM_NAME" \
  --source-ranges=0.0.0.0/0 || true

echo "== Pulling and running the container on the VM =="
gcloud compute ssh "$VM_NAME" -- "
  docker-credential-gcr configure-docker --registries=${REGION}-docker.pkg.dev
  docker rm -f ${VM_NAME} 2>/dev/null || true
  docker pull ${IMAGE}
  docker run -d --name ${VM_NAME} \
    -p 80:3000 \
    -e SESSION_SECRET='${SESSION_SECRET}' \
    -e ADMIN_USERNAME='${ADMIN_USERNAME}' \
    -e ADMIN_PASSWORD='${ADMIN_PASSWORD}' \
    -v attendance-data:/app/data \
    --restart unless-stopped \
    ${IMAGE}
"

EXTERNAL_IP=$(gcloud compute instances describe "$VM_NAME" --format='get(networkInterfaces[0].accessConfigs[0].natIP)')
echo ""
echo "Done. App should be reachable at: http://${EXTERNAL_IP}"
echo "Log in with ${ADMIN_USERNAME} / the ADMIN_PASSWORD you set, then change it via the Users page."
echo "Reminder: this is plain HTTP. Put HTTPS in front (load balancer or nginx/Caddy on the VM) before real use."
