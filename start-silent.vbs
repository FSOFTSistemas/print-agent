' start-silent.vbs
Set WshShell = CreateObject("WScript.Shell")
Set Fso = CreateObject("Scripting.FileSystemObject")
ScriptDir = Fso.GetParentFolderName(WScript.ScriptFullName)
WshShell.Run """" & ScriptDir & "\node.exe"" """ & ScriptDir & "\server.js""", 0, false
