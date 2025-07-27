# Script to completely remove sensitive files from Git history
$filesToRemove = @(
    "config/katz-speech-to-text-key.json",
    "config/katz-text-to-speech-key.json"
)

Write-Host "Creating backup branch before cleaning history..."
git branch backup-before-cleaning

Write-Host "Removing sensitive files from Git history..."
git filter-branch --force --index-filter "git rm --cached --ignore-unmatch $($filesToRemove -join ' ')" --prune-empty --tag-name-filter cat -- --all

Write-Host "Removing old reflog entries..."
git reflog expire --expire=now --all

Write-Host "Running garbage collection to remove unreachable objects..."
git gc --prune=now --aggressive

Write-Host "Done! You can now force push with: git push origin main --force"
