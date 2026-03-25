#!/bin/bash
echo "============================================"
echo " PhoneStock - HTTPS Certificate Setup"
echo "============================================"
echo ""

# Check if mkcert is installed
if ! command -v mkcert &> /dev/null; then
  echo "mkcert not found. Installing..."
  echo ""
  if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    if command -v brew &> /dev/null; then
      brew install mkcert
      brew install nss  # for Firefox
    else
      echo "Please install Homebrew first: https://brew.sh"
      echo "Then re-run this script."
      exit 1
    fi
  else
    # Linux
    echo "Installing mkcert on Linux..."
    curl -JLO "https://dl.filippo.io/mkcert/latest?for=linux/amd64"
    chmod +x mkcert-v*-linux-amd64
    sudo mv mkcert-v*-linux-amd64 /usr/local/bin/mkcert
  fi
fi

# Get local IP
if [[ "$OSTYPE" == "darwin"* ]]; then
  LOCAL_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)
else
  LOCAL_IP=$(hostname -I | awk '{print $1}')
fi

echo "Detected local IP: $LOCAL_IP"
echo ""

# Create certs directory
mkdir -p certs
cd certs

# Install root CA (one time)
mkcert -install

# Generate cert for localhost + local IP
mkcert -cert-file cert.pem -key-file key.pem localhost 127.0.0.1 $LOCAL_IP

cd ..

echo ""
echo "============================================"
echo " Done! Certificates created in /certs"
echo " Now run:  node server.js"
echo " Then open: https://$LOCAL_IP:3443 on your phone"
echo " (Tap Advanced → Proceed on first visit)"
echo "============================================"
