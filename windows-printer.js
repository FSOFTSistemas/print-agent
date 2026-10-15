const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

function validateWindowsPrinter(printer) {
  const name = printer?.printerName;
  if (typeof name !== "string" || !name.trim() || name.length > 256 || /[\x00-\x1f]/.test(name)) {
    return "Envie 'printerName' com o nome da impressora instalada no Windows.";
  }
  return null;
}

function createWindowsPrinterService({ platform = process.platform, spawnProcess = spawn } = {}) {
  let encodedScript;
  function run(request) {
    if (platform !== "win32") return Promise.reject(new Error("Impressao pelo Windows disponivel somente no Windows."));
    if (!encodedScript) {
      encodedScript = Buffer.from(fs.readFileSync(path.join(__dirname, "windows-spooler.ps1"), "utf8"), "utf16le").toString("base64");
    }
    return new Promise((resolve, reject) => {
      const executable = path.win32.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
      const child = spawnProcess(executable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encodedScript], {
        windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"],
      });
      let output = "", stderr = "", settled = false;
      const timer = setTimeout(() => {
        finish(new Error("Timeout do spooler Windows. Confira a fila e o papel antes de reenviar; nao ha reenvio automatico."));
        child.kill();
      }, 12000);
      function finish(error, value) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(value);
      }
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        output += chunk;
        if (output.length > 1024 * 1024) {
          finish(new Error("Resposta do spooler Windows excedeu o limite."));
          child.kill();
        }
      });
      child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-2000); });
      child.on("error", (error) => finish(new Error(`Nao foi possivel executar o spooler Windows: ${error.message}`)));
      child.stdin.on("error", (error) => finish(new Error(`Falha ao comunicar com o spooler Windows: ${error.message}`)));
      child.on("close", (code) => {
        if (settled) return;
        let result;
        try { result = JSON.parse(output.replace(/^\uFEFF/, "").trim()); }
        catch { return finish(new Error(`Resposta invalida do spooler Windows.${stderr ? ` ${stderr.trim()}` : ""}`)); }
        if (!result || typeof result !== "object" || Array.isArray(result)) {
          return finish(new Error("Resposta invalida do spooler Windows."));
        }
        if (code !== 0 || result.error) return finish(new Error(result.error || "Falha no spooler Windows."));
        finish(null, result);
      });
      // Nenhum nome, buffer ou outro dado enviado pelo cliente entra no comando.
      child.stdin.end(JSON.stringify(request), "utf8");
    });
  }

  async function list() {
    if (platform !== "win32") return [];
    const result = await run({ action: "list" });
    if (!Array.isArray(result.printers)) throw new Error("Lista de impressoras Windows invalida.");
    return result.printers.filter((printer) => typeof printer.name === "string" && printer.name)
      .filter((printer) => !/^(PORTPROMPT:|FILE:|NUL:)$/i.test(printer.portName || ""))
      .map((printer) => ({
        id: `windows-${Buffer.from(printer.name, "utf8").toString("hex")}`,
        type: "windows", name: printer.name, printerName: printer.name,
        manufacturer: printer.driverName || "Impressora do Windows",
        driverName: printer.driverName, portName: printer.portName, offline: Boolean(printer.offline),
      }));
  }

  async function print(buffer, printer) {
    const error = validateWindowsPrinter(printer);
    if (error) throw new Error(error);
    const result = await run({ action: "print", printerName: printer.printerName, bufferB64: buffer.toString("base64") });
    if (result.success !== true || !Number.isInteger(result.jobId) || result.jobId < 1) {
      throw new Error("O Windows nao confirmou a inclusao do trabalho na fila.");
    }
    return { jobId: result.jobId };
  }

  return { list, print };
}

module.exports = { createWindowsPrinterService, validateWindowsPrinter };
