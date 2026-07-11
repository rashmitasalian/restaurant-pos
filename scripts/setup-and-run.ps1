# PowerShell helper: setup-and-run.ps1
# Run this from the project root in PowerShell (Windows)
# Example: Open PowerShell, navigate to the project folder and run:
#   .\scripts\setup-and-run.ps1

Set-StrictMode -Version Latest

Write-Host "Checking Node & npm versions..."
try {
  $nodeVersion = & node --version 2>$null
} catch {
  Write-Host "Node.js not found. Please install Node.js (LTS) before proceeding." -ForegroundColor Red
  exit 1
}

Write-Host "Installing npm dependencies (this may take a few minutes)..."
# Use npm.cmd to bypass the PowerShell npm wrapper (npm.ps1) which can fail on some setups
& npm.cmd install
if ($LASTEXITCODE -ne 0) {
  Write-Host "npm install failed." -ForegroundColor Red
  exit 1
}

Write-Host "Starting dev servers (Electron + React). This will run both the renderer dev server and Electron." -ForegroundColor Green
Write-Host "If you need to run them separately, use: npm run dev:react (in src) and npm run dev:electron" -ForegroundColor Yellow

# Run the combined start script inside cmd.exe to avoid PowerShell npm shim issues
Start-Process -NoNewWindow -FilePath "cmd.exe" -ArgumentList "/c","npm.cmd run start"

Write-Host "Dev servers started in a new command window." -ForegroundColor Green
