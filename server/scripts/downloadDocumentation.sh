#!/bin/bash

# Stop script after first error
set -e

# Variables
TechnicalDocumentation="https://github.com/rxsio/firo-docs/archive/refs/heads/gh-pages.zip"
InterfaceDocumentation="https://github.com/rxsio/interface-docs/archive/refs/heads/gh-pages.zip"

# Download documentation
echo -n "Downloading documentation..."
wget -O "technicalDocumentation.zip" $TechnicalDocumentation
wget -O "interfaceDocumentation.zip" $InterfaceDocumentation

# Create output folder
rm -rf docs
mkdir -p docs

# Unpack
echo -n "Unzipping documentation..."
unzip "technicalDocumentation.zip" -d docs
unzip "interfaceDocumentation.zip" -d docs

# Rename
echo -n "Renaming directories"
mv docs/firo-docs-gh-pages docs/technical
mv docs/interface-docs-gh-pages docs/interface

# Remove archives
rm "technicalDocumentation.zip"
rm "interfaceDocumentation.zip"