' Double-clique ce fichier pour lancer IrisDJ (version Rust).
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
exe = dir & "\target\release\irisdj.exe"
If Not fso.FileExists(exe) Then
  MsgBox "IrisDJ n'est pas compile." & vbCrLf & "Dans ce dossier : cargo build --release", 48, "IrisDJ"
  WScript.Quit
End If
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = dir
sh.Run """" & exe & """", 1, False
