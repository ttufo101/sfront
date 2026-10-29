import re
p = "/root/fileupload/internal/handler/file.go"
s = open(p, encoding="utf-8").read()
s2, n = re.subn(r'([ \t]*logger\s+\*slog\.Logger\n)', r'\1\t\tserviceToken       string\n\t\tallowServiceBypass bool\n', s, count=1)
open(p, "w", encoding="utf-8").write(s2)
print("subn=", n)
