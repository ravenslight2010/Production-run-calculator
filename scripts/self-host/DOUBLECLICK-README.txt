Install-RunCalc-DOUBLECLICK.cmd
================================

WHAT TO DO
  1. Copy this ONE file to the Windows PC.
  2. Double-click it.
  3. Click Yes on the UAC (Administrator) prompt.
  4. Leave the window open until it says FINISHED (or reboots).

IF THE PC REBOOTS
  Log back into Windows. Setup continues automatically
  (RunOnce + continue flag). If it does not, double-click
  the same file again.

BEFORE YOU DISTRIBUTE (optional)
  Open the .cmd in Notepad and change these defaults near the top:
    set "SITE=Plant"
    set "TZ=America/Chicago"
    set "MANAGER=manager"

AFTER INSTALL
  Open:  C:\runcalc\RUNBOOK.txt
  Logs:  C:\runcalc\logs
  Check: https://<this-pc>/api/readyz  (trust the cert if asked)

NOTES
  - Needs Windows 10/11, internet for first downloads (Git/Docker/images).
  - Docker Desktop may still show a one-time license window — accept it, then
    double-click this file again if the install paused.
  - Does not migrate Replit data. Fresh local database.
