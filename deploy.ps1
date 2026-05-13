$Message = Read-Host "Commit message"

git add -A
git commit -m $Message
git push
ssh root@72.61.127.245 "Retainify/deploy.sh"
