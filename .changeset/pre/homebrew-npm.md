---
"@slackwater/cli": patch
---

Homebrew now installs the CLI on Homebrew's Node, so it works on Intel Macs and ARM Linux and no longer needs `libatomic` from the system. The shell installer checks that the downloaded binary runs and, if a system library is missing, stops with the command to install it.
