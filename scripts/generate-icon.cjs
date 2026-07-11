#!/usr/bin/env node
/**
 * Generate app icon from PNG source.
 * This script ensures build/icon.ico is always up-to-date before packaging.
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const srcIcon = path.join(root, "src", "ui", "assets", "restoniti-icon.png");
const buildDir = path.join(root, "build");
const outIcon = path.join(buildDir, "icon.ico");

// Ensure build directory exists
if (!fs.existsSync(buildDir)) {
  fs.mkdirSync(buildDir, { recursive: true });
  console.log(`✓ Created ${buildDir}`);
}

// Check source PNG exists
if (!fs.existsSync(srcIcon)) {
  console.error(`✗ Source PNG not found: ${srcIcon}`);
  process.exit(1);
}

// Generate ICO from PNG
try {
  console.log(`Generating icon from ${srcIcon}...`);
  execSync(`png-to-ico "${srcIcon}" > "${outIcon}"`, { stdio: "inherit" });
  console.log(`✓ Generated ${outIcon}`);
} catch (error) {
  console.error(`✗ Failed to generate icon: ${error.message}`);
  process.exit(1);
}
