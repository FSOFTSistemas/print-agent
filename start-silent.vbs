' start-silent.vbs
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run """C:\Program Files\PrintAgent\node.exe"" ""C:\Program Files\PrintAgent\server.js""", 0, false