Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "E:\oi chain\nifty-oi-analyzer"
WshShell.Run "pythonw.exe -m scraper.scheduler", 0, False

